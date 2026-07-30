-- ═══════════════════════════════════════════════════════════════════════════
-- 77_release_stale_auth_identities.sql — free the auth identities of users who
--                                        were deleted before 76 shipped
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- 99_verify_user_identity.sql row C5 reported 21 retained login emails on client
-- production. Those users were deleted through the app BEFORE the admin-users
-- edge function gained its 'delete_identity' action, so only half the deletion
-- happened: the directory row was flagged and hidden, but auth.users was never
-- touched. Two things are still true for each of them and should not be:
--
--   • their email is STILL CLAIMED in auth.users, so recreating an account with
--     the same address fails at the auth layer — which is exactly what the client
--     hit when they tried to recreate the people they had deleted
--   • any session they held was never revoked
--
-- Retrying Delete from the UI cannot fix it: soft_delete_user() raises
-- `already_deleted` and stops before the auth step, and RLS hides the rows so
-- they never appear in the list to retry. Hence a migration.
--
-- ═══ WHAT IT DOES ═══════════════════════════════════════════════════════════
--   1. Finds every soft-deleted account whose auth identity still exists.
--   2. Deletes those auth.users rows. Supabase's auth schema cascades from
--      users → sessions → refresh_tokens → identities, so this is what
--      auth.admin.deleteUser() does underneath: every session, refresh token,
--      reset link and OTP dies with the identity.
--   3. Clears login_email / login_enabled on the directory row, so the address
--      is releasable and nothing points at an identity that no longer exists.
--   4. Logs one 'auth_released' event per account, into the same audit table the
--      profile History panel reads.
--
-- The directory rows themselves are KEPT. They are the audit record; name,
-- mobile and email stay on them for history. Only the credentials go.
--
-- ═══ THE SAFETY RULE ════════════════════════════════════════════════════════
-- An auth identity is only removed when NO LIVE account references it. If a live
-- row shares that auth_user_id — which should never happen, but would be
-- catastrophic to get wrong — the identity is left alone and reported instead.
-- Deleting it would sign a working user out permanently and destroy their login.
--
-- ⚠️ Must be run as a role that can write to the auth schema (the Supabase SQL
--    editor runs as postgres, which can). It will say so plainly if it cannot.
--
-- Requires 75 (is_deleted). Idempotent — a second run finds nothing to do.
-- NOT REVERSIBLE: a destroyed auth identity cannot be recreated with the same
-- id. That is the point. See 77_rollback for what can and cannot be undone.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'user_accounts' and column_name = 'is_deleted') then
    raise exception '75_soft_delete_users.sql has not been applied (no is_deleted column).';
  end if;
  if to_regclass('auth.users') is null then
    raise exception
      'auth.users is not visible from this session. Run this in the Supabase SQL '
      'editor (which connects as postgres), not through the anon/authenticated API.';
  end if;
end $$;

-- ── 1. What is about to be released, and what is being skipped ──────────────
-- Printed BEFORE the change so the list is on record. A skipped row is a
-- warning, not a routine outcome — read them.
select 'will be released' as disposition,
       ua.name,
       ua.login_email,
       ua.deleted_at
  from user_accounts ua
 where coalesce(ua.is_deleted, false)
   and ua.auth_user_id is not null
   and exists (select 1 from auth.users au where au.id = ua.auth_user_id)
   and not exists (select 1 from user_accounts live
                    where not coalesce(live.is_deleted, false)
                      and live.auth_user_id = ua.auth_user_id)
union all
select 'SKIPPED — a LIVE account shares this identity',
       ua.name, ua.login_email, ua.deleted_at
  from user_accounts ua
 where coalesce(ua.is_deleted, false)
   and ua.auth_user_id is not null
   and exists (select 1 from user_accounts live
                where not coalesce(live.is_deleted, false)
                  and live.auth_user_id = ua.auth_user_id)
order by disposition, name;

do $$
declare
  v_ids     uuid[];
  v_acct    uuid[];
  v_skipped integer;
  v_n       bigint;
