-- ═══════════════════════════════════════════════════════════════════════════
-- 55_rollback_repair_returns.sql — undo 55_repair_returns.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- WARNING: dropping store_items.repaired_qty would silently strand the
-- repaired units inside on_hand, so this rollback FIRST subtracts them out.
-- Return receipt/allocation history is dropped. Ticket repair_qty columns are
-- dropped (any recorded returned quantities are lost).
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.apply_repair_return(jsonb);
drop function if exists public.reverse_repair_return(uuid, text);

-- Pull repaired units back out of on_hand before dropping the bucket.
update store_items set on_hand = greatest(0, on_hand - repaired_qty)
 where repaired_qty > 0;

drop table if exists repair_return_allocations cascade;
drop table if exists repair_return_receipts cascade;

alter table store_items drop column if exists repaired_qty;
comment on column store_items.on_hand is
  'baseline_qty + procured_qty - issued_qty + manual_delta (app-maintained)';

alter table maintenance_tickets drop column if exists repair_returned_qty;
alter table maintenance_tickets drop column if exists repair_qty;

update roles
   set capabilities = array_remove(capabilities, 'return_repairs')
 where 'return_repairs' = any(capabilities);
update roles
   set capabilities = array_remove(capabilities, 'reverse_repair_return')
 where 'reverse_repair_return' = any(capabilities);

notify pgrst, 'reload schema';
