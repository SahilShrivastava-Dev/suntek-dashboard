-- ═══════════════════════════════════════════════════════════════════════════
-- 74_rollback_pm_schedule_delete_fk.sql — restore the blocking FK
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ REVERTING RE-INTRODUCES THE BUG 74 FIXED: deleting a Maintenance Schedules
-- upload will again fail with "violates foreign key constraint
-- maintenance_tickets_schedule_id_fkey", after the dialog has already told the
-- admin how many records it was about to remove.
--
-- Restores maintenance_tickets.schedule_id to a plain FK with NO ON DELETE
-- action, matching 08_maintenance.sql.
--
-- The preview function is left as 74 wrote it. Reporting the tickets that would
-- be affected is accurate under either constraint — and under the restored one
-- it is the only warning an admin gets before the delete fails.
--
-- Tickets already unlinked by a forced deletion are NOT re-linked: their
-- schedules no longer exist. Nothing can restore that.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_con text;
begin
  select con.conname into v_con
    from pg_constraint con
    join pg_attribute a
      on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
   where con.conrelid  = 'maintenance_tickets'::regclass
     and con.contype   = 'f'
     and con.confrelid = 'maintenance_schedules'::regclass
     and a.attname     = 'schedule_id'
   limit 1;

  if v_con is null then
    raise notice 'No FK from maintenance_tickets.schedule_id found — nothing to undo.';
    return;
  end if;
  if exists (select 1 from pg_constraint
              where conname = v_con and conrelid = 'maintenance_tickets'::regclass
                and confdeltype = 'a') then
    raise notice 'FK % is already NO ACTION — 74 has not been applied.', v_con;
    return;
  end if;

  execute format('alter table maintenance_tickets drop constraint %I', v_con);
  alter table maintenance_tickets
    add constraint maintenance_tickets_schedule_id_fkey
    foreign key (schedule_id) references maintenance_schedules(id);
  raise notice 'FK % restored to NO ACTION (deletes will block again).', v_con;
end $$;

notify pgrst, 'reload schema';

-- Verify: confdeltype 'a' = NO ACTION (blocking), 'n' = SET NULL.
--   select conname, confdeltype from pg_constraint
--    where conrelid = 'maintenance_tickets'::regclass
--      and confrelid = 'maintenance_schedules'::regclass;
