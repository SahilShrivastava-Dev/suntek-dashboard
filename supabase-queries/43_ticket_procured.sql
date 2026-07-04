-- ═══════════════════════════════════════════════════════════════════════════
-- 43_ticket_procured.sql — track units procured externally FOR a maintenance ticket
-- ═══════════════════════════════════════════════════════════════════════════
-- When a request is partially fulfilled, the shortfall is bought externally and
-- handed straight to the technician — it never enters the store, so on_hand stays
-- correct. But that procurement must still be VISIBLE against the item. This is a
-- purely informational counter (does NOT affect the on_hand math):
--     on_hand = baseline_qty + procured_qty − issued_qty + manual_delta
--     ticket_procured_qty = external units bought for tickets (audit only)
-- Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

alter table store_items
  add column if not exists ticket_procured_qty numeric not null default 0;

-- Backfill from history: sum the quantities of already-handed-over procurement
-- store requests linked to each item (so past partial-fulfilments show correctly).
update store_items si
   set ticket_procured_qty = coalesce(sub.q, 0)
  from (
    select msr.store_item_id, sum(coalesce(msr.quantity, 0)) as q
      from maintenance_store_requests msr
     where msr.store_item_id is not null
       and msr.store_decision = 'unavailable'
       and msr.handover_confirmed_at is not null
     group by msr.store_item_id
  ) sub
 where si.id = sub.store_item_id;

notify pgrst, 'reload schema';
