-- ═══════════════════════════════════════════════════════════════════════════
-- Suntek Operations Dashboard — CONSOLIDATED SUPABASE SETUP
-- ═══════════════════════════════════════════════════════════════════════════
-- Single-file reproduction of the entire database for a FRESH Supabase project.
-- Reconciled from supabase-queries/01..24 (all ALTERs folded into base CREATEs)
-- so a clean project ends up byte-identical to the live schema, drift included.
--
-- HOW TO USE:
--   1. Create the new Supabase project (under the client-owned account).
--   2. Dashboard → SQL Editor → New query → paste this WHOLE file → Run.
--   3. It is idempotent — safe to re-run.
--   4. Then follow DEPLOYMENT.md for edge functions, secrets, realtime verify,
--      auth bootstrap, and the env-var swaps.
--
-- Covers: 38 tables · all foreign keys · RLS (anon_all, internal-tool model) ·
--         indexes · CHECK constraints · realtime · seed data (plants,
--         detector_config). Storage: none (images go to Cloudinary).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ───────────────────────────────────────────────────────────────────────────
-- 1. CORE — plants (foundation; referenced by nearly every table)
--    NOTE: reconciled to include lat/lng/geofence (01_core_plants.sql omitted
--    these, but file 18 + the app depend on them).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists plants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  lat               float,
  lng               float,
  geofence_radius_m int default 200,
  created_at        timestamptz default now()
);

alter table plants enable row level security;
drop policy if exists "anon_all" on plants;
create policy "anon_all" on plants for all using (true) with check (true);
drop policy if exists "anon read plants" on plants;
create policy "anon read plants" on plants for select to anon, authenticated using (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. AUTH — profiles (links auth.users → role + plant)
--    profiles.role stores the ROLE_ID string ('admin','unit_head',…), NOT L1-L4.
--    No CHECK constraint (legacy profiles_role_check intentionally absent).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  name               text,
  role               text,
  phone              text,
  plant_id           uuid references plants(id),
  preferred_language text default 'en'
);

alter table profiles enable row level security;
drop policy if exists "anon_all" on profiles;
create policy "anon_all" on profiles for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. NOTIFICATIONS — bell + realtime (base 03 + anomaly cols + cleared_by + scope)
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists notifications (
  id             uuid primary key default gen_random_uuid(),
  target_roles   text[]   not null,
  title          text     not null,
  body           text,
  type           text     default 'info',          -- 'info'|'warning'|'urgent'
  route          text,
  actor_name     text,
  actor_role     text,
  read_by        text[]   default '{}',
  created_at     timestamptz default now(),
  -- anomaly alerts piggyback on the bell (from 04_anomalies.sql)
  anomaly_type   text,
  anomaly_log_id uuid,
  entity_id      text,
  entity_type    text,
  cooldown_until timestamptz,
  auto_resolved  boolean default false,
  -- per-person "clear all" (13) and personal/broadcast scope (24)
  cleared_by     text[]  not null default '{}',
  scope          text    not null default 'broadcast'  -- 'personal'|'broadcast'
);
create index if not exists notifications_scope_idx on notifications (scope);

alter table notifications enable row level security;
drop policy if exists "anon_all" on notifications;
create policy "anon_all" on notifications for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. OPERATIONS — batches, readings, shift/night logs, devices, unit logs
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists active_batches (
  id              uuid primary key default gen_random_uuid(),
  batch_no        text not null,
  recipe          text,
  target_qty      numeric,
  status          text default 'active',   -- 'active'|'closed'
  final_gravity   numeric,
  total_drums     integer,
  paraffin_weight numeric,
  hcl_quantity    numeric,
  plant_id        uuid references plants(id),
  created_at      timestamptz default now()
);

create table if not exists batch_readings (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid references active_batches(id) on delete cascade,
  temp         numeric,
  cp_gravity   numeric,
  cl2_pressure numeric,
  profile_id   uuid references profiles(id),
  timestamp    timestamptz default now()
);

