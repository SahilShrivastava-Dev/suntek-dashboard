-- ═══════════════════════════════════════════════════════════════════════════
-- 47_requisition_ticket_link.sql — link store requisitions to maintenance tickets
-- ═══════════════════════════════════════════════════════════════════════════
-- A store requisition raised in the course of a maintenance job should point back
-- at its ticket so the Store Requirement list can deep-link to it (open the exact
-- ticket from the "Ticket #" column). Nullable — standalone requisitions (not tied
-- to a maintenance job) simply leave it null. Additive, idempotent, does not self-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table store_requisitions
  add column if not exists ticket_id uuid references maintenance_tickets(id) on delete set null;

create index if not exists idx_store_requisitions_ticket
  on store_requisitions (ticket_id);

notify pgrst, 'reload schema';