begin
  -- ── 2. Collect, applying the safety rule ──────────────────────────────────
  select array_agg(ua.auth_user_id), array_agg(ua.id)
    into v_ids, v_acct
    from user_accounts ua
   where coalesce(ua.is_deleted, false)
     and ua.auth_user_id is not null
     and exists (select 1 from auth.users au where au.id = ua.auth_user_id)
     and not exists (select 1 from user_accounts live
                      where not coalesce(live.is_deleted, false)
                        and live.auth_user_id = ua.auth_user_id);

  select count(*) into v_skipped
    from user_accounts ua
   where coalesce(ua.is_deleted, false)
     and ua.auth_user_id is not null
     and exists (select 1 from user_accounts live
                  where not coalesce(live.is_deleted, false)
                    and live.auth_user_id = ua.auth_user_id);
  if v_skipped > 0 then
    raise warning
      '% deleted account(s) share an auth identity with a LIVE account and were '
      'SKIPPED. Their identity was NOT removed — deleting it would destroy a '
      'working user''s login. See the report above and resolve by hand.', v_skipped;
  end if;

  if v_ids is null or cardinality(v_ids) = 0 then
    raise notice 'No stale auth identities to release. Nothing to do.';
  else
    -- ── 3. Audit BEFORE destroying, so the record survives the deletion ─────
    insert into user_account_events
      (user_account_id, target_name, target_email, action, details, actor_name)
    select ua.id, ua.name, coalesce(ua.email, ua.login_email), 'auth_released',
           format('Auth identity destroyed by migration 77 (deleted %s, before '
                  'delete_identity shipped). Sessions and tokens revoked; login '
                  'email released for reuse.',
                  coalesce(to_char(ua.deleted_at, 'DD Mon YYYY'), 'date unknown')),
           'migration 77'
      from user_accounts ua
     where ua.id = any(v_acct);

    -- ── 4. Destroy the identities ───────────────────────────────────────────
    -- auth.users cascades to sessions, refresh_tokens and identities, so every
    -- credential issued to these people dies here.
    delete from auth.users where id = any(v_ids);
    get diagnostics v_n = row_count;
    raise notice 'Destroyed % stale auth identity/identities.', v_n;

    -- ── 5. Release the directory row's credentials ──────────────────────────
    -- login_email is nulled so the address is free and nothing references an
    -- identity that no longer exists. auth_user_id is kept: it is part of the
    -- historical record and points at nothing, which is harmless.
    update user_accounts
       set login_email = null, login_enabled = false
     where id = any(v_acct);
    get diagnostics v_n = row_count;
    raise notice 'Released login email on % directory row(s).', v_n;
  end if;

  -- ── 6. Deleted rows with no identity at all ───────────────────────────────
  -- Someone deleted without ever having a dashboard login still holds a
  -- login_email string in a few cases. Nothing authenticates against it, and
  -- leaving it makes C5 report a problem that no longer exists.
  update user_accounts
     set login_email = null, login_enabled = false
   where coalesce(is_deleted, false)
     and login_email is not null
     and (auth_user_id is null
          or not exists (select 1 from auth.users au where au.id = auth_user_id));
  get diagnostics v_n = row_count;
  if v_n > 0 then
    raise notice 'Cleared a dangling login email on % deleted row(s) with no identity.', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── 7. The result ───────────────────────────────────────────────────────────
-- Both should read 0. Then re-run 99_verify_user_identity.sql — C5 becomes PASS.
select 'deleted accounts still holding a login email' as check, count(*)::text as value
  from user_accounts where coalesce(is_deleted, false) and login_email is not null
union all
select 'deleted accounts whose auth identity still exists',
       (select count(*)::text from user_accounts ua
         where coalesce(ua.is_deleted, false) and ua.auth_user_id is not null
           and exists (select 1 from auth.users au where au.id = ua.auth_user_id))
union all
select 'emails now free to reuse (were blocked by a deleted account)',
       (select count(distinct lower(e.target_email))::text
          from user_account_events e where e.action = 'auth_released' and e.target_email is not null);

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   What was released, and when:
--     select created_at, target_name, target_email, details
--       from user_account_events where action = 'auth_released'
--      order by created_at desc;
--
--   Live accounts are untouched (count should match your user list):
--     select count(*) from user_accounts where not coalesce(is_deleted,false);
