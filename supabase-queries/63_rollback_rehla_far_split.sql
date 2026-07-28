-- ═══════════════════════════════════════════════════════════════════════════
-- 63_rollback_rehla_far_split.sql — undo the Rehla FAR fixture
-- ═══════════════════════════════════════════════════════════════════════════
-- Puts every asset, preventive schedule and ticket back on the factory it was
-- on before 63 dealt them out. Run this before applying the client's real
-- ownership split, so the fixture cannot be mistaken for it.
--
-- Rows created AFTER 63 ran are left alone — they are not in the snapshot and
-- this rollback never moves what it did not move.
--
-- Ticket unit_id values cleared by 63 are NOT restored: the Chlorides /
-- Plasticiser sub-units are retired (their meaning now lives in the factory
-- itself), so re-pointing tickets at them would reintroduce a dead dimension.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_n bigint;
begin
  if to_regclass('public.far_split_pre63_backup') is null then
    raise exception 'far_split_pre63_backup is missing — 63 has not been run.';
  end if;

  update fixed_assets fa
     set plant_id = b.orig_plant_id
    from far_split_pre63_backup b
   where fa.id = b.asset_id and fa.plant_id is distinct from b.orig_plant_id;
  get diagnostics v_n = row_count;
  raise notice 'Restored % asset(s).', v_n;

  update maintenance_schedules ms
     set plant_id = b.orig_plant_id
    from sched_split_pre63_backup b
   where ms.id = b.schedule_id and ms.plant_id is distinct from b.orig_plant_id;
  get diagnostics v_n = row_count;
  raise notice 'Restored % schedule(s).', v_n;

  update maintenance_tickets mt
     set plant_id = b.orig_plant_id
    from ticket_split_pre63_backup b
   where mt.id = b.ticket_id and mt.plant_id is distinct from b.orig_plant_id;
  get diagnostics v_n = row_count;
  raise notice 'Restored % ticket(s).', v_n;
end $$;

drop table if exists far_split_pre63_backup;
drop table if exists sched_split_pre63_backup;
drop table if exists ticket_split_pre63_backup;

notify pgrst, 'reload schema';
