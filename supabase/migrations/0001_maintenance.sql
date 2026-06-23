-- ============================================================================
-- Migration 0001 — Maintenance module tables
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor.
--
-- These three tables back src/routes/dashboard/purchase/Maintenance.tsx. The
-- component already reads/writes them, but they were never declared in
-- src/lib/database.types.ts (hence the `as any` casts). This migration makes
-- the schema explicit and is the source of truth going forward.
--
-- Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS + additive columns).
-- Depends on the existing `plants` table (id uuid).
-- ============================================================================

-- ── maintenance_schedules ───────────────────────────────────────────────────
-- Recurring/periodic maintenance definitions. A due schedule auto-spawns a
-- periodic ticket (see loadData() in Maintenance.tsx).
create table if not exists public.maintenance_schedules (
  id                uuid primary key default gen_random_uuid(),
  title             text        not null,
  equipment         text        not null,
  plant_id          uuid        references public.plants (id) on delete set null,
  frequency         text        not null
                      check (frequency in ('daily','weekly','monthly','quarterly','biannual','triannual')),
  description       text,
  is_active         boolean     not null default true,
  next_due_at       timestamptz,
  last_completed_at timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists maintenance_schedules_next_due_idx
  on public.maintenance_schedules (next_due_at);
create index if not exists maintenance_schedules_plant_idx
  on public.maintenance_schedules (plant_id);

-- ── maintenance_tickets ─────────────────────────────────────────────────────
-- One ticket per maintenance event (periodic or emergency). Moves through a
-- staged status workflow: open → in_progress → pending_store →
-- pending_unit_head → pending_purchase → pending_handover →
-- pending_defective_return → closed.
create table if not exists public.maintenance_tickets (
  id                       uuid primary key default gen_random_uuid(),
  type                     text not null
                             check (type in ('periodic','emergency')),
  status                   text not null default 'open'
                             check (status in (
                               'open','in_progress','pending_store','pending_unit_head',
                               'pending_purchase','pending_handover',
                               'pending_defective_return','closed')),
  title                    text not null,
  equipment                text not null,
  plant_id                 uuid references public.plants (id) on delete set null,
  schedule_id              uuid references public.maintenance_schedules (id) on delete set null,
  description              text,
  due_date                 date,
  raised_by                text,
  raised_role              text,
  assigned_to              text,
  completion_photo_url     text,
  defective_part_photo_url text,
  defective_part_decision  text check (defective_part_decision in ('repair','scrap')),
  closed_at                timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists maintenance_tickets_status_idx
  on public.maintenance_tickets (status);
create index if not exists maintenance_tickets_type_idx
  on public.maintenance_tickets (type);
create index if not exists maintenance_tickets_schedule_idx
  on public.maintenance_tickets (schedule_id);
create index if not exists maintenance_tickets_created_idx
  on public.maintenance_tickets (created_at desc);

-- ── maintenance_store_requests ──────────────────────────────────────────────
-- Spare-part request raised against a ticket. Tracks the store-availability
-- decision, unit-head approval, procurement ref, and handover proof.
create table if not exists public.maintenance_store_requests (
  id                    uuid primary key default gen_random_uuid(),
  ticket_id             uuid not null references public.maintenance_tickets (id) on delete cascade,
  part_name             text not null,
  quantity              numeric,
  specification         text,
  plant_id              uuid references public.plants (id) on delete set null,
  store_decision        text check (store_decision in ('available','unavailable')),
  purchase_required     boolean,
  qty_in_store          numeric,
  shelf_location        text,
  part_condition        text,
  unit_head_approval    text check (unit_head_approval in ('approved','rejected')),
  busy_transaction_ref  text,
  handover_invoice_url  text,
  handover_photo_url    text,
  handover_notes        text,
  handover_confirmed_at timestamptz,
  bill_verified         boolean,
  created_at            timestamptz not null default now()
);

create index if not exists maintenance_store_requests_ticket_idx
  on public.maintenance_store_requests (ticket_id);

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Enable realtime so the dashboard can subscribe to live ticket updates.
-- (No-op if the table is already in the publication.)
do $$
begin
  alter publication supabase_realtime add table public.maintenance_tickets;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.maintenance_schedules;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.maintenance_store_requests;
exception when duplicate_object then null; end $$;

-- ── RLS (planned) ─────────────────────────────────────────────────────────────
-- Internal-only for now (per Phase 2 decision), so RLS is left disabled to match
-- the rest of the app. When the app goes multi-user/external, enable and add
-- role-scoped policies. Scaffolding kept here intentionally, commented:
--
-- alter table public.maintenance_tickets        enable row level security;
-- alter table public.maintenance_schedules       enable row level security;
-- alter table public.maintenance_store_requests  enable row level security;
-- create policy "authenticated read" on public.maintenance_tickets
--   for select to authenticated using (true);
-- create policy "authenticated write" on public.maintenance_tickets
--   for all to authenticated using (true) with check (true);
