-- ═══════════════════════════════════════════════════════════════════════════
-- 58_rename_plants.sql — nine plant rows → five clearly-named factories
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES
--   1. Snapshots `plants` so the rename is reversible.
--   2. Creates the fifth factory, SPPL(K) – Rehla.
--   3. Folds `SCPL Delhi`'s data into the Sikandrabad row, then retires it.
--   4. Renames the four surviving factories to '<Entity> – <Location>'.
--   5. Retires SHD / K.G / SCPL Odisha / HQ (flag only — never DELETE).
--   6. Refreshes the three columns that COPY a plant name instead of joining it.
--   7. Replicates the Chlorides / Plasticiser units under all three Rehla
--      factories so the procurement-unit selector works for each of them.
--
-- ═══ WHY RENAMING IS SAFE FOR PERMISSIONS ═══════════════════════════════════
-- Access is keyed on `plants.id` (a uuid), never on the name:
--   • user_plants.plant_id / user_units.unit_id — uuid foreign keys
--   • RLS my_plant_ids() / plant_in_scope() — uuid joins (28_rls_phase2a)
--   • the auth JWT carries only { name, role_id } — no plant at all
-- So NO user assignment changes, NO permission is granted or revoked, and
-- NOBODY has to log in again. `plants.id` is not touched by this migration.
--
-- ═══ THE FIVE FACTORIES ═════════════════════════════════════════════════════
--   Uttar Pradesh → Sikandrabad → Madan Chemical – Sikandrabad   (was 'Madan')
--   Odisha        → Ganjam      → SCPL – Ganjam                  (was 'Ganjam')
--   Jharkhand     → Rehla       → SCPL – Rehla                   (was 'Rehla')
--                               → SPPL – Rehla                   (was 'SPPL')
--                               → SPPL(K) – Rehla                (new)
--
-- Retired: SCPL Delhi (data folded into Sikandrabad), SHD, K.G, SCPL Odisha, HQ.
-- Retirement means is_active = false. Rows are NEVER deleted, so every
-- historical foreign key stays valid and no audit trail is broken.
--
-- ⚠️ RUN THE FRONTEND CHANGES FIRST. Several screens still hold hard-coded
-- name arrays or match plants by name (PurchaseOrders.tsx, CheckIn.tsx,
-- NightManagerBoard.tsx, Maintenance.tsx). Deploy those fixes before running
-- this, or those screens will show stale names / fail to resolve a plant.
--
-- Requires 57 (locations, factory_code). Idempotent — re-running is a no-op.
-- Reversible via 58_rollback_rename.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Snapshot for rollback ────────────────────────────────────────────────
-- Captures the pre-rename state of every plant row AND the SCPL Delhi → Madan
-- remap, so 58_rollback_rename.sql can put everything back exactly.
create table if not exists plants_pre58_backup as
  select id, name, lat, lng, geofence_radius_m, now() as snapshot_at from plants;

create table if not exists plant_remap_pre58_backup (
  table_name text   not null,
  row_id     text   not null,
  from_plant uuid   not null,
  to_plant   uuid   not null,
  snapshot_at timestamptz default now()
);

-- user_plants is snapshotted WHOLE rather than per-remapped-row. Its primary
-- key is (user_account_id, plant_id), so the forward remap is insert-then-
-- delete; from the delta alone the rollback could not tell whether a
-- destination membership pre-existed or was created here. A full copy removes
-- the ambiguity — and it is the table where being wrong would silently change
-- someone's access, which this migration must never do.
create table if not exists user_plants_pre58_backup as
  select user_account_id, plant_id, now() as snapshot_at from user_plants;

do $$
declare
  v_madan      uuid;
  v_ganjam     uuid;
  v_scpl_rehla uuid;
  v_sppl       uuid;
  v_spplk      uuid;
  v_delhi      uuid;
  v_loc_rehla  uuid;
  v_col        record;
  v_moved      bigint;
  v_total      bigint := 0;
