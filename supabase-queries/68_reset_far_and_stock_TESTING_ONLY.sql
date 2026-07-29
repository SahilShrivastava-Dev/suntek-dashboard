-- ═══════════════════════════════════════════════════════════════════════════
-- 68_reset_far_and_stock_TESTING_ONLY.sql   ⚠️ DESTRUCTIVE — TEST DATA ONLY
-- ═══════════════════════════════════════════════════════════════════════════
-- Empties the Fixed Asset Register and the whole Stock Register so a fresh
-- upload can be tested against the corrected import logic.
--
-- ═══ HOW TO USE ═════════════════════════════════════════════════════════════
--   1. Run this file AS-IS. It deletes nothing and returns a table showing
--      what is currently there and what would be lost.
--   2. If you are happy, change the marked line to  := true  and run again.
--   3. The same table prints afterwards — all zeros means it worked.
--
--   The report is a RESULT SET, not RAISE NOTICE: the Supabase SQL editor
--   silently swallows notices, so a notice-based dry run tells you nothing
--   ("Success. No rows returned").
--
-- ═══ WHY THIS IS NOT PART OF MIGRATION 67 ═══════════════════════════════════
-- 67 is a schema migration: additive, idempotent, and it will run on every
-- environment including production. A data wipe bundled into it would delete a
-- live register the next time anyone replayed the migration list. Destructive
-- work gets its own file, its own name, and its own confirmation.
--
-- ═══ WHAT IT KEEPS ══════════════════════════════════════════════════════════
--   Factories, locations, stores, factory_store_access, users and their access,
--   roles, tiers, maintenance tickets, schedules and their history.
--
-- ⚠️ SIDE EFFECT: fixed_assets is ON DELETE SET NULL from
--    maintenance_tickets.far_asset_id and maintenance_schedules.far_asset_id,
--    so clearing the FAR unlinks every ticket and PM schedule from its asset.
--    The rows survive; the links do not, and re-importing will NOT restore them
--    (new rows get new ids). The report counts them under "links lost".
--
-- Everything is copied to *_pre68_backup first.
-- Reversible via 68_rollback_reset_far_and_stock.sql.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  -- ┌──────────────────────────────────────────────────────────────────────┐
  -- │  CHANGE false TO true TO ACTUALLY DELETE.  Leave false to dry-run.   │
  v_i_understand boolean := false;
  -- └──────────────────────────────────────────────────────────────────────┘
  v_tbl   text;
  v_tables constant text[] := array[
    -- children first, then parents
    'store_stock_anomaly_events', 'store_stock_anomalies',
    'stock_purchase_lines',       'stock_purchase_receipts',
    'repair_return_allocations',  'repair_return_receipts',
    'store_stock_events',         'store_stock_months',
    'store_stock_uploads',        'store_items',
    'fixed_assets'
  ];
begin
  if not v_i_understand then
    return;   -- dry run: the report below still prints
  end if;

  -- ── Back everything up before touching it ─────────────────────────────────
  foreach v_tbl in array v_tables loop
    if to_regclass('public.' || v_tbl) is null then continue; end if;
    if to_regclass('public.' || v_tbl || '_pre68_backup') is null then
      execute format('create table %I as select * from %I', v_tbl || '_pre68_backup', v_tbl);
    end if;
  end loop;
  -- The asset links themselves, so the rollback can restore them.
  create table if not exists far_links_pre68_backup as
    select 'ticket'::text as kind, id as row_id, far_asset_id from maintenance_tickets   where far_asset_id is not null
    union all
    select 'schedule',              id,          far_asset_id from maintenance_schedules where far_asset_id is not null;

  -- ── Delete, children before parents ───────────────────────────────────────
  foreach v_tbl in array v_tables loop
    if to_regclass('public.' || v_tbl) is null then continue; end if;
    execute format('delete from %I', v_tbl);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE REPORT — runs either way. Before: what you would lose.
--                                After: all zeros.
-- ═══════════════════════════════════════════════════════════════════════════
select 1 as ord, 'FAR'   as area, 'fixed_assets'                as item, count(*) as rows from fixed_assets
union all select 2, 'FAR',   '  └ ticket links lost',      count(*) from maintenance_tickets   where far_asset_id is not null
union all select 3, 'FAR',   '  └ PM schedule links lost', count(*) from maintenance_schedules where far_asset_id is not null
union all select 4, 'Stock', 'store_items',                count(*) from store_items
union all select 5, 'Stock', 'store_stock_months',         count(*) from store_stock_months
union all select 6, 'Stock', 'store_stock_uploads',        count(*) from store_stock_uploads
union all select 7, 'Stock', 'store_stock_events',         count(*) from store_stock_events
union all select 8, 'Stock', 'store_stock_anomalies',      count(*) from store_stock_anomalies
union all select 9, 'Stock', 'stock_purchase_receipts',    count(*) from stock_purchase_receipts
union all select 10,'Stock', 'repair_return_receipts',     count(*) from repair_return_receipts
union all select 11,'—',     'KEPT: factories',            count(*) from plants where is_active and is_factory
union all select 12,'—',     'KEPT: stores',               count(*) from stores where coalesce(is_active,true)
union all select 13,'—',     'KEPT: users',                count(*) from user_accounts
union all select 14,'—',     'KEPT: maintenance tickets',  count(*) from maintenance_tickets
order by ord;

-- ── Drop the backups when the test is finished ──────────────────────────────
--   drop table if exists store_items_pre68_backup, store_stock_events_pre68_backup,
--     store_stock_months_pre68_backup, store_stock_uploads_pre68_backup,
--     store_stock_anomalies_pre68_backup, store_stock_anomaly_events_pre68_backup,
--     stock_purchase_receipts_pre68_backup, stock_purchase_lines_pre68_backup,
--     repair_return_receipts_pre68_backup, repair_return_allocations_pre68_backup,
--     fixed_assets_pre68_backup, far_links_pre68_backup;
