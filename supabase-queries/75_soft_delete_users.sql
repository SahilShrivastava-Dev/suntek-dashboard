-- ═══════════════════════════════════════════════════════════════════════════
-- 75_soft_delete_users.sql — an admin can delete a user profile, reversibly
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds a Delete action to User Management. The record is RETAINED in the
-- database for audit and recovery; the application treats the user as gone.
--
--   is_deleted   boolean   — the flag every read filters on
--   deleted_at   timestamptz
--   deleted_by   uuid      — the admin who did it
--
-- ═══ WHY THIS IS ENFORCED IN RLS, NOT IN THE QUERIES ════════════════════════
-- Nine files read user_accounts today: the login path, RoleContext,
-- PlantScopeContext, the mention picker, Cmd+K search, three night-duty screens
-- and the PM importer. Filtering in each one means nine chances to miss a spot
-- now, and a tenth every time someone adds a query later — a deleted user
-- reappearing in a technician dropdown months from now, with nothing to catch it.
--
-- One policy change hides the row from every existing read AND every future one.
-- The client's requirement is exactly this: "Deleted users should be excluded
-- from normal frontend and API responses unless specifically requested for
-- administrative, audit, or recovery purposes." The service role bypasses RLS,
-- so the SQL editor remains the recovery path (see the diagnostics below).
--
-- ⚠️ THE RISK, AND WHY IT IS CONTAINED
-- This policy is on the LOGIN path: useAuth.ts reads user_accounts with the
-- ANON key, BEFORE sign-in, to resolve a phone/email to its login email. Break
-- it and nobody can sign in. So the policy stays exactly as permissive as it was
-- (`using (true)`) for every live row, and narrows ONLY the deleted ones:
--
--     before:  using (true)
--     after :  using (coalesce(is_deleted, false) = false)
--
-- `with check` deliberately stays `true` — narrowing it would block the very
-- UPDATE that sets is_deleted, and would also break the existing self-service
-- profile edits.
--
-- A deleted user being invisible to that lookup is the DESIRED behaviour: they
-- can no longer sign in, and any live session resolves to no directory row and
-- therefore no scope. The RPC also clears is_active as a belt-and-braces second
-- lock, so the pre-existing "inactive users can't log in" check catches them too.
--
-- Requires 09 (user_accounts), 21 (user_account_events), 32 (has_capability).
-- Idempotent. Reversible via 75_rollback_soft_delete_users.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.user_accounts') is null then
    raise exception '09_user_accounts.sql has not been applied.';
  end if;
  if to_regclass('public.user_account_events') is null then
    raise exception '21_user_account_events.sql has not been applied.';
  end if;
  if to_regprocedure('public.has_capability(text)') is null then
    raise exception '32_roles_rls.sql has not been applied (no has_capability).';
  end if;
end $$;

-- ── 1. The columns ──────────────────────────────────────────────────────────
alter table user_accounts add column if not exists is_deleted boolean not null default false;
alter table user_accounts add column if not exists deleted_at timestamptz;
alter table user_accounts add column if not exists deleted_by uuid references user_accounts(id) on delete set null;

-- Partial index: every read now carries `is_deleted = false`, and the deleted
-- set stays small, so only the live rows are worth indexing.
create index if not exists user_accounts_live_idx on user_accounts (id) where is_deleted = false;

-- ── 2. Hide deleted rows from the API ───────────────────────────────────────
-- Replaces the wide-open policy with one that is equally wide open for live
-- rows. Nothing else about access changes.
alter table user_accounts enable row level security;
drop policy if exists "anon_all" on user_accounts;
create policy "anon_all" on user_accounts for all
  using (coalesce(is_deleted, false) = false)
  with check (true);