begin
  -- ── 1. Resolve the rows we are about to touch ─────────────────────────────
  -- Keyed on factory_code (set by 57) so this block is safe to re-run after the
  -- names have already changed. SCPL Delhi has no factory_code, so it is found
  -- by name — and only on the first run, since step 3 retires it.
  select id into v_madan      from plants where factory_code = 'MADAN_SIKANDRABAD';
  select id into v_ganjam     from plants where factory_code = 'SCPL_GANJAM';
  select id into v_scpl_rehla from plants where factory_code = 'SCPL_REHLA';
  select id into v_sppl       from plants where factory_code = 'SPPL_REHLA';

  if v_madan is null or v_ganjam is null or v_scpl_rehla is null or v_sppl is null then
    raise exception
      '57_locations.sql has not been applied (factory_code is unset on one or more '
      'factories). Run 57 first.';
  end if;

  select id into v_loc_rehla from locations where code = 'REHLA';

  -- ── 2. Create the fifth factory: SPPL(K) – Rehla ──────────────────────────
  -- A separate `plants` row, NOT a `units` row. fixed_assets and
  -- maintenance_schedules have no unit_id column, so a unit could not carry its
  -- own FAR or preventive-maintenance register — which is precisely what the
  -- client requires ("FAR different for all 3, maintenance different for all 3").
  -- As a plant it inherits the already-live plant_in_scope() RLS for free.
  -- It shares company_name with SPPL – Rehla; that is what records the
  -- parent/child relationship shown in the client's org diagram.
  select id into v_spplk from plants where factory_code = 'SPPLK_REHLA';
  if v_spplk is null then
    insert into plants (name, location_id, company_name, entity_name, factory_code,
                        is_factory, is_active, lat, lng, geofence_radius_m)
    values ('SPPL(K) – Rehla', v_loc_rehla, 'SPPL', 'SPPL(K)', 'SPPLK_REHLA',
            true, true, 24.1333, 84.0500, 500)
    returning id into v_spplk;
    raise notice 'Created factory SPPL(K) – Rehla (%)', v_spplk;
  end if;

  -- ── 3. Fold `SCPL Delhi` into the Sikandrabad row ─────────────────────────
  -- SCPL Delhi holds ~331 assets, ~242 tickets and ~241 schedules that are a
  -- byte-for-byte duplicate of SPPL's — the result of the same source file
  -- having been imported against several plants (FAR.tsx flat-maps rows across
  -- a multi-select of factories). The client has confirmed the present contents
  -- are test data and that this row belongs with Madan Chemical – Sikandrabad.
  select id into v_delhi from plants where name = 'SCPL Delhi' and factory_code is null;

  if v_delhi is not null then
    -- user_plants first: its PRIMARY KEY is (user_account_id, plant_id), so a
    -- straight UPDATE would collide for any user who is in both plants.
    -- Insert-then-delete keeps membership without ever dropping access.
    insert into user_plants (user_account_id, plant_id)
      select user_account_id, v_madan from user_plants where plant_id = v_delhi
      on conflict do nothing;
    delete from user_plants where plant_id = v_delhi;
    -- (reversal comes from user_plants_pre58_backup, snapshotted above)

    -- Everything else: remap dynamically so no table can be missed as the
    -- schema grows. Any table whose plant_id participates in a unique
    -- constraint will raise here rather than silently lose rows — SCPL Delhi
    -- holds no store/upload/unit rows, so this is a guard, not an expectation.
    for v_col in
      select c.table_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public'
         and c.column_name  = 'plant_id'
         and t.table_type   = 'BASE TABLE'
         -- user_plants is handled above; the *_pre58_backup tables are this
         -- migration's own rollback data and must never be rewritten by it
         -- (user_plants_pre58_backup carries a plant_id column of its own).
         and c.table_name not in ('user_plants')
         and c.table_name not like '%\_pre58\_backup'
       order by c.table_name
    loop
      begin
        execute format(
          'insert into plant_remap_pre58_backup (table_name, row_id, from_plant, to_plant)
             select %L, coalesce(t.id::text, ''(no id column)''), %L, %L from %I t where t.plant_id = %L',
          v_col.table_name, v_delhi, v_madan, v_col.table_name, v_delhi);
      exception when undefined_column then
        -- table has plant_id but no id column (e.g. join tables) — skip the
        -- per-row backup; the plants snapshot still allows a manual reversal.
        null;
      end;

      begin
        execute format('update %I set plant_id = %L where plant_id = %L',
                       v_col.table_name, v_madan, v_delhi);
        get diagnostics v_moved = row_count;
      exception when unique_violation then
        raise exception
          'Remapping SCPL Delhi → Sikandrabad collided on table "%". A row with the '
          'same natural key already exists under the destination plant. Resolve the '
          'duplicate manually, then re-run.', v_col.table_name;
      end;

      if v_moved > 0 then
        v_total := v_total + v_moved;
        raise notice '  remapped % row(s) in %', v_moved, v_col.table_name;
      end if;
    end loop;

    raise notice 'Folded SCPL Delhi (%) into Madan Chemical – Sikandrabad (%): % row(s)',
                 v_delhi, v_madan, v_total;
  end if;
end $$;

-- ── 4. Rename the four survivors ────────────────────────────────────────────
-- The old display name is preserved in legacy_names BEFORE the rename, so
-- alias search (globalSearch.ts) and the rollback both still resolve it.
update plants
   set legacy_names = (
         select array_agg(distinct x)
           from unnest(coalesce(legacy_names, '{}') || array[name]) as x
       )
 where factory_code in ('MADAN_SIKANDRABAD','SCPL_GANJAM','SCPL_REHLA','SPPL_REHLA')
   and not (coalesce(legacy_names, '{}') @> array[name]);

