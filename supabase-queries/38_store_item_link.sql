-- ═══════════════════════════════════════════════════════════════════════════
-- 38_store_item_link.sql — link a maintenance store request to a store_items row
-- ═══════════════════════════════════════════════════════════════════════════
-- The technician now picks the part from the plant's stock register (type-ahead).
-- Storing which store_items row was chosen lets us (a) show consumption in the
-- register and (b) decrement on-hand when the part is handed over. Nullable —
-- free-text parts (not in the register / to be procured) simply leave it null.
-- Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

alter table maintenance_store_requests
  add column if not exists store_item_id uuid references store_items(id) on delete set null;

notify pgrst, 'reload schema';
