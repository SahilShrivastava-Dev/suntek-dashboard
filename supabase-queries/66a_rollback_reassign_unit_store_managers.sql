-- ═══════════════════════════════════════════════════════════════════════════
-- 66a_rollback_reassign_unit_store_managers.sql — put the users back
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores each user to the unit-flavoured store-manager role they held before
-- 66a moved them, from the snapshot 66a took.
--
-- ⚠️ Run 66_rollback_unit_store_manager_roles.sql FIRST if 66 has since deleted
-- the role rows — a user cannot hold a role that no longer exists.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_missing text;
begin
  if to_regclass('public.user_role_pre66a_backup') is null then
    raise exception 'user_role_pre66a_backup is missing — 66a has not been run.';
  end if;

  select string_agg(distinct b.old_role_id, ', ') into v_missing
    from user_role_pre66a_backup b
   where not exists (select 1 from roles r where r.id = b.old_role_id);

  if v_missing is not null then
    raise exception
      'These roles no longer exist: %. Run 66_rollback_unit_store_manager_roles.sql first.',
      v_missing;
  end if;

  -- Restore the secondary assignments.
  insert into user_roles (user_account_id, role_id)
    select b.user_account_id, b.old_role_id
      from user_role_pre66a_backup b
     where b.source = 'user_roles'
  on conflict do nothing;

  -- Drop store_manager_maint ONLY where 66a actually added it. Anyone recorded
  -- as 'pre_existing_target' held it beforehand and must keep it — removing it
  -- would take away access they always had.
  delete from user_roles ur
   where ur.role_id = 'store_manager_maint'
     and exists (select 1 from user_role_pre66a_backup b
                  where b.user_account_id = ur.user_account_id and b.source = 'user_roles')
     and not exists (select 1 from user_role_pre66a_backup b2
                      where b2.user_account_id = ur.user_account_id
                        and b2.source = 'pre_existing_target');

  -- Restore the primary/display role.
  update user_accounts ua
     set role_id    = b.old_role_id,
         role_label = coalesce((select label from roles where id = b.old_role_id), ua.role_label),
         updated_at = now()
    from user_role_pre66a_backup b
   where ua.id = b.user_account_id and b.source = 'user_accounts.role_id';

  raise notice 'Restored the unit store-manager assignments.';
end $$;

notify pgrst, 'reload schema';

-- Verify, then drop the snapshot:
--   select ua.name, ua.role_id from user_accounts ua
--     join user_role_pre66a_backup b on b.user_account_id = ua.id;
--   drop table if exists user_role_pre66a_backup;
