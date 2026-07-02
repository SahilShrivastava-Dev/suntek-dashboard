-- ═══════════════════════════════════════════════════════════════════════════
-- 33_night_duty.sql — night duty as a scheduled, rotational assignment
-- ═══════════════════════════════════════════════════════════════════════════
-- "Night manager" is no longer a role — it's a DUTY a technician is assigned to.
-- Someone with the `allocate_night_duty` capability (e.g. a unit head) schedules
-- their own technicians onto night-duty dates (rotationally: 3 tonight, 3 the
-- next, etc.). The technician then checks in (GPS + photo) from their own login;
-- that check-in is a shift_logs row linked back to the duty.
-- Requires 27 (plants/units) + 28 (scope helpers). Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- One row per technician per night.
create table if not exists night_duty (
  id               uuid primary key default gen_random_uuid(),
  technician_id    uuid not null references user_accounts(id) on delete cascade,
  assigned_by      uuid references user_accounts(id) on delete set null,
  plant_id         uuid references plants(id),
  unit_id          uuid references units(id),
  duty_date        date not null,
  status           text not null default 'scheduled', -- scheduled | checked_in | completed | missed
  checked_in_at    timestamptz,
  shift_log_id     uuid references shift_logs(id) on delete set null, -- the check-in record
  recurrence_group uuid,        -- groups rows created by one "repeat" schedule
  notes            text,
  created_at       timestamptz default now(),
  unique (technician_id, duty_date)
);
create index if not exists night_duty_plant_id_idx on night_duty (plant_id);
create index if not exists night_duty_duty_date_idx on night_duty (duty_date);
create index if not exists night_duty_technician_idx on night_duty (technician_id);

-- Link a check-in (shift_logs) to its duty.
alter table shift_logs add column if not exists night_duty_id uuid references night_duty(id) on delete set null;

-- ── RLS: global sees all; anyone in the plant sees that plant's duties; a
--       technician always sees their own. Writes require plant scope (an
--       allocator schedules for their own plant). ─────────────────────────────
alter table night_duty enable row level security;
drop policy if exists "anon_all"          on night_duty;
drop policy if exists "night_duty_scope"  on night_duty;
create policy "night_duty_scope" on night_duty for all
  using (
    public.is_global_user()
    or (plant_id is not null and plant_id in (select public.my_plant_ids()))
    or technician_id = (select id from user_accounts where auth_user_id = auth.uid() limit 1)
  )
  with check (
    public.is_global_user()
    or (plant_id is not null and plant_id in (select public.my_plant_ids()))
  );

notify pgrst, 'reload schema';
