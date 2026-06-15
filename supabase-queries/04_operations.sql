-- ─────────────────────────────────────────────────────────────────────────────
-- 04_operations.sql
-- Production + shift operations tables
-- Tables: active_batches, batch_readings, batch_edit_logs,
--         shift_logs, device_mappings, unit_log_entries
-- ─────────────────────────────────────────────────────────────────────────────

-- Active production batches (BatchLogger, BatchSheet)
create table if not exists active_batches (
  id           uuid primary key default gen_random_uuid(),
  batch_no     text not null,
  recipe       text,
  target_qty   numeric,
  status       text default 'active',  -- 'active' | 'closed'
  final_gravity  numeric,
  total_drums    integer,
  paraffin_weight numeric,
  hcl_quantity   numeric,
  plant_id     uuid references plants(id),
  created_at   timestamptz default now()
);

-- Hourly process readings for a batch (temperature, gravity, pressures)
create table if not exists batch_readings (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid references active_batches(id) on delete cascade,
  temp         numeric,
  cp_gravity   numeric,
  cl2_pressure numeric,
  profile_id   uuid references profiles(id),
  timestamp    timestamptz default now()
);

-- Audit trail for batch edits (who changed what)
create table if not exists batch_edit_logs (
  id          uuid primary key default gen_random_uuid(),
  batch_no    text,
  action_type text,     -- 'create_batch' | 'edit_reading' | 'daily_log_upload' etc.
  details     jsonb,
  profile_id  uuid references profiles(id),
  created_at  timestamptz default now()
);

-- Night manager GPS check-in photos (NightEntry → NightManagerBoard)
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

-- Maps a device/browser session to a profile (used by NightManagerBoard)
create table if not exists device_mappings (
  id         uuid primary key default gen_random_uuid(),
  device_id  text unique,
  profile_id uuid references profiles(id),
  plant_id   uuid references plants(id),
  label      text,
  created_at timestamptz default now()
);

-- Hourly unit-level log uploads (DailyLogPage OCR → structured reading rows)
create table if not exists unit_log_entries (
  id             uuid primary key default gen_random_uuid(),
  date           date,
  shift          text,
  unit_name      text,
  operators      text[],
  helper_name    text,
  readings       jsonb,        -- array of hourly reading objects
  tank_summaries jsonb,
  remarks        text,
  notes          jsonb,
  uploaded_at    timestamptz,
  raw_extraction jsonb,
  created_at     timestamptz default now()
);

-- RLS
alter table active_batches    enable row level security;
alter table batch_readings     enable row level security;
alter table batch_edit_logs    enable row level security;
alter table shift_logs         enable row level security;
alter table device_mappings    enable row level security;
alter table unit_log_entries   enable row level security;

create policy "anon_all" on active_batches    for all using (true) with check (true);
create policy "anon_all" on batch_readings     for all using (true) with check (true);
create policy "anon_all" on batch_edit_logs    for all using (true) with check (true);
create policy "anon_all" on shift_logs         for all using (true) with check (true);
create policy "anon_all" on device_mappings    for all using (true) with check (true);
create policy "anon_all" on unit_log_entries   for all using (true) with check (true);