-- NOTE: batch_edit_logs is defined in two source files with different columns
-- (04_operations: profile_id · migration 0004: ip_address). Both are unioned
-- here — BatchLogger writes ip_address, other paths may use profile_id.
create table if not exists batch_edit_logs (
  id          uuid primary key default gen_random_uuid(),
  batch_no    text,
  action_type text,
  details     jsonb,
  profile_id  uuid references profiles(id),
  ip_address  text,
  created_at  timestamptz default now()
);
create index if not exists batch_edit_logs_batch_idx on batch_edit_logs (batch_no, created_at desc);

create table if not exists shift_logs (
  id           uuid primary key default gen_random_uuid(),
  photo_url    text,
  lat          double precision,
  lng          double precision,
  is_on_site   boolean,
  distance_m   numeric,
  profile_id   uuid references profiles(id),
  plant_id     uuid references plants(id),
  submitted_at timestamptz default now()
);

create table if not exists device_mappings (
  id         uuid primary key default gen_random_uuid(),
  device_id  text unique,
  profile_id uuid references profiles(id),
  plant_id   uuid references plants(id),
  label      text,
  created_at timestamptz default now()
);

create table if not exists unit_log_entries (
  id             uuid primary key default gen_random_uuid(),
  date           date,
  shift          text,
  unit_name      text,
  operators      text[],
  helper_name    text,
  readings       jsonb,
  tank_summaries jsonb,
  remarks        text,
  notes          jsonb,
  uploaded_at    timestamptz,
  raw_extraction jsonb,
  created_at     timestamptz default now()
);

alter table active_batches  enable row level security;
alter table batch_readings  enable row level security;
alter table batch_edit_logs enable row level security;
alter table shift_logs      enable row level security;
alter table device_mappings enable row level security;
alter table unit_log_entries enable row level security;
drop policy if exists "anon_all" on active_batches;   create policy "anon_all" on active_batches  for all using (true) with check (true);
drop policy if exists "anon_all" on batch_readings;   create policy "anon_all" on batch_readings  for all using (true) with check (true);
drop policy if exists "anon_all" on batch_edit_logs;  create policy "anon_all" on batch_edit_logs for all using (true) with check (true);
drop policy if exists "anon_all" on shift_logs;       create policy "anon_all" on shift_logs      for all using (true) with check (true);
drop policy if exists "anon_all" on device_mappings;  create policy "anon_all" on device_mappings for all using (true) with check (true);
drop policy if exists "anon_all" on unit_log_entries; create policy "anon_all" on unit_log_entries for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. ANOMALY ENGINE — log, watches, outstanding snapshots, item master, config
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists anomaly_log (
  id              uuid primary key default gen_random_uuid(),
  anomaly_type    text not null,
  tier            smallint not null default 1,
  layer           text not null default 'rule',
  severity        text not null default 'info',
  entity_id       text,
  entity_type     text,
  kpi_key         text,
  score           numeric,
  metric_value    numeric,
  baseline_value  numeric,
  detail          jsonb default '{}',
  title           text not null,
  body            text,
  route           text,
  status          text default 'open',
  recurrence      int  default 1,
  fired_at        timestamptz default now(),
  cooldown_until  timestamptz,
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  auto_resolved   boolean default false,
  is_synthetic    boolean default false
);
create index if not exists idx_anomaly_open   on anomaly_log (status, severity, fired_at desc);
create index if not exists idx_anomaly_dedupe on anomaly_log (anomaly_type, entity_id, cooldown_until);

create table if not exists anomaly_watches (
  id               uuid primary key default gen_random_uuid(),
  trigger_type     text not null,
  trigger_ref      text,
  plant_id         text,
  oil_type         text,
  metric_to_watch  text not null,
  baseline_value   numeric,
  recipe_group     text,
  watch_from       timestamptz default now(),
  watch_until      timestamptz not null,
  min_post_batches smallint default 5,
  status           text default 'active',
  created_at       timestamptz default now()
);
create index if not exists idx_watches_active on anomaly_watches (status, watch_until);

create table if not exists customer_outstanding_log (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        text not null,
  customer_name      text,
  outstanding        numeric not null,
  dispatched_qty_mtd numeric,
  snapshot_date      date not null default current_date,
  is_synthetic       boolean default false,
  unique (customer_id, snapshot_date)
);

create table if not exists item_master (
  id        uuid primary key default gen_random_uuid(),
  canonical text not null,
  aliases   text[] default '{}',
  category  text
);

