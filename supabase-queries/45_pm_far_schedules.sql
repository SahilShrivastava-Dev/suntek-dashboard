-- ═══════════════════════════════════════════════════════════════════════════
-- 45_pm_far_schedules.sql — FAR-linked Preventive Maintenance schedules
-- ═══════════════════════════════════════════════════════════════════════════
-- Turns maintenance_schedules into FAR-validated, checklist-carrying recurring
-- templates (Outlook-style: runs until an end date). Also a manifest for PM
-- workbook uploads. The recurrence engine already exists (one open periodic
-- ticket per schedule; completing advances next_due) — these columns feed it.
-- Requires 44 (fixed_assets). Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

alter table maintenance_schedules
  add column if not exists far_asset_id          uuid references fixed_assets(id) on delete set null,
  add column if not exists equipment_mark        text,           -- FAR identification mark
  add column if not exists start_date            date,
  add column if not exists until_date            date,           -- stop generating after this (Outlook "continue until")
  add column if not exists checklist             jsonb default '[]'::jsonb,  -- [{component, activity}]
  add column if not exists requires_approval     boolean default true,       -- daily = false (auto-close)
  add column if not exists unmatched_justification text,         -- reason if equipment not in FAR
  add column if not exists source                text default 'manual';      -- 'manual' | 'pm_import'

-- Periodic tickets carry the checklist (with per-checkpoint completion state).
alter table maintenance_tickets
  add column if not exists checklist         jsonb,     -- [{component, activity, done}]
  add column if not exists requires_approval boolean;

-- Frequency accepts the two extra cadences from the PM workbook (15-day, 2-month).
-- Widen the existing CHECK constraint to allow fortnightly + bimonthly.
alter table maintenance_schedules drop constraint if exists maintenance_schedules_frequency_check;
alter table maintenance_schedules add constraint maintenance_schedules_frequency_check
  check (frequency in ('daily','weekly','fortnightly','monthly','bimonthly','quarterly','biannual','triannual','annual'));

-- One row per uploaded PM workbook.
create table if not exists pm_schedule_uploads (
  id               uuid primary key default gen_random_uuid(),
  plant_id         uuid references plants(id) on delete set null,
  file_name        text,
  file_url         text,
  uploaded_by_name text,
  sheet_count      integer default 0,
  schedule_count   integer default 0,
  created_at       timestamptz default now()
);

alter table pm_schedule_uploads enable row level security;
drop policy if exists "anon_all"  on pm_schedule_uploads;
drop policy if exists "scope_all" on pm_schedule_uploads;
create policy "scope_all" on pm_schedule_uploads for all
  using (public.plant_in_scope(plant_id)) with check (public.plant_in_scope(plant_id));

notify pgrst, 'reload schema';
