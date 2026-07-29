-- ═══════════════════════════════════════════════════════════════════════════
-- 68_reset_far_and_stock_TESTING_ONLY.sql   ⚠️ DESTRUCTIVE — TEST DATA ONLY
-- ═══════════════════════════════════════════════════════════════════════════
-- Empties the Fixed Asset Register and the whole Stock Register so a fresh
-- upload can be tested against the corrected import logic.
--
-- ═══ WHY THIS IS NOT PART OF MIGRATION 67 ═══════════════════════════════════
-- 67 is a schema migration: additive, idempotent, safe to re-run, and it will
-- be run on every environment including production. A data wipe bundled into it
-- would delete a live register the next time anyone replayed the migration
-- list. Destructive operations get their own file, their own name, and their
-- own confirmation. This one is deliberately awkward to run by accident.
--
-- ═══ IT WILL NOT RUN UNTIL YOU SAY SO ═══════════════════════════════════════
-- Set v_i_understand := true on the marked line below. Left alone, the script
-- reports what it WOULD delete and changes nothing — run it once as-is first
-- and read the counts.
--
-- ═══ WHAT IT DELETES ════════════════════════════════════════════════════════
--   Stock:  store_items · store_stock_events · store_stock_months ·
--           store_stock_uploads · store_stock_anomalies (+ events) ·
--           stock_purchase_receipts (+ lines) · repair_return_receipts (+ allocations)
--   FAR:    fixed_assets
--
-- ═══ WHAT IT KEEPS ══════════════════════════════════════════════════════════
--   Factories, locations, stores, factory_store_access, users and their access,
--   roles, tiers, maintenance tickets, schedules and their history.
--
-- ⚠️ SIDE EFFECT ON MAINTENANCE: maintenance_tickets.far_asset_id and
--    maintenance_schedules.far_asset_id are ON DELETE SET NULL, so clearing the
--    FAR unlinks every ticket and PM schedule from its asset. The tickets
--    survive; the link does not, and re-importing the FAR will NOT restore it
--    (new rows get new ids). The counts below tell you how many links you are
--    about to lose.
--
-- Everything is copied to *_pre68_backup tables first, so a mistake is
-- recoverable via 68_rollback_reset_far_and_stock.sql.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  -- ┌──────────────────────────────────────────────────────────────────────┐
  -- │  CHANGE THIS TO true TO ACTUALLY DELETE.  Leave false to dry-run.    │
  v_i_understand boolean := false;
  -- └──────────────────────────────────────────────────────────────────────┘
  v_tbl        text;
  v_n          bigint;
  v_assets     bigint;
  v_tickets    bigint;
  v_scheds     bigint;
  v_tables     constant text[] := array[
    -- children first, then parents
    'store_stock_anomaly_events', 'store_stock_anomalies',
    'stock_purchase_lines',       'stock_purchase_receipts',
    'repair_return_allocations',  'repair_return_receipts',
    'store_stock_events',         'store_stock_months',
    'store_stock_uploads',        'store_items',
    'fixed_assets'
  ];
begin
  -- ── What is here right now ────────────────────────────────────────────────
  raise notice '─────────────────────────────────────────────';
  raise notice 'CURRENT CONTENTS';
  foreach v_tbl in array v_tables loop
    if to_regclass('public.' || v_tbl) is null then
      raise notice '  %-30s (table not present)', v_tbl;
      continue;
    end if;
    execute format('select count(*) from %I', v_tbl) into v_n;
    raise notice '  %-30s %s row(s)', v_tbl, v_n;
  end loop;

  select count(*) into v_assets  from fixed_assets;
  select count(*) into v_tickets from maintenance_tickets   where far_asset_id is not null;
  select count(*) into v_scheds  from maintenance_schedules where far_asset_id is not null;
  raise notice '─────────────────────────────────────────────';
  raise notice 'MAINTENANCE LINKS THAT WILL BE BROKEN';
  raise notice '  % ticket(s) and % schedule(s) currently point at one of the % asset(s).',
               v_tickets, v_scheds, v_assets;
  raise notice '  Those rows SURVIVE, but lose their asset link permanently.';
  raise notice '─────────────────────────────────────────────';

  if not v_i_understand then
    raise notice 'DRY RUN — nothing deleted.';
    raise notice 'To proceed: set  v_i_understand := true  near the top and re-run.';
    return;
  end if;

  -- ── Back everything up before touching it ─────────────────────────────────
  foreach v_tbl in array v_tables loop
    if to_regclass('public.' || v_tbl) is null then continue; end if;
    if to_regclass('public.' || v_tbl || '_pre68_backup') is null then
      execute format('create table %I as select * from %I', v_tbl || '_pre68_backup', v_tbl);
    end if;
  end loop;
  -- The links themselves, so the rollback can restore them.
  create table if not exists far_links_pre68_backup as
    select 'ticket'::text as kind, id as row_id, far_asset_id from maintenance_tickets   where far_asset_id is not null
    union all
    select 'schedule',              id,          far_asset_id from maintenance_schedules where far_asset_id is not null;

  -- ── Delete, children before parents ───────────────────────────────────────
  foreach v_tbl in array v_tables loop
    if to_regclass('public.' || v_tbl) is null then continue; end if;
    execute format('delete from %I', v_tbl);
    get diagnostics v_n = row_count;
    raise notice 'cleared %-30s % row(s)', v_tbl, v_n;
  end loop;

  raise notice '─────────────────────────────────────────────';
  raise notice 'DONE. Upload a FAR and a Store Keeping workbook to start fresh.';
  raise notice 'Backups kept in *_pre68_backup — drop them once you are happy.';
end $$;

notify pgrst, 'reload schema';

-- ── After running, expect zeros ─────────────────────────────────────────────
--   select 'store_items' t, count(*) from store_items
--   union all select 'store_stock_months', count(*) from store_stock_months
--   union all select 'store_stock_uploads', count(*) from store_stock_uploads
--   union all select 'fixed_assets', count(*) from fixed_assets;
--
-- ── Drop the backups when the test is finished ──────────────────────────────
--   drop table if exists store_items_pre68_backup, store_stock_events_pre68_backup,
--     store_stock_months_pre68_backup, store_stock_uploads_pre68_backup,
--     store_stock_anomalies_pre68_backup, store_stock_anomaly_events_pre68_backup,
--     stock_purchase_receipts_pre68_backup, stock_purchase_lines_pre68_backup,
--     repair_return_receipts_pre68_backup, repair_return_allocations_pre68_backup,
--     fixed_assets_pre68_backup, far_links_pre68_backup;
