-- ═══════════════════════════════════════════════════════════════════════════
-- 57_locations.sql — State → Location → Factory hierarchy
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PROBLEM
-- `plants` has exactly ONE descriptive column (`name`), so state, city, legal
-- company, factory and store are all conflated into a single free-text string.
-- The live rows read 'SHD', 'Rehla', 'Madan', 'K.G', 'SCPL Delhi', 'SCPL
-- Odisha', 'SPPL', 'Ganjam', 'HQ' — nine records for five real factories, with
-- no way to tell an entity from a place. And because three factories at Rehla
-- share one physical store, "which plant" and "which store" cannot be told
-- apart at all.
--
-- THE MODEL (client-confirmed)
--     State → Location → Factory
--   Uttar Pradesh → Sikandrabad → Madan Chemical – Sikandrabad
--   Odisha        → Ganjam      → SCPL – Ganjam
--   Jharkhand     → Rehla       → SCPL – Rehla, SPPL – Rehla, SPPL(K) – Rehla
--
--   • `locations` is the new tier: geographical grouping, consolidated
--     reporting, and the anchor a shared store hangs off (see 59_stores.sql).
--   • `plants` keeps its identity — every id and every foreign key is
--     untouched — and gains the descriptive fields it never had.
--   • `factory_code` is the STABLE TECHNICAL KEY. Business logic and
--     migrations should key off it, never off the display name.
--   • `plants.name` becomes purely a display string, generated as
--     '<entity_name> – <location.name>'. It is renamed in 58, not here.
--
-- THIS FILE IS PURELY ADDITIVE. It creates one table, adds seven nullable
-- columns, and populates them. No rename, no retire, no data moved, no
-- behaviour change. Nothing reads these columns until 58 and the frontend land,
-- so it is safe to apply on its own and leave.
--
-- Requires 01 (plants). Idempotent. Reversible via 57_rollback_locations.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Location master ──────────────────────────────────────────────────────
create table if not exists locations (
  id         uuid primary key default gen_random_uuid(),
  state      text not null,                    -- 'Jharkhand'
  name       text not null,                    -- 'Rehla'
  code       text unique,                      -- 'REHLA' — stable technical key
  created_at timestamptz default now(),
  unique (state, name)
);

-- Reference data, same posture as `plants` (see 19_plants_public_read.sql):
-- readable by everyone so labels and pickers resolve; not sensitive.
alter table locations enable row level security;
drop policy if exists "anon read locations" on locations;
create policy "anon read locations" on locations for select to anon, authenticated using (true);

-- ── 2. Descriptive + lifecycle columns on plants ────────────────────────────
-- ADD ONLY. `plants.id` is referenced by ~20 tables and by user_plants; it is
-- never touched by this migration or any that follow.
alter table plants
  add column if not exists location_id   uuid references locations(id),
  add column if not exists company_name  text,     -- owning legal entity, e.g. 'SPPL'
  add column if not exists entity_name   text,     -- operational entity, e.g. 'SPPL(K)'
  add column if not exists factory_code  text,     -- 'SPPLK_REHLA' — never displayed
  add column if not exists legacy_names  text[],   -- {'SPPL'} → alias search after rename
  add column if not exists is_factory    boolean default true,   -- false = office/HQ
  add column if not exists is_active     boolean default true;   -- false = retired

-- factory_code is the technical key → must be unique, but only where set.
create unique index if not exists plants_factory_code_key
  on plants (factory_code) where factory_code is not null;

create index if not exists plants_location_id_idx on plants (location_id);
create index if not exists plants_active_factory_idx on plants (is_active, is_factory);

comment on column plants.name is
  'DISPLAY ONLY — "<entity_name> – <location.name>". Never use as a technical key; use factory_code.';
comment on column plants.factory_code is
  'Stable technical key. Business logic, migrations and integrations key off this, never off name.';
comment on column plants.legacy_names is
  'Previous display names, kept so alias search still resolves them after a rename.';

-- ── 3. Seed the three locations ─────────────────────────────────────────────
insert into locations (state, name, code) values
  ('Jharkhand',     'Rehla',        'REHLA'),
  ('Odisha',        'Ganjam',       'GANJAM'),
  ('Uttar Pradesh', 'Sikandrabad',  'SIKANDRABAD')
on conflict (state, name) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL — tag the four EXISTING factory rows.
--
-- Anchored on each row's CURRENT name, and guarded by `factory_code is null`
-- so a re-run after 58 has renamed them is a no-op rather than a mis-match.
-- The fifth factory, SPPL(K) – Rehla, does not exist yet; 58 creates it.
-- `SCPL Delhi` is deliberately NOT tagged here — 58 folds its data into the
-- Sikandrabad row and retires it.
-- ═══════════════════════════════════════════════════════════════════════════
update plants p
   set location_id  = l.id,
       company_name = v.company_name,
       entity_name  = v.entity_name,
       factory_code = v.factory_code,
       is_factory   = true,
       is_active    = true
  from (values
    -- current name | company   | entity           | factory_code          | location code
    ('Madan',        'Madan Chemical', 'Madan Chemical', 'MADAN_SIKANDRABAD', 'SIKANDRABAD'),
    ('Ganjam',       'SCPL',           'SCPL',           'SCPL_GANJAM',       'GANJAM'),
    ('Rehla',        'SCPL',           'SCPL',           'SCPL_REHLA',        'REHLA'),
    ('SPPL',         'SPPL',           'SPPL',           'SPPL_REHLA',        'REHLA')
  ) as v(cur_name, company_name, entity_name, factory_code, loc_code)
  join locations l on l.code = v.loc_code
 where p.name = v.cur_name
   and p.factory_code is null;

-- ── 4. Geofence coordinates ─────────────────────────────────────────────────
-- ⚠️ Seven of the nine live rows carry PLACEHOLDER coordinates: SPPL sits in
-- Ahmedabad, K.G in Patna, Madan in Gurgaon. These drive the night-duty
-- check-in geofence (validateGeofence + plants.geofence_radius_m), so a wrong
-- pin means check-ins are accepted or rejected in the wrong place.
--
-- The values below are APPROXIMATE TOWN CENTRES, not surveyed gate positions.
-- They are a large improvement on what is there now, but before the geofence
-- is relied on for attendance each factory's actual gate coordinates should be
-- captured on site and this block re-run with the real numbers.
update plants set lat = 24.1333, lng = 84.0500, geofence_radius_m = coalesce(geofence_radius_m, 500)
 where factory_code in ('SCPL_REHLA', 'SPPL_REHLA');                 -- Rehla, Palamu, Jharkhand
update plants set lat = 19.3833, lng = 85.0500, geofence_radius_m = coalesce(geofence_radius_m, 500)
 where factory_code = 'SCPL_GANJAM';                                  -- Ganjam, Odisha
update plants set lat = 28.4515, lng = 77.6989, geofence_radius_m = coalesce(geofence_radius_m, 500)
 where factory_code = 'MADAN_SIKANDRABAD';                            -- Sikandrabad, Bulandshahr, UP

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   Confirm the hierarchy resolved:
--     select l.state, l.name as location, p.company_name, p.entity_name,
--            p.factory_code, p.name as current_display_name
--       from plants p left join locations l on l.id = p.location_id
--      where p.factory_code is not null
--      order by l.state, l.name, p.entity_name;
--
--   Rows still untagged (expected: SCPL Delhi, SHD, K.G, SCPL Odisha, HQ — all
--   handled by 58):
--     select id, name from plants where factory_code is null order by name;
