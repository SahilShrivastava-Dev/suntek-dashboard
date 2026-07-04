-- ═══════════════════════════════════════════════════════════════════════════
-- 37_rollback_store_stock.sql — EMERGENCY REVERT of 37_store_stock.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Drops the store stock ledger tables and the activity_logs.note column.
-- Run in the SQL editor if the store stock feature misbehaves.
-- ═══════════════════════════════════════════════════════════════════════════

drop table if exists store_stock_events  cascade;
drop table if exists store_items         cascade;
drop table if exists store_stock_months  cascade;
drop table if exists store_stock_uploads cascade;

alter table activity_logs drop column if exists note;

notify pgrst, 'reload schema';
