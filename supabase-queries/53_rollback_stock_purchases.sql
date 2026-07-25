-- ═══════════════════════════════════════════════════════════════════════════
-- 53_rollback_stock_purchases.sql — undo 53_stock_purchases.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- WARNING: drops the purchase receipt/line history. Stock increments already
-- applied to store_items are NOT undone (they are legitimate stock).
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.apply_stock_purchase(jsonb);
drop table if exists stock_purchase_lines cascade;
drop table if exists stock_purchase_receipts cascade;

update roles
   set capabilities = array_remove(capabilities, 'add_stock_purchase')
 where 'add_stock_purchase' = any(capabilities);

notify pgrst, 'reload schema';
