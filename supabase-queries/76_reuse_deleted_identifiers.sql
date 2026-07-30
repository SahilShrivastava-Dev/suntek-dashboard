-- ═══════════════════════════════════════════════════════════════════════════
-- 76_reuse_deleted_identifiers.sql — a deleted user's mobile / login email can
--                                    be given to a new user
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BUG (client-reported)
-- Delete a user, then create a new one with the same mobile number:
--     "A user with this mobile number already exists. Mobile numbers must be
--      unique."
--
-- Migration 75 hides deleted rows behind RLS, so the app cannot SEE the old
-- account — but a UNIQUE INDEX is evaluated on the physical table, not through
-- RLS. The row is invisible and still blocking. Migration 26's indexes take no
-- account of deletion:
--
--     user_accounts_mobile_norm_key  on (mobile_norm)        where mobile_norm is not null
--     user_accounts_login_email_key  on (lower(login_email)) where login_email is not null
--
-- Both become partial: they now ignore deleted rows, so an identifier belonging
-- only to a deleted account is free, while two LIVE accounts still cannot share
-- one.
--
-- ═══ SCOPE: DELETED, NOT MERELY INACTIVE ════════════════════════════════════
-- The brief proposed `is_deleted = false and is_active = true`, which would free
-- an identifier when a user is only DEACTIVATED. Deliberately not done, and the
-- reason is a trap rather than a preference:
--
--   deactivate A (mobile 98…) → create B with 98… → try to reactivate A
--
-- The last step would violate the index, so an everyday, reversible action
-- (Deactivate / Activate is a toggle in the UI) would start failing on a state
-- the admin cannot see. A deactivated person is expected back and keeps their
-- identifier reserved.
--
-- Every acceptance criterion still holds: create → delete → recreate works with
-- the same mobile or login email, and no two live accounts can share one. The
-- guarantee is simply stated over "not deleted" instead of "active".
--
-- ═══ WHY `email` IS NOT MADE UNIQUE ═════════════════════════════════════════
-- SHARED MAILBOXES ARE DESIGNED FOR HERE. Several staff legitimately share one
-- address (quality.control@thesuntek.com is on four accounts), which is the
-- whole reason migration 26 introduced `login_email` — a per-person, possibly
-- SYNTHETIC address that mirrors auth.users. So "unique normalized email" is
-- enforced on `login_email` only. Adding it to `email` would break four live
-- accounts immediately.
--
-- ═══ NORMALIZATION AND CONCURRENCY, ALREADY COVERED ═════════════════════════
-- Phone: `mobile_norm` is a GENERATED column — last 10 digits, punctuation
--   stripped — so "+91 98765 43210" and "9876543210" collide as they should. No
--   caller can forget to normalize, because no caller writes it.
-- Email: the index is on lower(login_email), so case never creates a duplicate.
-- Concurrency: a unique index IS the transactional guard. Two simultaneous
--   creations with the same identifier cannot both commit — one gets a unique
--   violation. No advisory locking needed.
--
-- ⚠️ THE AUTH IDENTITY IS A SEPARATE LAYER. Freeing these indexes lets the
-- DIRECTORY row be recreated. The Supabase auth identity (auth.users) is not
-- touched by SQL — it holds the password, the live sessions and the claimed
-- email. `soft_delete_user` cannot reach it; the admin-users edge function does,
-- via auth.admin.deleteUser, which is what actually invalidates sessions and
-- refresh tokens and frees a real email for reuse.
--
-- Requires 26 (mobile_norm, the indexes) and 75 (is_deleted). Idempotent.
-- Reversible via 76_rollback_reuse_deleted_identifiers.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'user_accounts' and column_name = 'is_deleted') then
    raise exception '75_soft_delete_users.sql has not been applied (no is_deleted column).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'user_accounts' and column_name = 'mobile_norm') then
    raise exception '26_login_by_phone_or_email.sql has not been applied (no mobile_norm).';
  end if;
end $$;

-- ── 1. Refuse to run if it would silently do nothing ────────────────────────
-- Two LIVE accounts already sharing an identifier would make the new unique
-- index fail to build. Better to say which ones than to leave a half-applied
-- migration and an index that silently does not exist.
do $$
declare v_dupes text;
begin
  select string_agg(format('mobile %s → %s', mobile_norm, names), '; ')
    into v_dupes
    from (select mobile_norm, string_agg(name, ' / ') as names
            from user_accounts
           where mobile_norm is not null and not coalesce(is_deleted, false)
           group by mobile_norm having count(*) > 1) d;
  if v_dupes is not null then
    raise exception
      'Two or more LIVE accounts share a mobile number, so the unique index '
      'cannot be built: %. Delete or correct one of each pair, then re-run.', v_dupes;
  end if;

  select string_agg(format('login email %s → %s', le, names), '; ')
    into v_dupes
    from (select lower(login_email) as le, string_agg(name, ' / ') as names
            from user_accounts
           where login_email is not null and not coalesce(is_deleted, false)
           group by lower(login_email) having count(*) > 1) d;
  if v_dupes is not null then
    raise exception
      'Two or more LIVE accounts share a login email, so the unique index '
      'cannot be built: %. Correct one of each pair, then re-run.', v_dupes;
  end if;
end $$;

-- ── 2. Rebuild both indexes, ignoring deleted rows ──────────────────────────
-- Dropped and recreated rather than altered: a partial index's predicate cannot
-- be changed in place.
drop index if exists user_accounts_mobile_norm_key;
create unique index user_accounts_mobile_norm_key
  on user_accounts (mobile_norm)
  where mobile_norm is not null and is_deleted = false;

drop index if exists user_accounts_login_email_key;
create unique index user_accounts_login_email_key
  on user_accounts (lower(login_email))
  where login_email is not null and is_deleted = false;

-- ── 3. Keep the historical rows findable ────────────────────────────────────
-- The partial indexes above no longer cover deleted rows, so recovery lookups
-- ("who used to have this number?") would fall back to a sequential scan.
create index if not exists user_accounts_deleted_mobile_idx
  on user_accounts (mobile_norm) where is_deleted = true;
create index if not exists user_accounts_deleted_login_email_idx
  on user_accounts (lower(login_email)) where is_deleted = true;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   Identifiers now free because they belong only to deleted accounts:
--     select mobile_norm, login_email, name, deleted_at
--       from user_accounts u
--      where is_deleted
--        and not exists (select 1 from user_accounts l
--                         where not l.is_deleted
--                           and (l.mobile_norm = u.mobile_norm
--                             or lower(l.login_email) = lower(u.login_email)))
--      order by deleted_at desc;
--
--   Prove the invariant — no live pair shares an identifier (both expect 0):
--     select count(*) from (select mobile_norm from user_accounts
--       where mobile_norm is not null and not is_deleted
--       group by mobile_norm having count(*) > 1) d;
--     select count(*) from (select lower(login_email) from user_accounts
--       where login_email is not null and not is_deleted
--       group by lower(login_email) having count(*) > 1) d;
--
--   A number reused across a delete → recreate (expect 2 rows, 1 live):
--     select name, mobile_norm, is_deleted, is_active, created_at
--       from user_accounts where mobile_norm = '9876543210' order by created_at;
