-- ─────────────────────────────────────────────────────────────────────────────
-- 14_purchase_manager_stage.sql — add the Purchase Manager stage to maintenance
--
-- New emergency flow for externally-procured parts:
--   … → pending_purchase (unit head procures, enters BUSY ref)
--      → pending_purchase_manager (Purchase Manager uploads supplier bill, marks en route)
--      → pending_handover (store manager confirms receipt) → …
--
-- The maintenance_tickets.status column has a CHECK constraint, so the new value
-- must be allowed. Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.maintenance_tickets
  drop constraint if exists maintenance_tickets_status_check;

alter table public.maintenance_tickets
  add constraint maintenance_tickets_status_check
  check (status in (
    'open','in_progress','pending_store','pending_unit_head',
    'pending_purchase','pending_purchase_manager','pending_handover',
    'pending_defective_return','closed'));
