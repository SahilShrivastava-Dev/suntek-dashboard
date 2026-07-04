-- ═══════════════════════════════════════════════════════════════════════════
-- 39_stock_nonnegative.sql — inventory can NEVER go below zero
-- ═══════════════════════════════════════════════════════════════════════════
-- Belt-and-suspenders for the partial-fulfilment change: the app now splits a
-- request into "issue what's in stock" + "procure the shortfall", and clamps the
-- handover decrement. This constraint is the last line of defence — any write
-- that would push on_hand negative is rejected by the database.
--
-- First normalises any already-negative rows (from the pre-fix bug), then adds
-- the CHECK. Idempotent. Reversible via 39_rollback_stock_nonnegative.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- Normalise rows that went negative: cap issued at what was actually available
-- so the baseline/procured/issued breakdown balances, then zero the on_hand.
update store_items
   set issued_qty = greatest(0, baseline_qty + procured_qty + manual_delta)
 where on_hand < 0;
update store_items set on_hand = 0 where on_hand < 0;

alter table store_items drop constraint if exists store_items_on_hand_nonneg;
alter table store_items add constraint store_items_on_hand_nonneg check (on_hand >= 0);

notify pgrst, 'reload schema';
