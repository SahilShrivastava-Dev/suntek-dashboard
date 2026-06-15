-- ─────────────────────────────────────────────────────────────────────────────
-- 08_maintenance.sql
-- Maintenance Management System tables
-- Tables: maintenance_schedules, maintenance_tickets, maintenance_store_requests
-- Used by: Maintenance.tsx (3-tab system)
-- ─────────────────────────────────────────────────────────────────────────────

-- Recurring maintenance schedule definitions (Schedule Setup tab)
create table if not exists maintenance_schedules (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  equipment         text not null,
  plant_id          uuid references plants(id),
  frequency         text not null,
  -- frequency values: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'triannual'
  description       text,
  is_active         boolean default true,
  last_completed_at timestamptz,
  next_due_at       timestamptz,
  created_at        timestamptz default now()
);

-- Individual maintenance ticket instances (Periodic + Emergency tabs)
create table if not exists maintenance_tickets (
  id                      uuid primary key default gen_random_uuid(),
  type                    text not null,   -- 'periodic' | 'emergency'
  status                  text not null default 'open',
  -- status values:
  --   open | in_progress | pending_store | pending_unit_head |
  --   pending_purchase | pending_bill_verify | pending_defective_return | closed
  title                   text not null,
  equipment               text not null,
  plant_id                uuid references plants(id),
  schedule_id             uuid references maintenance_schedules(id), -- null for emergency tickets
  description             text,
  raised_by               text,
  raised_role             text,
  assigned_to             text,
  completion_photo_url    text,
  defective_part_photo_url text,
  defective_part_decision text,  -- 'repair' | 'scrap'
  due_date                date,
  closed_at               timestamptz,
  created_at              timestamptz default now()
);

-- Store part requests embedded within a maintenance ticket
create table if not exists maintenance_store_requests (
  id                   uuid primary key default gen_random_uuid(),
  ticket_id            uuid references maintenance_tickets(id) not null,
  part_name            text not null,
  quantity             numeric,
  specification        text,
  plant_id             uuid references plants(id),
  store_decision       text default 'pending',    -- 'pending' | 'available' | 'unavailable'
  unit_head_approval   text default 'pending',    -- 'pending' | 'approved' | 'rejected'
  purchase_required    boolean default false,
  purchase_bill_url    text,
  busy_transaction_ref text,
  bill_verified        boolean,
  created_at           timestamptz default now()
);

-- RLS
alter table maintenance_schedules      enable row level security;
alter table maintenance_tickets        enable row level security;
alter table maintenance_store_requests enable row level security;

create policy "anon_all" on maintenance_schedules      for all using (true) with check (true);
create policy "anon_all" on maintenance_tickets        for all using (true) with check (true);
create policy "anon_all" on maintenance_store_requests for all using (true) with check (true);
