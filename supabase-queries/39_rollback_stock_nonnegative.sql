-- 39_rollback_stock_nonnegative.sql — drop the on_hand >= 0 constraint.
alter table store_items drop constraint if exists store_items_on_hand_nonneg;
notify pgrst, 'reload schema';
