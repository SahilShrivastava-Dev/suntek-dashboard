-- ═══════════════════════════════════════════════════════════════════════════
-- 67_store_month_purchase_closing.sql — persist the Purchase sheet's closing
-- ═══════════════════════════════════════════════════════════════════════════
-- The stock reconciliation check is, client-confirmed:
--
--     Sales "Op Stock"  ==  Purchase "Closing"      (same month)
--
-- The store team carries the Purchase closing across by hand into the next
-- Sales opening, so the two must agree; where they don't, something was
-- received or issued without being written down.
--
-- `store_stock_months` already keeps the Sales opening and the Purchase
-- OPENING, but not the Purchase CLOSING — so the Anomaly panel, which rebuilds
-- months from this table rather than from the file, had no way to apply the
-- rule. It could only approximate it as opening + purchased, which is right for
-- ~99.8% of rows and silently wrong for the rest (2 of ~1,700 in the client's
-- workbook state a closing that differs from their own arithmetic).
--
-- Backfilled from purchase_opening + purchased, which is what those sheets
-- compute. Re-uploading a workbook overwrites it with the sheet's stated value.
--
-- Additive and reversible. Requires 37 (store_stock_months).
-- Reversible via 67_rollback_store_month_purchase_closing.sql.
-- ═══════════════════════════════════════════════════════════════════════════

alter table store_stock_months
  add column if not exists purchase_closing numeric default 0;

comment on column store_stock_months.purchase_closing is
  'Purchase sheet "Closing" = purchase_opening + purchased = stock AVAILABLE that month. Compared against `opening` (Sales "Op Stock") for the reconciliation anomaly.';

-- Backfill existing snapshots with the Purchase sheet's own arithmetic.
update store_stock_months
   set purchase_closing = coalesce(purchase_opening, 0) + coalesce(purchased, 0)
 where purchase_closing is null or purchase_closing = 0;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   How many rows would the reconciliation flag, per month?
--     select period_month,
--            count(*)                                             as items,
--            count(*) filter (where opening <> purchase_closing)   as mismatches
--       from store_stock_months
--      group by period_month order by period_month;
--
--   The mismatching items in the latest month:
--     select item_name, opening as sales_opening, purchase_closing,
--            opening - purchase_closing as diff
--       from store_stock_months
--      where period_month = (select max(period_month) from store_stock_months)
--        and opening <> purchase_closing
--      order by abs(opening - purchase_closing) desc;
