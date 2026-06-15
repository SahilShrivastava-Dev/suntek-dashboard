-- ─────────────────────────────────────────────────────────────────────────────
-- 01_core_plants.sql
-- Foundation table — all other tables reference plants(id)
-- Run this FIRST before any other script
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists plants (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- Seed the 4 Suntek factories
insert into plants (name) values
  ('SHD'),
  ('Rehla'),
  ('Ganjam'),
  ('HQ')
on conflict (name) do nothing;

-- RLS
alter table plants enable row level security;
create policy "anon_all" on plants for all using (true) with check (true);
