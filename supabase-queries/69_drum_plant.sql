-- ═══════════════════════════════════════════════════════════════════════════
-- 69_drum_plant.sql — the sixth factory: Drum Plant – SCPL Rehla
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES
--   1. Creates the plant row  'Drum Plant – SCPL Rehla'  (factory_code DRUM_REHLA).
--   2. Creates its OWN store  'Drum Plant Store'          (code DRUM_REHLA_STORE).
--   3. Maps the two together with ONE factory_store_access row.
--   4. Asserts the isolation the client asked for before committing.
--
-- ═══ WHY THREE ROWS ARE THE WHOLE FEATURE ═══════════════════════════════════
-- The client's requirement is that the Drum Plant sits physically at the Rehla
-- site but behaves as a COMPLETELY INDEPENDENT entity: its own Fixed Asset
-- Register, stock register, store, maintenance, requisitions, purchase orders
-- and reports — sharing nothing with SCPL / SPPL / SPPL(K) – Rehla.
--
-- The 57→62 model already expresses exactly that, because it separates the two
-- questions that used to be one column:
--     store_id  → WHERE the stock physically is
--     plant_id  → WHO owns the asset and WHO pays
--
-- So independence is not code, it is the ABSENCE of a row: the three SCPL/SPPL
-- factories each have a factory_store_access row pointing at REHLA_COMMON;
-- the Drum Plant has one pointing at its own store instead. Consequences, all
-- for free:
--   • Stock      — store_items is unique(store_id, item_name) since 62, and a
--                  different store_id is a different register. Nothing is
--                  shared, nothing is summed, nothing is double-counted.
--   • FAR        — fixed_assets is plant-scoped (28's plant_in_scope RLS) and
--                  has no store_id at all, so a new plant_id is a new FAR.
--   • Maintenance— maintenance_schedules / maintenance_tickets are plant-scoped
--                  on the same policy.
--   • Requisitions & POs — maintenance_store_requests carries both plant_id and
--                  source_store_id, and canDrawFrom() (lib/store/registers.ts)
--                  only permits a factory to draw from a store it is MAPPED to.
--                  With no link to REHLA_COMMON the Drum Plant simply cannot
--                  requisition against the shared register, and vice versa.
--   • Permissions— user_plants / user_stores are separate grants (59 §3), so
--                  'Drum Plant' and 'Drum Plant Store' appear as their own
--                  checkboxes in User Management, unlinked from Rehla Common
--                  Store. That is requirement §1's "separate plant/store value".
--
-- ═══ WHY NO FRONTEND CHANGE IS NEEDED ═══════════════════════════════════════
-- Every picker in the app reads the plant/store master live —
-- fetchActivePlants() (src/lib/plants.ts) and allowedPlants / allowedStores /
-- storeIdFor() (src/contexts/PlantScopeContext.tsx). No screen holds a
-- hard-coded factory list any more (that was cleaned up alongside 58). So the
-- new factory appears in the plant master, user & store access, FAR, stock
-- register, maintenance, schedule setup, store requisition, purchase orders,
-- upload forms, filters and dashboards the moment this file is applied.
--
-- ═══ WHAT IT DELIBERATELY DOES NOT DO ═══════════════════════════════════════
--   • Does NOT touch REHLA_COMMON or any of its three links. Requirement §11 —
--     existing Rehla common-stock behaviour is unchanged for those entities.
--   • Does NOT create `units` rows. Chlorides and Plasticiser are SCPL/SPPL
--     procurement units (seeded by 58 §7 for those three factories only); the
--     Drum Plant operates at plant level and a spurious unit would appear in
--     the procurement-unit selector as a choice that means nothing.
--   • Does NOT copy any asset, item, schedule or requisition from the Rehla
--     entities. An independent entity starts empty, by definition.
--
-- Requires 57 (locations, factory_code), 59 (stores, factory_store_access),
-- 60 (REHLA_COMMON — so the exclusion can be asserted rather than assumed).
-- Idempotent — re-running is a no-op. Reversible via 69_rollback_drum_plant.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.stores') is null
     or to_regclass('public.factory_store_access') is null then
    raise exception '59_stores.sql has not been applied (no stores / factory_store_access).';
  end if;
  if not exists (select 1 from locations where code = 'REHLA') then
    raise exception '57_locations.sql has not been applied (no REHLA location).';
  end if;
  if not exists (select 1 from stores where code = 'REHLA_COMMON') then
    raise exception
      '60_rehla_common_store.sql has not been applied (no REHLA_COMMON store). '
      'This file asserts the Drum Plant is EXCLUDED from the common store, which '
      'cannot be verified before that store exists.';
  end if;
end $$;

-- ── 1. The factory ──────────────────────────────────────────────────────────
-- Named verbatim as the client specified. Note this deviates from the
-- '<Entity> – <Location>' pattern the other five follow ('Drum Plant – Rehla'
-- would have matched it) — the client chose the explicit form so the parent
-- entity is visible in every picker. factory_code is the stable technical key;
-- nothing in the app or the RLS keys on the display name, so the label can be
-- changed later with a one-line update and no migration.
--
-- geofence: copied from SCPL – Rehla, because the Drum Plant is at the same
-- site and night-duty check-in (routes/night-manager/CheckIn.tsx) measures
-- against the factory's own centre. Adjust if the client supplies real coords.
insert into plants (name, location_id, company_name, entity_name, factory_code,
                    is_factory, is_active, lat, lng, geofence_radius_m)
select 'Drum Plant – SCPL Rehla',
       l.id,
       'SCPL',        -- owning legal entity: it sits under SCPL Rehla
       'Drum Plant',  -- operational entity
       'DRUM_REHLA',
       true, true,
       r.lat, r.lng, coalesce(r.geofence_radius_m, 500)
  from locations l
  left join plants r on r.factory_code = 'SCPL_REHLA'
 where l.code = 'REHLA'
   and not exists (select 1 from plants where factory_code = 'DRUM_REHLA');

-- ── 2. Its own store ────────────────────────────────────────────────────────
-- Same location as the Rehla common store (they are on one site) but a
-- SEPARATE row, which is what keeps the two registers apart.
insert into stores (location_id, name, code, is_active)
select l.id, 'Drum Plant Store', 'DRUM_REHLA_STORE', true
  from locations l
 where l.code = 'REHLA'
on conflict (code) do nothing;

-- ── 3. The single link ──────────────────────────────────────────────────────
-- One row, to its own store. This is the line that makes the Drum Plant
-- independent — and the absence of a second row pointing at REHLA_COMMON is
-- what satisfies acceptance criteria 2 and 12.
insert into factory_store_access (plant_id, store_id)
select p.id, s.id
  from plants p
  join stores s on s.code = 'DRUM_REHLA_STORE'
 where p.factory_code = 'DRUM_REHLA'
on conflict do nothing;

-- ── 4. Store access for whoever already administers everything ──────────────
-- Global users (is_global) need no grant — they see every store by definition
-- (PlantScopeContext.allowedStores). Nothing is granted to anyone else here:
-- who may use the Drum Plant store is an admin decision, made in User
-- Management. Deliberately NOT derived from Rehla membership — an SCPL – Rehla
-- store keeper must not silently acquire the Drum Plant's register.

-- ── 5. Assert the isolation before we call this done ────────────────────────
do $$
declare
  v_plant uuid;
  v_store uuid;
  v_n     integer;
begin
  select id into v_plant from plants where factory_code = 'DRUM_REHLA';
  select id into v_store from stores where code = 'DRUM_REHLA_STORE';

  if v_plant is null then raise exception 'Drum Plant row was not created.'; end if;
  if v_store is null then raise exception 'Drum Plant Store row was not created.'; end if;

  -- Exactly one store, and it is its own.
  select count(*) into v_n from factory_store_access where plant_id = v_plant;
  if v_n <> 1 then
    raise exception 'Drum Plant maps to % stores; expected exactly 1.', v_n;
  end if;
  if not exists (select 1 from factory_store_access
                  where plant_id = v_plant and store_id = v_store) then
    raise exception 'Drum Plant is not mapped to its own store.';
  end if;

  -- The whole point: NOT the shared Rehla register.
  if exists (select 1 from factory_store_access fsa
               join stores s on s.id = fsa.store_id
              where fsa.plant_id = v_plant and s.code = 'REHLA_COMMON') then
    raise exception
      'Drum Plant is linked to REHLA_COMMON. It must be completely independent '
      'of the Rehla common store (requirement §1, acceptance criteria 2 & 12).';
  end if;

  -- And nobody else drew on the Drum Plant's store.
  select count(*) into v_n from factory_store_access where store_id = v_store;
  if v_n <> 1 then
    raise exception 'Drum Plant Store serves % factories; expected exactly 1.', v_n;
  end if;

  -- The three existing Rehla factories are untouched (requirement §11).
  select count(*) into v_n
    from factory_store_access fsa
    join stores s on s.id = fsa.store_id
    join plants p on p.id = fsa.plant_id
   where s.code = 'REHLA_COMMON'
     and p.factory_code in ('SCPL_REHLA','SPPL_REHLA','SPPLK_REHLA');
  if v_n <> 3 then
    raise exception
      'REHLA_COMMON now serves % of the three original Rehla factories; expected 3. '
      'Existing common-store behaviour must not change.', v_n;
  end if;

  raise notice 'Drum Plant – SCPL Rehla (%) → Drum Plant Store (%). Isolated: OK.',
               v_plant, v_store;
end $$;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   The six factories and the store each draws from:
--     select l.state, l.name as location, p.entity_name, p.name as factory, s.name as store
--       from plants p
--       join locations l on l.id = p.location_id
--       left join factory_store_access fsa on fsa.plant_id = p.id
--       left join stores s on s.id = fsa.store_id
--      where p.is_active and p.is_factory
--      order by l.state, l.name, p.entity_name;
--
--   Rehla site: four factories, two stores (three share one, Drum Plant has its own):
--     select s.name as store, count(*) as factories, string_agg(p.name, ', ' order by p.name)
--       from factory_store_access fsa
--       join stores s on s.id = fsa.store_id
--       join plants p on p.id = fsa.plant_id
--       join locations l on l.id = p.location_id
--      where l.code = 'REHLA' group by s.name;
--
--   Nothing is shared (expect zero rows on all three):
--     select count(*) from store_items where store_id in
--       (select id from stores where code in ('DRUM_REHLA_STORE','REHLA_COMMON'))
--      group by lower(btrim(item_name)) having count(distinct store_id) > 1;
--
--   Full acceptance sweep: run 99_verify_factory_store_model.sql (section I).
