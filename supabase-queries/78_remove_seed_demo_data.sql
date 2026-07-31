-- ═══════════════════════════════════════════════════════════════════════════
-- 78_remove_seed_demo_data.sql   ⚠️ DESTRUCTIVE — DRY RUN BY DEFAULT
-- ═══════════════════════════════════════════════════════════════════════════
-- Removes the seeded demo rows still showing on the client's production
-- dashboard: 4 phantom batches on Batch Sheet and 5 invented alerts on To-Do.
--
-- ═══ HOW TO USE ═════════════════════════════════════════════════════════════
--   1. Run AS-IS. Deletes nothing; prints exactly what would go.
--   2. If the list is right, change the marked line to := true and run again.
--   3. The same report prints after — all zeros means it worked.
--
-- ═══ WHAT IS *NOT* TOUCHED, AND WHY THAT MATTERS ════════════════════════════
-- maintenance_tickets is deliberately untouched. The two "Approvals pending"
-- items on To-Do look like demo data but are NOT: they are `type = periodic`,
-- `status = pending_unit_head`, with a schedule_id — AUTO-GENERATED preventive
-- maintenance from the PM workbooks the client imported, waiting for a unit head
-- to approve them. Deleting them would erase real scheduled work, and the
-- scheduler would regenerate it anyway. The way to clear those is to approve
-- them in Maintenance, or to remove the underlying schedule.
--
-- ═══ HOW THE SEED ROWS WERE IDENTIFIED ══════════════════════════════════════
-- active_batches — plant_id IS NULL *and* operator_id IS NULL. A batch created
--   through the app always carries a factory; that is why the UI falls back to
--   the label "Live Plant" for these. Matches all 4, including the duplicated
--   #1228 (same recipe, same target, inserted milliseconds apart).
--
-- anomaly_flags — every seeded row shares one exact insert timestamp, and they
--   reference SHD and Delhi, plants RETIRED by migration 58, plus a customer
--   that does not exist. Scoped on the timestamp rather than the plant name,
--   because three of the five name live factories.
--
-- Everything is copied to *_pre78_backup first.
-- Reversible via 78_rollback_remove_seed_demo_data.sql.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  -- ┌──────────────────────────────────────────────────────────────────────┐
  -- │  CHANGE false TO true TO ACTUALLY DELETE.  Leave false to dry-run.   │
  v_i_understand boolean := false;
  -- └──────────────────────────────────────────────────────────────────────┘
  v_seed_ts constant timestamptz := '2026-06-16 07:28:02.065105+00';
  v_n bigint;
begin
  if not v_i_understand then
    return;   -- dry run: the report below still prints
  end if;

  -- ── Back up before touching anything ──────────────────────────────────────
  if to_regclass('public.active_batches_pre78_backup') is null then
    create table active_batches_pre78_backup as
      select * from active_batches where plant_id is null and operator_id is null;
  end if;
  if to_regclass('public.anomaly_flags_pre78_backup') is null then
    create table anomaly_flags_pre78_backup as
      select * from anomaly_flags where created_at = v_seed_ts;
  end if;
  -- batch_readings cascade from active_batches, so snapshot them too or the
  -- rollback would restore batches with their readings silently missing.
  if to_regclass('public.batch_readings_pre78_backup') is null then
    create table batch_readings_pre78_backup as
      select r.* from batch_readings r
        join active_batches b on b.id = r.batch_id
       where b.plant_id is null and b.operator_id is null;
  end if;

  -- ── Delete ────────────────────────────────────────────────────────────────
  delete from active_batches where plant_id is null and operator_id is null;
  get diagnostics v_n = row_count;
  raise notice 'Removed % seeded batch(es) (readings cascaded).', v_n;

  delete from anomaly_flags where created_at = v_seed_ts;
  get diagnostics v_n = row_count;
  raise notice 'Removed % seeded anomaly flag(s).', v_n;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE REPORT — runs either way. Before: what would go. After: all zeros.
-- ═══════════════════════════════════════════════════════════════════════════
select 1 as ord, 'Batch Sheet' as area, 'seeded batches (no plant, no operator)' as item,
       (select count(*)::text from active_batches where plant_id is null and operator_id is null) as rows
union all select 2, 'Batch Sheet', '  └ their readings (cascade)',
       (select count(*)::text from batch_readings r join active_batches b on b.id = r.batch_id
         where b.plant_id is null and b.operator_id is null)
union all select 3, 'To-Do', 'seeded anomaly flags',
       (select count(*)::text from anomaly_flags
         where created_at = timestamptz '2026-06-16 07:28:02.065105+00')
union all select 4, '—', 'KEPT: real batches (with a factory)',
       (select count(*)::text from active_batches where plant_id is not null)
union all select 5, '—', 'KEPT: real anomaly flags',
       (select count(*)::text from anomaly_flags
         where created_at <> timestamptz '2026-06-16 07:28:02.065105+00')
union all select 6, '—', 'KEPT: maintenance tickets (incl. generated PM work)',
       (select count(*)::text from maintenance_tickets)
union all select 7, '—', 'KEPT: PM tickets awaiting approval',
       (select count(*)::text from maintenance_tickets where status = 'pending_unit_head')
order by ord;

-- ── Drop the backups when you are satisfied ─────────────────────────────────
--   drop table if exists active_batches_pre78_backup,
--     anomaly_flags_pre78_backup, batch_readings_pre78_backup;
