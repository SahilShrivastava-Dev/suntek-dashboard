-- ═══════════════════════════════════════════════════════════════════════════
-- 65_rollback_tag_events_and_requests.sql — undo 65
-- ═══════════════════════════════════════════════════════════════════════════
-- Drops the two guard triggers. The backfilled values are LEFT IN PLACE: they
-- are correct attributions derived from the row's own factory, ticket or
-- register item, and blanking them would only lose information.
--
-- ⚠️ Once these triggers are gone, apply_stock_purchase(), apply_repair_return()
-- and record_defective_disposition() go back to writing stock movements with no
-- store_id / requesting_plant_id, and the split-fulfilment path goes back to
-- creating part requests with no source store. Those rows are invisible to the
-- per-factory reconciliation report. Only roll this back alongside 59/62.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger  if exists store_stock_events_fill_scope on store_stock_events;
drop function if exists public.store_stock_events_fill_scope();

drop trigger  if exists msr_fill_source_store on maintenance_store_requests;
drop function if exists public.msr_fill_source_store();

notify pgrst, 'reload schema';
