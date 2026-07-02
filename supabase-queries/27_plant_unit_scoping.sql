-- ═══════════════════════════════════════════════════════════════════════════
-- 27_plant_unit_scoping.sql — Phase 1 data model for plant → unit data isolation
-- ═══════════════════════════════════════════════════════════════════════════
-- Goal: a user's SCOPE = the set of plants (and optionally units within a plant)
-- they belong to, plus a `is_global` flag for people who see everything (Owner /
-- Admin, all-India "Delhi" accountant). This migration only adds the model + a
-- safe backfill; it keeps the permissive `anon_all` RLS for now. Phase 2 replaces
-- those policies with real per-scope enforcement.
--
-- Nested model (chosen): Plant → Unit. A unit belongs to exactly one plant, so
-- "Chlorides at Rehla" and a future "Chlorides at Ganjam" are distinct unit rows.
-- This replaces the fragile unitOf(plantName).includes('chlorid') string hack.
--
-- Run once in the (client) Supabase SQL Editor. Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. units — sub-divisions of a plant ─────────────────────────────────────
create table if not exists units (
  id         uuid primary key default gen_random_uuid(),
  plant_id   uuid not null references plants(id) on delete cascade,
  name       text not null,           -- display, e.g. 'Chlorides'
  code       text,                    -- optional slug used by legacy routing, e.g. 'chlorides'
  created_at timestamptz default now(),
  unique (plant_id, name)
);
create index if not exists units_plant_id_idx on units (plant_id);
alter table units enable row level security;
drop policy if exists "anon_all" on units;
create policy "anon_all" on units for all using (true) with check (true);

-- ── 2. user_plants — which plants a user belongs to (many-to-many) ──────────
-- Lets one user (e.g. Pankaj) be scoped to several plants at once.
create table if not exists user_plants (
  user_account_id uuid not null references user_accounts(id) on delete cascade,
  plant_id        uuid not null references plants(id) on delete cascade,
  primary key (user_account_id, plant_id)
);
create index if not exists user_plants_plant_id_idx on user_plants (plant_id);
alter table user_plants enable row level security;
drop policy if exists "anon_all" on user_plants;
create policy "anon_all" on user_plants for all using (true) with check (true);

-- ── 3. user_units — optional narrowing to specific unit(s) within a plant ───
-- Empty for a user = they see ALL units of the plants they belong to. Non-empty
-- = they are restricted to just those units (e.g. the Chlorides store manager).
create table if not exists user_units (
  user_account_id uuid not null references user_accounts(id) on delete cascade,
  unit_id         uuid not null references units(id) on delete cascade,
  primary key (user_account_id, unit_id)
);
create index if not exists user_units_unit_id_idx on user_units (unit_id);
alter table user_units enable row level security;
drop policy if exists "anon_all" on user_units;
create policy "anon_all" on user_units for all using (true) with check (true);

-- ── 4. is_global — sees every plant regardless of membership ────────────────
alter table user_accounts
  add column if not exists is_global boolean default false;

-- ── 5. notifications carry the plant/unit they concern ──────────────────────
-- NULL plant_id = broadcast (delivered by role only, as today). A set plant_id
-- means "role X AT this plant" — delivery filters it to in-scope / global users.
alter table notifications
  add column if not exists plant_id uuid references plants(id),
  add column if not exists unit_id  uuid references units(id);
create index if not exists notifications_plant_id_idx on notifications (plant_id);

-- ── 6. unit_id on the unit-routed tables (alongside the legacy `unit` text) ──
alter table maintenance_tickets
  add column if not exists unit_id uuid references units(id);
alter table store_requisitions
  add column if not exists unit_id uuid references units(id);

-- ── 7. plant_id on financial tables that lack it ────────────────────────────
-- Required so a plant-scoped accountant sees only their plant's ledger. Existing
-- rows stay NULL (untagged) → visible to global accountants only until tagged.
alter table sales_contracts  add column if not exists plant_id uuid references plants(id);
alter table customers        add column if not exists plant_id uuid references plants(id);
alter table oil_contracts    add column if not exists plant_id uuid references plants(id);
alter table marine_insurance add column if not exists plant_id uuid references plants(id);

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL — derive the new columns from existing data (safe / idempotent)
-- ═══════════════════════════════════════════════════════════════════════════

-- 8a. Seed Rehla's two procurement units (matches migration 16's routing). Adjust
--     / add more units per your real org via the admin UI or additional inserts.
insert into units (plant_id, name, code)
select p.id, v.name, v.code
from plants p
cross join (values ('Chlorides', 'chlorides'), ('Plasticiser', 'plasticiser')) as v(name, code)
where p.name = 'Rehla'
on conflict (plant_id, name) do nothing;

-- 8b. Link existing maintenance tickets to their unit row via the legacy text.
update maintenance_tickets t
set unit_id = u.id
from units u
where t.unit_id is null
  and t.unit is not null
  and u.plant_id = t.plant_id
  and lower(u.code) = lower(t.unit);

-- 8c. Every user's current single plant becomes their first membership.
insert into user_plants (user_account_id, plant_id)
select id, plant_id
from user_accounts
where plant_id is not null
on conflict do nothing;

-- 8d. Tag oil contracts to a plant from their destination `port` name.
update oil_contracts c
set plant_id = p.id
from plants p
where c.plant_id is null
  and c.port is not null
  and lower(trim(c.port)) = lower(p.name);

-- 8e. Owner/Admin and the all-India (Delhi) accountant see everything.
update user_accounts
set is_global = true
where is_global is not true
  and role_id in ('admin', 'accountant_delhi');

-- ── Diagnostics (optional) ──────────────────────────────────────────────────
--   Users with no plant + not global (would see nothing once Phase 2 RLS is on):
--   select id, name, role_id from user_accounts ua
--   where is_global is not true
--     and not exists (select 1 from user_plants up where up.user_account_id = ua.id);
