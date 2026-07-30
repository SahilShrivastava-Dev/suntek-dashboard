-- ═══════════════════════════════════════════════════════════════════════════
-- 75_rollback_soft_delete_users.sql — remove user soft-delete
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores the wide-open user_accounts policy, drops the RPCs, and REVIVES every
-- soft-deleted user before dropping the columns — otherwise the flag disappears
-- and they silently reappear in the app as if nothing had happened, which is a
-- worse outcome than either state.
--
-- Deleted users are reported before being revived, and their is_active stays
-- false (that is how the RPC left them), so nobody regains a login just because
-- this file ran.
--
-- The 'deleted' / 'restored' rows in user_account_events are KEPT: they record
-- actions that really happened, and the History panel should not lose them.
-- ═══════════════════════════════════════════════════════════════════════════

select 'users about to be REVIVED by this rollback' as warning,
       count(*) as users,
       coalesce(string_agg(name, ', ' order by name), '—') as who
  from user_accounts where coalesce(is_deleted, false);

do $$
declare v_n bigint;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'user_accounts' and column_name = 'is_deleted') then
    raise notice '75 has not been applied (no is_deleted column). Nothing to undo.';
    return;
  end if;

  -- 1. Wide-open policy again, so no read depends on a column about to vanish.
  drop policy if exists "anon_all" on user_accounts;
  create policy "anon_all" on user_accounts for all using (true) with check (true);

  -- 2. Revive, keeping them inactive.
  update user_accounts set is_deleted = false, deleted_at = null, deleted_by = null
   where coalesce(is_deleted, false);
  get diagnostics v_n = row_count;
  raise notice 'Revived % previously-deleted user(s) — all still INACTIVE.', v_n;
end $$;

drop function if exists public.soft_delete_user(uuid, text);
drop function if exists public.restore_deleted_user(uuid);

drop index if exists user_accounts_live_idx;
alter table user_accounts drop column if exists deleted_by;
alter table user_accounts drop column if exists deleted_at;
alter table user_accounts drop column if exists is_deleted;

-- The capability is removed from any role that was granted it, so the Role
-- editor stops offering a power that no longer exists.
update roles set capabilities = array_remove(capabilities, 'delete_user')
 where 'delete_user' = any(capabilities);

notify pgrst, 'reload schema';

-- Verify:
--   select count(*) from information_schema.columns
--    where table_name='user_accounts' and column_name='is_deleted';   -- 0
--   select qual from pg_policies where tablename='user_accounts';     -- true
