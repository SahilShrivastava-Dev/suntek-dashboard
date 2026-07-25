-- ═══════════════════════════════════════════════════════════════════════════
-- 54_rollback_stock_anomalies.sql — undo 54_stock_anomaly_resolutions.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- WARNING: drops all anomaly review state + history. Anomalies themselves are
-- computed from store_stock_months and reappear unaffected.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.resolve_stock_anomaly(jsonb);
drop table if exists store_stock_anomaly_events cascade;
drop table if exists store_stock_anomalies cascade;

update roles
   set capabilities = array_remove(capabilities, 'resolve_stock_anomaly')
 where 'resolve_stock_anomaly' = any(capabilities);

notify pgrst, 'reload schema';
