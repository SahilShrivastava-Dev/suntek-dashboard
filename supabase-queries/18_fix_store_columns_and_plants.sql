-- ─────────────────────────────────────────────────────────────────────────────
-- 18_fix_store_columns_and_plants.sql
-- Run in the Supabase SQL editor (runs as owner — bypasses RLS).
--
-- Two fixes discovered while wiring the interlinked Purchase workflow:
--   1) The live DB is missing migration 08b (store-availability + handover
--      columns). The app's handover flow, the Store-register qty, and the
--      Activity-Log handover event all depend on these. Re-apply them here.
--   2) The plants table is empty (UI falls back to a hardcoded list, so every
--      maintenance row has plant_id = null and shows "—"). Seed the 4 plants
--      so the Rehla / SHD / Ganjam / HQ labels resolve across all tabs.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Missing store-request columns (idempotent)
alter table maintenance_store_requests
  add column if not exists qty_in_store          numeric,
  add column if not exists shelf_location        text,
  add column if not exists part_condition        text,
  add column if not exists handover_invoice_url  text,
  add column if not exists handover_photo_url    text,
  add column if not exists handover_notes        text,
  add column if not exists handover_confirmed_at timestamptz;

-- 2) Seed plants (only if empty)
insert into plants (name, lat, lng, geofence_radius_m)
select * from (values
  ('SHD',    23.79, 86.43, 300),
  ('Rehla',  24.13, 84.05, 300),
  ('Ganjam', 19.39, 85.05, 300),
  ('HQ',     22.57, 88.36, 200)
) as v(name, lat, lng, geofence_radius_m)
where not exists (select 1 from plants);

-- After running this, tell Claude — the seeded Rehla rows will be relinked to the
-- Rehla plant and enriched with in-store qty + handover photos.
