-- ============================================================================
-- Migration 0002 — CPM Stock: tanks + CP density×location matrix
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor.
--
-- These two tables replace the hardcoded TANKS / CP_MATRIX mock arrays in
-- src/data/mockData.ts that powered the CPM Stock page. Seeded with the same
-- values so the page looks identical on day one, then becomes editable/live.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + seed guarded by NOT EXISTS.
-- ============================================================================

-- ── tanks ───────────────────────────────────────────────────────────────────
-- Port + factory storage tanks with a current fill level. `level_pct` is the
-- fill percentage; `alert` marks a low/critical tank.
create table if not exists public.tanks (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null,
  location    text,
  capacity    numeric,
  unit        text    not null default 'MT',
  level_pct   numeric not null default 0,
  alert       boolean not null default false,
  sort_order  int     not null default 0,
  updated_at  timestamptz not null default now()
);

-- ── cpm_drum_stock ──────────────────────────────────────────────────────────
-- Normalised form of the CP density×location matrix: one row per
-- (location, density) holding the number of drums on hand. The UI pivots these
-- rows back into the matrix grid.
create table if not exists public.cpm_drum_stock (
  id          uuid primary key default gen_random_uuid(),
  location    text    not null,
  density     int     not null,
  drums       numeric not null default 0,
  updated_at  timestamptz not null default now(),
  unique (location, density)
);

-- ── Seed: tanks (only if table is empty) ────────────────────────────────────
insert into public.tanks (name, location, capacity, unit, level_pct, alert, sort_order)
select * from (values
  ('NP9 (Port)',           'Kandla', 500,  'MT', 78, false, 1),
  ('C18 olefin (Port)',    'Mundra', 2000, 'MT', 62, false, 2),
  ('NPG (Port)',           'Kandla', 600,  'MT', 24, true,  3),
  ('NPS (Factory)',        'Rehla',  50,   'MT', 54, false, 4),
  ('C18 olefin (Factory)', 'Rehla',  200,  'MT', 71, false, 5),
  ('NPQ (Factory)',        'Rehla',  500,  'MT', 88, false, 6)
) as v(name, location, capacity, unit, level_pct, alert, sort_order)
where not exists (select 1 from public.tanks);

-- ── Seed: CP drum matrix (only if table is empty) ───────────────────────────
-- Locations: Bawana, Kolkata, Rehla, Ganjam, SHD · densities 1300/1400/1450/1500
insert into public.cpm_drum_stock (location, density, drums)
select * from (values
  ('Bawana', 1300, 245), ('Bawana', 1400, 380), ('Bawana', 1450, 130), ('Bawana', 1500, 90),
  ('Kolkata',1300, 180), ('Kolkata',1400, 210), ('Kolkata',1450, 90),  ('Kolkata',1500, 40),
  ('Rehla',  1300, 115), ('Rehla',  1400, 125), ('Rehla',  1450, 70),  ('Rehla',  1500, 35),
  ('Ganjam', 1300, 80),  ('Ganjam', 1400, 95),  ('Ganjam', 1450, 40),  ('Ganjam', 1500, 20),
  ('SHD',    1300, 42),  ('SHD',    1400, 60),  ('SHD',    1450, 25),  ('SHD',    1500, 10)
) as v(location, density, drums)
where not exists (select 1 from public.cpm_drum_stock);

-- ── Realtime ────────────────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table public.tanks;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.cpm_drum_stock;
exception when duplicate_object then null; end $$;
