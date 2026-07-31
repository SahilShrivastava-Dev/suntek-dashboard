-- ═══════════════════════════════════════════════════════════════════════════
-- 78_rollback_remove_seed_demo_data.sql — restore the seeded demo rows
-- ═══════════════════════════════════════════════════════════════════════════
-- Puts back exactly what 78 removed, from its *_pre78_backup snapshots.
-- Parents before children, so batch_readings have a batch to attach to.
-- Rows created since are untouched; `on conflict do nothing` makes it safe to
-- re-run.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_n bigint;
begin
  if to_regclass('public.active_batches_pre78_backup') is null
     and to_regclass('public.anomaly_flags_pre78_backup') is null then
    raise exception '78 has not been run (no backups) — there is nothing to restore.';
  end if;

  if to_regclass('public.active_batches_pre78_backup') is not null then
    insert into active_batches select * from active_batches_pre78_backup
      on conflict (id) do nothing;
    get diagnostics v_n = row_count;
    raise notice 'Restored % batch(es).', v_n;
  end if;

  if to_regclass('public.batch_readings_pre78_backup') is not null then
    insert into batch_readings select * from batch_readings_pre78_backup
      on conflict (id) do nothing;
    get diagnostics v_n = row_count;
    raise notice 'Restored % batch reading(s).', v_n;
  end if;

  if to_regclass('public.anomaly_flags_pre78_backup') is not null then
    insert into anomaly_flags select * from anomaly_flags_pre78_backup
      on conflict (id) do nothing;
    get diagnostics v_n = row_count;
    raise notice 'Restored % anomaly flag(s).', v_n;
  end if;
end $$;

select 'batches restored' as item, count(*)::text as value
  from active_batches where plant_id is null and operator_id is null
union all select 'anomaly flags restored',
  (select count(*)::text from anomaly_flags
    where created_at = timestamptz '2026-06-16 07:28:02.065105+00');
