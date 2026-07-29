-- ═══════════════════════════════════════════════════════════════════════════
-- 68_rollback_reset_far_and_stock.sql — put back what 68 deleted
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores every table from its *_pre68_backup copy, parents before children so
-- foreign keys resolve, and re-links the maintenance tickets and PM schedules
-- that lost their far_asset_id.
--
-- Only rows that are ABSENT are re-inserted, so anything created since the
-- reset is left alone — re-running this after a fresh test upload will not
-- clobber the new data, it will merge the old rows back alongside it. If you
-- want a clean restore, empty the tables first.
--
-- ⚠️ If you have already re-imported a FAR, restoring the old assets brings
--    back duplicates of anything present in both. Check before running.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_tbl   text;
  v_n     bigint;
  -- parents first this time, so children have something to reference
  v_order constant text[] := array[
    'fixed_assets',
    'store_items',                'store_stock_uploads',
    'store_stock_months',         'store_stock_events',
    'stock_purchase_receipts',    'stock_purchase_lines',
    'repair_return_receipts',     'repair_return_allocations',
    'store_stock_anomalies',      'store_stock_anomaly_events'
  ];
begin
  if to_regclass('public.fixed_assets_pre68_backup') is null
     and to_regclass('public.store_items_pre68_backup') is null then
    raise exception '68 has not been run — there is nothing to restore.';
  end if;

  foreach v_tbl in array v_order loop
    if to_regclass('public.' || v_tbl) is null
       or to_regclass('public.' || v_tbl || '_pre68_backup') is null then
      continue;
    end if;
    execute format(
      'insert into %I select b.* from %I b where not exists (select 1 from %I t where t.id = b.id)',
      v_tbl, v_tbl || '_pre68_backup', v_tbl);
    get diagnostics v_n = row_count;
    if v_n > 0 then raise notice 'restored %-30s % row(s)', v_tbl, v_n; end if;
  end loop;

  -- Re-link maintenance to its assets.
  if to_regclass('public.far_links_pre68_backup') is not null then
    update maintenance_tickets t set far_asset_id = b.far_asset_id
      from far_links_pre68_backup b
     where b.kind = 'ticket' and t.id = b.row_id and t.far_asset_id is null
       and exists (select 1 from fixed_assets fa where fa.id = b.far_asset_id);
    get diagnostics v_n = row_count;
    raise notice 're-linked % ticket(s)', v_n;

    update maintenance_schedules s set far_asset_id = b.far_asset_id
      from far_links_pre68_backup b
     where b.kind = 'schedule' and s.id = b.row_id and s.far_asset_id is null
       and exists (select 1 from fixed_assets fa where fa.id = b.far_asset_id);
    get diagnostics v_n = row_count;
    raise notice 're-linked % schedule(s)', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
