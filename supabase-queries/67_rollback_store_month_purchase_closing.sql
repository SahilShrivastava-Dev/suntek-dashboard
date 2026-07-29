-- ═══════════════════════════════════════════════════════════════════════════
-- 67_rollback_store_month_purchase_closing.sql — undo 67
-- ═══════════════════════════════════════════════════════════════════════════
-- Purely additive column; dropping it loses only the Purchase sheet's stated
-- closing, which can be re-derived as purchase_opening + purchased for all but
-- a handful of hand-edited rows.
--
-- ⚠️ Revert the matching frontend too: the reconciliation anomaly reads this
-- column, and without it the Anomaly panel falls back to the approximation.
-- ═══════════════════════════════════════════════════════════════════════════

alter table store_stock_months drop column if exists purchase_closing;

notify pgrst, 'reload schema';