-- ── 3. The delete itself ────────────────────────────────────────────────────
-- SECURITY DEFINER so it can write the row it is about to make invisible, and
-- so the capability check cannot be bypassed by calling the table directly.
--
-- No password step-up: the client asked explicitly for the confirmation dialog
-- NOT to require a password. The capability gate plus the audit row are the
-- controls here.
create or replace function public.soft_delete_user(
  p_user_id    uuid,
  p_actor_name text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_row        user_accounts%rowtype;
  v_actor      uuid;
  v_actor_name text;
  v_admins     integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- "The Delete option should be available only to administrators with the
  -- required permission." Admin roles satisfy this implicitly via is_admin.
  if not public.has_capability('delete_user') then
    raise exception 'forbidden: missing capability delete_user';
  end if;

  -- Lock the row: two admins deleting the same profile would otherwise both
  -- write an audit entry claiming to have done it.
  select * into v_row from user_accounts where id = p_user_id for update;
  if not found then
    raise exception 'unknown_user: %', p_user_id;
  end if;
  if v_row.is_deleted then
    raise exception 'already_deleted: this user has already been deleted';
  end if;

  select ua.id, ua.name into v_actor, v_actor_name
    from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;

  -- Deleting yourself would remove your own access mid-action and, if you are
  -- the only admin, lock the organisation out of User Management entirely.
  if v_actor is not null and v_actor = p_user_id then
    raise exception 'self_delete: you cannot delete your own profile';
  end if;

  -- Never allow the last admin to be removed. `roles.is_admin` is the source of
  -- truth; both the legacy single role_id and the multi-role user_roles table
  -- are counted, because either can make someone an admin.
  select count(distinct ua.id) into v_admins
    from user_accounts ua
    left join user_roles ur on ur.user_account_id = ua.id
    left join roles r1 on r1.id = ur.role_id
    left join roles r2 on r2.id = ua.role_id
   where coalesce(ua.is_deleted, false) = false
     and coalesce(ua.is_active, true)
     and (coalesce(r1.is_admin, false) or coalesce(r2.is_admin, false));

  if v_admins <= 1 and exists (
        select 1 from user_accounts ua
        left join user_roles ur on ur.user_account_id = ua.id
        left join roles r1 on r1.id = ur.role_id
        left join roles r2 on r2.id = ua.role_id
         where ua.id = p_user_id
           and (coalesce(r1.is_admin, false) or coalesce(r2.is_admin, false))) then
    raise exception 'last_admin: this is the only administrator left and cannot be deleted';
  end if;

  -- ── Mark it deleted ───────────────────────────────────────────────────────
  -- is_active is cleared too. The row is already invisible via RLS, but the
  -- pre-existing "inactive users can't log in" check is a second, independent
  -- lock — worth having on the one operation that revokes someone's access.
  update user_accounts
     set is_deleted = true,
         deleted_at = now(),
         deleted_by = v_actor,
         is_active  = false
   where id = p_user_id;

  -- ── Audit ─────────────────────────────────────────────────────────────────
  -- Written to the SAME log the profile History panel reads, so a deletion sits
  -- in the record beside every other change made to that profile.
  insert into user_account_events
    (user_account_id, target_name, target_email, action, details, actor_name, actor_role)
  values
    (p_user_id, v_row.name, coalesce(v_row.email, v_row.login_email), 'deleted',
     format('Profile deleted (soft) — hidden from the app, record retained. Role: %s, factory: %s',
            coalesce(v_row.role_id, '—'), coalesce(v_row.plant_name, '—')),
     coalesce(nullif(btrim(coalesce(p_actor_name, '')), ''), v_actor_name, 'Unknown'),
     null);

  return jsonb_build_object(
    'ok', true, 'id', p_user_id, 'name', v_row.name, 'deleted_at', now());
end $$;

-- ── 4. Restore, for the recovery path the requirement allows ─────────────────
create or replace function public.restore_deleted_user(p_user_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_row user_accounts%rowtype; v_actor_name text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_capability('delete_user') then
    raise exception 'forbidden: missing capability delete_user';
  end if;

  select * into v_row from user_accounts where id = p_user_id for update;
  if not found then raise exception 'unknown_user: %', p_user_id; end if;
  if not v_row.is_deleted then
    raise exception 'not_deleted: this user is not deleted';
  end if;

  select ua.name into v_actor_name from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;

  -- is_active is deliberately NOT restored. Bringing someone back should not
  -- silently re-grant them a login; an admin re-activates explicitly.
  update user_accounts
     set is_deleted = false, deleted_at = null, deleted_by = null
   where id = p_user_id;

  insert into user_account_events
    (user_account_id, target_name, target_email, action, details, actor_name)
  values (p_user_id, v_row.name, coalesce(v_row.email, v_row.login_email), 'restored',
          'Profile restored from deleted. Still inactive — re-activate to grant a login.',
          coalesce(v_actor_name, 'Unknown'));

  return jsonb_build_object('ok', true, 'id', p_user_id, 'name', v_row.name);
end $$;

revoke all on function public.soft_delete_user(uuid, text)   from public, anon;
revoke all on function public.restore_deleted_user(uuid)     from public, anon;
grant execute on function public.soft_delete_user(uuid, text) to authenticated;
grant execute on function public.restore_deleted_user(uuid)   to authenticated;

-- ── 5. Who may delete ───────────────────────────────────────────────────────
-- Granted to NO role explicitly. Admin roles satisfy has_capability() via
-- is_admin (32), which is the "administrators with the required permission" the
-- requirement asks for. An admin can delegate it from the Role editor.

notify pgrst, 'reload schema';

-- ── Diagnostics / recovery ──────────────────────────────────────────────────
--   Deleted profiles (run as service role — RLS hides them from the app):
--     select id, name, email, deleted_at,
--            (select name from user_accounts a where a.id = u.deleted_by) as deleted_by
--       from user_accounts u where is_deleted order by deleted_at desc;
--
--   Restore one through the app's own guard rails:
--     select public.restore_deleted_user('<user-uuid>');
--
--   Or by hand, if you have no admin session:
--     update user_accounts set is_deleted = false, deleted_at = null, deleted_by = null
--      where id = '<user-uuid>';
--
--   Deletions in the audit log (also shown in the profile History panel):
--     select created_at, target_name, action, details, actor_name
--       from user_account_events where action in ('deleted','restored')
--      order by created_at desc;
--
--   Sanity — live admins remaining (must never reach 0):
--     select count(distinct ua.id) from user_accounts ua
--       left join user_roles ur on ur.user_account_id = ua.id
--       left join roles r1 on r1.id = ur.role_id
--       left join roles r2 on r2.id = ua.role_id
--      where not coalesce(ua.is_deleted,false) and coalesce(ua.is_active,true)
--        and (coalesce(r1.is_admin,false) or coalesce(r2.is_admin,false));
