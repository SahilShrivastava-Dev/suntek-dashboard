-- ═══════════════════════════════════════════════════════════════════════════
-- 48_ticket_request_changes.sql — reviewer "Request Changes" / resubmit loop
-- ═══════════════════════════════════════════════════════════════════════════
-- A reviewer (Unit Head / Admin) can send a deficient ticket back to the
-- technician for correction instead of a blunt reject — the SAME ticket record
-- stays alive through as many review cycles as needed.
--
--   … under review → 'changes_requested'  (revision_prev_status remembers the
--                                           stage it paused at)
--       → technician edits + resubmits → status restored to revision_prev_status
--
-- Full history is preserved in the entity_notes thread (one entry per cycle);
-- these columns hold the CURRENT request for prominent display + a cycle count.
--
-- Additive + idempotent. Does not self-run — apply once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Allow the new 'changes_requested' status (extend the existing CHECK).
alter table public.maintenance_tickets
  drop constraint if exists maintenance_tickets_status_check;

alter table public.maintenance_tickets
  add constraint maintenance_tickets_status_check
  check (status in (
    'open','in_progress','pending_store','pending_unit_head',
    'pending_purchase','pending_purchase_manager','pending_handover',
    'pending_defective_return','changes_requested','closed'));

-- 2. Revision-tracking columns (all nullable / defaulted → existing rows are fine).
alter table public.maintenance_tickets
  add column if not exists revision_reason        text,
  add column if not exists revision_requested_by  text,
  add column if not exists revision_requested_at  timestamptz,
  add column if not exists revision_count         int not null default 0,
  add column if not exists revision_prev_status   text;