update plants p
   set name = v.new_name
  from (values
    ('MADAN_SIKANDRABAD', 'Madan Chemical – Sikandrabad'),
    ('SCPL_GANJAM',       'SCPL – Ganjam'),
    ('SCPL_REHLA',        'SCPL – Rehla'),
    ('SPPL_REHLA',        'SPPL – Rehla')
  ) as v(code, new_name)
 where p.factory_code = v.code
   and p.name <> v.new_name;

-- ── 5. Retire the non-factory rows ──────────────────────────────────────────
-- Flag only. The rows survive so every historical foreign key stays valid;
-- the app filters pickers on is_active, so they stop being selectable without
-- any history being rewritten.
update plants
   set is_active   = false,
       is_factory  = false,
       legacy_names = (
         select array_agg(distinct x)
           from unnest(coalesce(legacy_names, '{}') || array[name]) as x
       )
 where name in ('SCPL Delhi', 'SHD', 'K.G', 'SCPL Odisha', 'HQ')
   and factory_code is null
   and coalesce(is_active, true);

-- ── 6. Refresh the columns that COPY a plant name ───────────────────────────
-- Three places store a plant NAME rather than joining it, so they go stale on
-- rename. Everything else in the app reads `plants(name)` live and updates on
-- its own.

-- 6a. user_accounts.plant_name — display fallback + indexed by Cmd+K search.
update user_accounts ua
   set plant_name = p.name
  from plants p
 where ua.plant_id = p.id
   and ua.plant_name is distinct from p.name;

-- 6b. anomaly_flags.plant — free text that the Anomaly Operations Center
--     GROUPS AND FILTERS on. Left alone, the filter would list the old and new
--     names as two separate options. Matched against the pre-rename names held
--     in legacy_names.
update anomaly_flags a
   set plant = p.name
  from plants p
 where a.plant is not null
   and a.plant <> p.name
   and p.legacy_names @> array[a.plant];

-- 6c. oil_contracts.port — a destination plant recorded by name. Tag the
--     structured plant_id from it (mirrors 27 §8d) so future joins stop
--     depending on the string.
update oil_contracts c
   set plant_id = p.id
  from plants p
 where c.plant_id is null
   and c.port is not null
   and (lower(trim(c.port)) = lower(p.name)
        or exists (select 1 from unnest(coalesce(p.legacy_names,'{}')) ln
                    where lower(ln) = lower(trim(c.port))));

-- ── 7. Procurement units for every Rehla factory ────────────────────────────
-- `units` is unique(plant_id, name) and a unit belongs to exactly one plant
-- (27's model: "Chlorides at Rehla" and "Chlorides at Ganjam" are distinct
-- rows). The two Jharkhand units currently exist only under the row that is
-- now SCPL – Rehla, so without this the procurement-unit selector — which
-- Maintenance.tsx derives from unit names — would appear for SCPL – Rehla
-- alone and never for SPPL or SPPL(K).
insert into units (plant_id, name, code)
select p.id, v.name, v.code
  from plants p
 cross join (values ('Chlorides', 'chlorides'), ('Plasticiser', 'plasticiser')) as v(name, code)
 where p.factory_code in ('SCPL_REHLA', 'SPPL_REHLA', 'SPPLK_REHLA')
on conflict (plant_id, name) do nothing;

-- Link any ticket still carrying the legacy `unit` text to its unit row
-- (same backfill as 27 §8b, re-run for the newly created unit rows).
update maintenance_tickets t
   set unit_id = u.id
  from units u
 where t.unit_id is null
   and t.unit is not null
   and u.plant_id = t.plant_id
   and lower(u.code) = lower(t.unit);

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   The five factories:
--     select l.state, l.name as location, p.company_name, p.entity_name, p.name
--       from plants p join locations l on l.id = p.location_id
--      where p.is_active and p.is_factory
--      order by l.state, l.name, p.entity_name;
--
--   Retired rows and what they used to be called:
--     select name, legacy_names, is_active from plants where not is_active;
--
--   No user lost access (every membership still resolves to a live factory):
--     select ua.name, p.name as factory, p.is_active
--       from user_plants up
--       join user_accounts ua on ua.id = up.user_account_id
--       join plants p on p.id = up.plant_id
--      order by ua.name;
--
--   Nothing still points at a retired plant:
--     select p.name, count(*) from maintenance_tickets t join plants p on p.id = t.plant_id
--      where not p.is_active group by p.name;
