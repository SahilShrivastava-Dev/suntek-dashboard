-- ═══════════════════════════════════════════════════════════════════════════
-- 66_rollback_unit_store_manager_roles.sql — undo 66
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores store_manager_chlorides and store_manager_plasticiser exactly as
-- they were, from the snapshot 66 took before deleting them.
--
-- ⚠️ Restoring the ROLE rows does not restore the ROUTING: the frontend no
-- longer maps a ticket's unit to a unit-flavoured store manager, and the unit
-- selector is gone, so these roles would exist but never be notified. Revert
-- the matching frontend commit alongside this if you genuinely need the old
-- behaviour back.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_n bigint;
begin
  if to_regclass('public.roles_pre66_backup') is null then
    raise exception 'roles_pre66_backup is missing — 66 has not been run.';
  end if;

  insert into roles (id, label, level, description, home_route, allowed_routes,
                     standalone_only, is_admin, is_system, capabilities,
                     avatar_from, avatar_to, sort_order)
  select b.id, b.label, b.level, b.description, b.home_route, b.allowed_routes,
         b.standalone_only, b.is_admin, b.is_system, b.capabilities,
         b.avatar_from, b.avatar_to, b.sort_order
    from roles_pre66_backup b
   where not exists (select 1 from roles r where r.id = b.id)
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;

  raise notice 'Restored % unit store-manager role(s).', v_n;
end $$;

notify pgrst, 'reload schema';

-- Verify, then drop the snapshot:
--   select id, label from roles where id like 'store_manager%';
--   drop table if exists roles_pre66_backup;