create table if not exists detector_config (
  anomaly_type    text primary key,
  label           text,
  enabled         boolean default true,
  tier            smallint default 1,
  min_data_points int default 0,
  ml_min_points   int,
  cooldown_hours  int default 24,
  thresholds      jsonb default '{}',
  target_roles    text[] default '{admin}'
);

alter table anomaly_log              enable row level security;
alter table anomaly_watches          enable row level security;
alter table customer_outstanding_log enable row level security;
alter table item_master              enable row level security;
alter table detector_config          enable row level security;
drop policy if exists "anon_all" on anomaly_log;              create policy "anon_all" on anomaly_log              for all using (true) with check (true);
drop policy if exists "anon_all" on anomaly_watches;          create policy "anon_all" on anomaly_watches          for all using (true) with check (true);
drop policy if exists "anon_all" on customer_outstanding_log; create policy "anon_all" on customer_outstanding_log for all using (true) with check (true);
drop policy if exists "anon_all" on item_master;              create policy "anon_all" on item_master              for all using (true) with check (true);
drop policy if exists "anon_all" on detector_config;          create policy "anon_all" on detector_config          for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 6. STOCK
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists stock_levels (
  id         uuid primary key default gen_random_uuid(),
  item       text not null,
  plant_id   uuid references plants(id),
  qty        numeric default 0,
  direction  text default 'in',   -- 'in'|'out'
  adjustment numeric,
  note       text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table stock_levels enable row level security;
drop policy if exists "anon_all" on stock_levels;
create policy "anon_all" on stock_levels for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 7. PURCHASE HUB
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists activity_logs (
  id          uuid primary key default gen_random_uuid(),
  equipment   text not null,
  type        text,
  date        date,
  done_by     text,
  verified_by text,
  plant_id    uuid references plants(id),
  created_at  timestamptz default now()
);

create table if not exists fixed_assets (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  identification_mark text,
  model               text,
  capacity            text,
  origin              text,
  year                integer,
  value               numeric,
  invoice_no          text,
  purchase_date       date,
  account_head        text,
  photo_url           text,
  plant_id            uuid references plants(id),
  created_at          timestamptz default now()
);

create table if not exists store_requisitions (
  id         uuid primary key default gen_random_uuid(),
  item       text not null,
  plant_id   uuid references plants(id),
  qty        numeric,
  urgency    text default 'medium',
  status     text default 'pending',
  remarks    text,
  created_at timestamptz default now()
);

create table if not exists oil_contracts (
  id             uuid primary key default gen_random_uuid(),
  oil_type       text,
  company        text,
  date           date,
  book_qty_mt    numeric,
  dispatched_qty numeric default 0,
  pending_qty    numeric,
  price          numeric,
  port           text,
  status         text default 'open',
  created_at     timestamptz default now()
);

create table if not exists marine_insurance (
  id         uuid primary key default gen_random_uuid(),
  date       date,
  type       text default 'top_up',
  reference  text,
  amount     numeric,
  balance    numeric,
  mode       text,
  notes      text,
  created_at timestamptz default now()
);

create table if not exists labour_costs (
  id         uuid primary key default gen_random_uuid(),
  date       date,
  plant_id   uuid references plants(id),
  category   text,
  workers    integer,
  amount     numeric,
  notes      text,
  created_at timestamptz default now()
);

alter table activity_logs      enable row level security;
alter table fixed_assets       enable row level security;
alter table store_requisitions enable row level security;
alter table oil_contracts      enable row level security;
alter table marine_insurance   enable row level security;
alter table labour_costs       enable row level security;
drop policy if exists "anon_all" on activity_logs;      create policy "anon_all" on activity_logs      for all using (true) with check (true);
drop policy if exists "anon_all" on fixed_assets;       create policy "anon_all" on fixed_assets       for all using (true) with check (true);
drop policy if exists "anon_all" on store_requisitions; create policy "anon_all" on store_requisitions for all using (true) with check (true);
drop policy if exists "anon_all" on oil_contracts;      create policy "anon_all" on oil_contracts      for all using (true) with check (true);
drop policy if exists "anon_all" on marine_insurance;   create policy "anon_all" on marine_insurance   for all using (true) with check (true);
drop policy if exists "anon_all" on labour_costs;       create policy "anon_all" on labour_costs       for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 8. SALES
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  outstanding numeric default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

create table if not exists sales_contracts (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references customers(id),
  density        integer default 1400,
  locked_price   numeric,
  booked_qty     numeric,
  dispatched_qty numeric default 0,
  status         text default 'open',
  created_at     timestamptz default now()
);

alter table customers       enable row level security;
alter table sales_contracts enable row level security;
drop policy if exists "anon_all" on customers;       create policy "anon_all" on customers       for all using (true) with check (true);
drop policy if exists "anon_all" on sales_contracts; create policy "anon_all" on sales_contracts for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 9. MAINTENANCE (08 + 14 status check + 16 unit + 22 PM/OCR;
--    store_requests fold in 08b/18 handover + 15 cost + 17 supplier)
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists maintenance_schedules (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  equipment         text not null,
  plant_id          uuid references plants(id),
  frequency         text not null,
  description       text,
  is_active         boolean default true,
  last_completed_at timestamptz,
  next_due_at       timestamptz,
  created_at        timestamptz default now(),
  assigned_to       text          -- 0008: copied onto each auto-generated ticket
);

create table if not exists maintenance_tickets (
  id                       uuid primary key default gen_random_uuid(),
  type                     text not null,            -- 'periodic'|'emergency'
  status                   text not null default 'open',
  title                    text not null,
  equipment                text not null,
  plant_id                 uuid references plants(id),
  schedule_id              uuid references maintenance_schedules(id),
  description              text,
  raised_by                text,
  raised_role              text,
  assigned_to              text,
  completion_photo_url     text,
  defective_part_photo_url text,
  defective_part_decision  text,                     -- 'repair'|'scrap'
  due_date                 date,
  closed_at                timestamptz,
  created_at               timestamptz default now(),
  -- 16: Jharkhand unit routing
  unit                     text,                     -- 'chlorides'|'plasticiser'|null
  -- 22: defective raise photo + Purchase-Manager aggregate billing + OCR
  defective_raise_photo_url text,
  pm_items_count           integer,
  pm_bill_total            numeric,
  pm_bill_url              text,
  pm_ocr_total             numeric,
  pm_ocr_items             integer,
  pm_ocr_status            text,                     -- 'match'|'mismatch'|'unread'|null
  pm_ocr_raw               jsonb,
  pm_mismatch              boolean default false
);
-- 14: full status set (incl. pending_purchase_manager, pending_handover)
alter table maintenance_tickets drop constraint if exists maintenance_tickets_status_check;
alter table maintenance_tickets add constraint maintenance_tickets_status_check
  check (status in (
    'open','in_progress','pending_store','pending_unit_head',
    'pending_purchase','pending_purchase_manager','pending_handover',
    'pending_defective_return','closed'));

create table if not exists maintenance_store_requests (
  id                   uuid primary key default gen_random_uuid(),
  ticket_id            uuid references maintenance_tickets(id) not null,
  part_name            text not null,
  quantity             numeric,
  specification        text,
  plant_id             uuid references plants(id),
  store_decision       text default 'pending',   -- 'pending'|'available'|'unavailable'
  unit_head_approval   text default 'pending',   -- 'pending'|'approved'|'rejected'
  purchase_required    boolean default false,
  purchase_bill_url    text,
  busy_transaction_ref text,
  bill_verified        boolean,
  created_at           timestamptz default now(),
  -- 08b/18: store availability + handover
  qty_in_store          numeric,
  shelf_location        text,
  part_condition        text,                    -- 'new'|'used_good'|'refurbished'
  handover_invoice_url  text,
  handover_photo_url    text,
  handover_notes        text,
  handover_confirmed_at timestamptz,
  -- 15: cost; 17: supplier
  unit_price            numeric,
  total_price           numeric,
  supplier_name         text
);

alter table maintenance_schedules      enable row level security;
alter table maintenance_tickets        enable row level security;
alter table maintenance_store_requests enable row level security;
drop policy if exists "anon_all" on maintenance_schedules;      create policy "anon_all" on maintenance_schedules      for all using (true) with check (true);
drop policy if exists "anon_all" on maintenance_tickets;        create policy "anon_all" on maintenance_tickets        for all using (true) with check (true);
drop policy if exists "anon_all" on maintenance_store_requests; create policy "anon_all" on maintenance_store_requests for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 10. USER DIRECTORY (09 + 20 auth link + 21 lang) + account events (21)
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists user_accounts (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  mobile             text not null,
  whatsapp           text,
  email              text,
  role_id            text not null,    -- MockProfile id: 'admin','unit_head',…
  role_label         text,
  plant_id           uuid references plants(id),
  plant_name         text,
  designation        text,
  access_note        text,
  is_active          boolean default true,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  -- 20: link to real auth login
  auth_user_id       uuid references auth.users(id) on delete set null,
  login_enabled      boolean default false,
  -- 21: preferred language
  preferred_language text default 'en'
);
create index if not exists user_accounts_auth_user_id_idx on user_accounts (auth_user_id);

alter table user_accounts enable row level security;
drop policy if exists "anon_all" on user_accounts;
create policy "anon_all" on user_accounts for all using (true) with check (true);

create table if not exists user_account_events (
  id              uuid primary key default gen_random_uuid(),
  user_account_id uuid references user_accounts(id) on delete set null,
  target_name     text,
  target_email    text,
  action          text not null,
  details         text,
  actor_name      text,
  actor_role      text,
  created_at      timestamptz default now()
);
create index if not exists user_account_events_acct_idx on user_account_events (user_account_id, created_at desc);

alter table user_account_events enable row level security;
drop policy if exists "anon_all" on user_account_events;
create policy "anon_all" on user_account_events for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 11. BLACKLIST + audit trail
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists blacklist (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in ('person','vehicle','vendor','other')),
  name            text not null,
  identifier      text,
  reason          text not null,
  severity        text not null default 'high'
                  check (severity in ('low','medium','high','critical')),
  notes           text,
  reference_no    text,
  added_by        text not null,
  added_by_role   text,
  is_active       boolean default true,
  resolved_at     timestamptz,
  resolved_by     text,
  resolved_reason text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table blacklist enable row level security;
drop policy if exists "anon_all" on blacklist;
create policy "anon_all" on blacklist for all using (true) with check (true);

create table if not exists blacklist_events (
  id            uuid primary key default gen_random_uuid(),
  blacklist_id  uuid,
  event_type    text not null,   -- 'added'|'resolved'|'re_added'|'match_detected'
  entity_name   text not null,
  entity_type   text,
  matched_value text,
  similarity    numeric,
  workflow      text,
  source        text,            -- 'entry'|'ocr'|'image'|'lifecycle'
  actor_id      text,
  actor_name    text,
  actor_role    text,
  image_url     text,
  details       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists blacklist_events_blacklist_idx on blacklist_events (blacklist_id, created_at);
create index if not exists blacklist_events_type_idx       on blacklist_events (event_type, created_at);

alter table blacklist_events enable row level security;
drop policy if exists "anon_all" on blacklist_events;
create policy "anon_all" on blacklist_events for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 12. MENTIONS — entity notes, watchers, read receipts (10_mentions + 23)
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists entity_notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   text not null,
  author_id   text not null,
  author_name text not null,
  author_role text,
  body        text not null,
  mentions    text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists entity_notes_entity_idx on entity_notes (entity_type, entity_id, created_at);

create table if not exists entity_watchers (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,
  entity_id    text not null,
  profile_id   text not null,
  profile_name text not null,
  kind         text not null default 'cc',  -- 'cc'|'mention'|'author'
  added_by     text,
  created_at   timestamptz not null default now(),
  unique (entity_type, entity_id, profile_id)
);
create index if not exists entity_watchers_entity_idx on entity_watchers (entity_type, entity_id);

create table if not exists entity_note_receipts (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references entity_notes(id) on delete cascade,
  entity_type  text not null,
  entity_id    text not null,
  profile_id   text not null,
  delivered_at timestamptz,
  seen_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (note_id, profile_id)
);
create index if not exists entity_note_receipts_note_idx   on entity_note_receipts (note_id);
create index if not exists entity_note_receipts_entity_idx on entity_note_receipts (entity_type, entity_id);

alter table entity_notes         enable row level security;
alter table entity_watchers      enable row level security;
alter table entity_note_receipts enable row level security;
drop policy if exists anon_all on entity_notes;         create policy anon_all on entity_notes         for all using (true) with check (true);
drop policy if exists anon_all on entity_watchers;      create policy anon_all on entity_watchers      for all using (true) with check (true);
drop policy if exists anon_all on entity_note_receipts; create policy anon_all on entity_note_receipts for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 12B. MIGRATION-ORIGIN TABLES  ⚠️ CRITICAL
--   These 5 tables live ONLY in supabase/migrations/ (never folded into the
--   numbered supabase-queries set) but the app actively queries them. Omitting
--   them breaks Overview, CPM Stock, Audit Log, BatchLogger drafts, and the
--   Anomaly Operations Center. RLS added here for consistency (migrations left
--   it off, which is also open — same effective access, this is just explicit).
-- ───────────────────────────────────────────────────────────────────────────

-- tanks (Overview, CPMStock) — 0002
create table if not exists tanks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  location   text,
  capacity   numeric,
  unit       text not null default 'MT',
  level_pct  numeric not null default 0,
  alert      boolean not null default false,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

-- cpm_drum_stock (Overview, CPMStock) — 0002
create table if not exists cpm_drum_stock (
  id         uuid primary key default gen_random_uuid(),
  location   text not null,
  density    int not null,
  drums      numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (location, density)
);

-- alerts (Overview open-alerts panel) — 0003
create table if not exists alerts (
  id          uuid primary key default gen_random_uuid(),
  severity    text not null default 'low' check (severity in ('red','amber','low')),
  text        text not null,
  source      text,
  when_label  text,
  route       text,
  is_resolved boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists alerts_open_idx on alerts (is_resolved, created_at desc);

-- operator_sessions (BatchLogger draft cache, keyed by IP) — 0004
create table if not exists operator_sessions (
  ip_address           text primary key,
  selected_batch       text,
  temp_input           text,
  cp_gravity_input     text,
  cl2_press_input      text,
  active_tab           text,
  new_batch_no_input   text,
  new_recipe_input     text,
  new_target_qty_input text,
  last_active          timestamptz not null default now()
);

-- anomaly_flags (Anomaly Operations Center single feed) — 0007
create table if not exists anomaly_flags (
  id                 uuid primary key default gen_random_uuid(),
  severity           text not null default 'watch' check (severity in ('critical','warning','watch')),
  source_app         text not null,
  plant              text,
  entity_type        text,
  entity_id          text,
  entity_label       text,
  title              text not null,
  evidence           text,
  recommended_action text,
  value_at_stake     numeric,
  value_unit         text,
  confidence         numeric,
  status             text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  assigned_to        text,
  resolution_reason  text,
  route              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  resolved_at        timestamptz
);
create index if not exists anomaly_flags_open_idx   on anomaly_flags (status, severity, created_at desc);
create index if not exists anomaly_flags_source_idx on anomaly_flags (source_app);
create index if not exists anomaly_flags_plant_idx  on anomaly_flags (plant);

alter table tanks             enable row level security;
alter table cpm_drum_stock    enable row level security;
alter table alerts            enable row level security;
alter table operator_sessions enable row level security;
alter table anomaly_flags     enable row level security;
drop policy if exists "anon_all" on tanks;             create policy "anon_all" on tanks             for all using (true) with check (true);
drop policy if exists "anon_all" on cpm_drum_stock;    create policy "anon_all" on cpm_drum_stock    for all using (true) with check (true);
drop policy if exists "anon_all" on alerts;            create policy "anon_all" on alerts            for all using (true) with check (true);
drop policy if exists "anon_all" on operator_sessions; create policy "anon_all" on operator_sessions for all using (true) with check (true);
drop policy if exists "anon_all" on anomaly_flags;     create policy "anon_all" on anomaly_flags     for all using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 13. REALTIME — add the live-updating tables to the supabase_realtime publication
--     (idempotent; ignores "already a member")
-- ───────────────────────────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table notifications;         exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table anomaly_log;           exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table entity_notes;          exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table entity_note_receipts;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table entity_watchers;       exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table blacklist_events;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table tanks;                 exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table cpm_drum_stock;        exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table alerts;                exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table anomaly_flags;         exception when duplicate_object then null; end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 14. SEED — reference data the app needs to render immediately
-- ───────────────────────────────────────────────────────────────────────────
-- 4 Suntek plants (names + geofence coords from file 18)
insert into plants (name, lat, lng, geofence_radius_m) values
  ('SHD',    23.79, 86.43, 300),
  ('Rehla',  24.13, 84.05, 300),
  ('Ganjam', 19.39, 85.05, 300),
  ('HQ',     22.57, 88.36, 200)
on conflict (name) do nothing;

-- Anomaly detector thresholds (admin-editable later)
insert into detector_config (anomaly_type, label, tier, min_data_points, cooldown_hours, thresholds, target_roles) values
  ('MARGIN_COMPRESSION',     'Gross margin compression',       2, 2, 24, '{"drop_pct":0.05}',                 '{admin,unit_head}'),
  ('A14_vendor_switch',      'Vendor switch + cost jump',      1, 0, 24, '{"price_jump_pct":0.10}',           '{admin,unit_head}'),
  ('A6_revenue_pace',        'MTD revenue pace drop',          2, 1, 24, '{"drop_pct":0.20}',                 '{admin}'),
  ('A7_customer_silent',     'Top customer going silent',      2, 1, 48, '{"silent_days":30}',                '{admin}'),
  ('A8_credit_risk',         'Outstanding + active dispatch',  2, 1, 24, '{"outstanding_min":500000}',        '{admin}'),
  ('A21_recurring_breakdown','Recurring equipment breakdown',  1, 0, 12, '{"window_days":30,"min_count":3}',  '{admin,unit_head}'),
  ('A27_offsite_checkin',    'Off-site GPS check-in',          1, 0, 6,  '{}',                                '{admin,unit_head}')
on conflict (anomaly_type) do nothing;

-- item_master: no canonical seed exists in the repo — populated at runtime.

-- Storage tanks (so Overview/CPM Stock render on day one) — from 0002
insert into tanks (name, location, capacity, unit, level_pct, alert, sort_order)
select * from (values
  ('NP9 (Port)',           'Kandla', 500,  'MT', 78, false, 1),
  ('C18 olefin (Port)',    'Mundra', 2000, 'MT', 62, false, 2),
  ('NPG (Port)',           'Kandla', 600,  'MT', 24, true,  3),
  ('NPS (Factory)',        'Rehla',  50,   'MT', 54, false, 4),
  ('C18 olefin (Factory)', 'Rehla',  200,  'MT', 71, false, 5),
  ('NPQ (Factory)',        'Rehla',  500,  'MT', 88, false, 6)
) as v(name, location, capacity, unit, level_pct, alert, sort_order)
where not exists (select 1 from tanks);

-- CP drum matrix — from 0002
insert into cpm_drum_stock (location, density, drums)
select * from (values
  ('Bawana', 1300, 245), ('Bawana', 1400, 380), ('Bawana', 1450, 130), ('Bawana', 1500, 90),
  ('Kolkata',1300, 180), ('Kolkata',1400, 210), ('Kolkata',1450, 90),  ('Kolkata',1500, 40),
  ('Rehla',  1300, 115), ('Rehla',  1400, 125), ('Rehla',  1450, 70),  ('Rehla',  1500, 35),
  ('Ganjam', 1300, 80),  ('Ganjam', 1400, 95),  ('Ganjam', 1450, 40),  ('Ganjam', 1500, 20),
  ('SHD',    1300, 42),  ('SHD',    1400, 60),  ('SHD',    1450, 25),  ('SHD',    1500, 10)
) as v(location, density, drums)
where not exists (select 1 from cpm_drum_stock);

-- NOTE: alerts + anomaly_flags also ship with demo seed rows in migrations
-- 0003/0007. They are DEMO data (synthetic incidents), not reference data —
-- left out here so the client starts clean. Copy the INSERTs from
-- supabase/migrations/0003_alerts.sql / 0007_anomaly_flags.sql if you want the
-- panels pre-populated for a demo.

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE. 38 tables created. Next (see DEPLOYMENT.md):
--   • Deploy the 6 edge functions + set their secrets (NVIDIA_API_KEY, etc.)
--   • Verify realtime toggles in Database → Replication
--   • Bootstrap the first admin login (Auth → Add user, then insert a profiles row)
--   • Swap the app's VITE_* env vars to this project's URL + anon key
-- ═══════════════════════════════════════════════════════════════════════════
