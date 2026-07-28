-- ═══════════════════════════════════════════════════════════════════════════
-- 63_rehla_far_split.sql — give each Rehla factory its own FAR (TEST DATA)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️  THIS SPLIT IS A FIXTURE, NOT THE TRUTH.  ⚠️⚠️
--
-- The client's requirement is "FAR different for all 3" at Rehla. Today every
-- Rehla asset sits on ONE factory, so the isolation cannot be exercised: there
-- is nothing to prove SPPL(K) can't see SCPL's assets, because SPPL(K) has none.
--
-- The source register (`Fixed Assets Register-SPPL.xlsx`) has NO factory column
-- and bare identification marks (GLC1…GLC16). Nothing in any client file says
-- which entity owns which machine, so the real ownership CANNOT be derived —
-- it needs a marked-up register from the client. Until that arrives this
-- migration deals the assets out deterministically so all three registers are
-- populated and the isolation tests are meaningful.
--
--   DO NOT treat the resulting ownership as correct.
--   DO NOT run this against a database holding real asset values.
--   Replace it with the client's real split (rerun 63_rollback first).
--
-- HOW IT SPLITS
-- ntile(3) over (account_head, identification_mark) — deterministic, evenly
-- sized, and keeps assets of the same account head adjacent so each factory
-- gets coherent groups of machinery rather than a random scatter.
--
-- Maintenance follows the asset: a preventive schedule moves with the equipment
-- it maintains, and any ticket linked to a moved asset moves with it too —
-- otherwise the fixture would immediately violate the very rule it exists to
-- test ("a ticket's asset must belong to the ticket's factory").
--
-- Requires 57/58 (factory_code, SPPL(K) row). Idempotent — records the original
-- owner so a re-run is a no-op. Reversible via 63_rollback_rehla_far_split.sql.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists far_split_pre63_backup (
  asset_id        uuid primary key,
  orig_plant_id   uuid not null,
  snapshot_at     timestamptz default now()
);
create table if not exists sched_split_pre63_backup (
  schedule_id     uuid primary key,
  orig_plant_id   uuid,
  snapshot_at     timestamptz default now()
);
create table if not exists ticket_split_pre63_backup (
  ticket_id       uuid primary key,
  orig_plant_id   uuid,
  snapshot_at     timestamptz default now()
);

do $$
declare
  v_rehla   uuid[];
  v_loc     uuid;
  v_assets  bigint;
  v_scheds  bigint;
  v_tickets bigint;
begin
  select id into v_loc from locations where code = 'REHLA';
  if v_loc is null then
    raise exception '57_locations.sql has not been applied (no REHLA location).';
  end if;

  -- Target factories, in a STABLE order so ntile bucket N always maps to the
  -- same factory across runs and environments.
  select array_agg(id order by factory_code)
    into v_rehla
    from plants
   where factory_code in ('SCPL_REHLA', 'SPPL_REHLA', 'SPPLK_REHLA')
     and is_active;

  if array_length(v_rehla, 1) <> 3 then
    raise exception
      'Expected 3 active Rehla factories (SCPL/SPPL/SPPLK) but found %. Apply 58 first.',
      coalesce(array_length(v_rehla, 1), 0);
  end if;

  if exists (select 1 from far_split_pre63_backup) then
    raise notice 'FAR split already applied — nothing to do.';
    return;
  end if;

  -- ── 1. Assets ─────────────────────────────────────────────────────────────
  insert into far_split_pre63_backup (asset_id, orig_plant_id)
    select id, plant_id from fixed_assets where plant_id = any(v_rehla);

  with dealt as (
    select fa.id,
           v_rehla[ntile(3) over (
             order by coalesce(fa.account_head, ''), coalesce(fa.identification_mark, ''), fa.id
           )] as new_plant
      from fixed_assets fa
     where fa.plant_id = any(v_rehla)
  )
  update fixed_assets fa
     set plant_id = d.new_plant
    from dealt d
   where fa.id = d.id and fa.plant_id is distinct from d.new_plant;
  get diagnostics v_assets = row_count;

  -- ── 2. Preventive schedules follow their equipment ────────────────────────
  -- Linked by far_asset_id where present, else by identification mark / name.
  insert into sched_split_pre63_backup (schedule_id, orig_plant_id)
    select id, plant_id from maintenance_schedules where plant_id = any(v_rehla);

  update maintenance_schedules ms
     set plant_id = fa.plant_id
    from fixed_assets fa
   where ms.plant_id = any(v_rehla)
     and fa.id = ms.far_asset_id
     and ms.plant_id is distinct from fa.plant_id;
  get diagnostics v_scheds = row_count;

  update maintenance_schedules ms
     set plant_id = fa.plant_id
    from fixed_assets fa
   where ms.plant_id = any(v_rehla)
     and ms.far_asset_id is null
     and fa.plant_id = any(v_rehla)
     and lower(btrim(coalesce(ms.equipment_mark, ms.equipment)))
         = lower(btrim(coalesce(fa.identification_mark, fa.name)))
     and ms.plant_id is distinct from fa.plant_id;

  -- ── 3. Tickets follow their asset ─────────────────────────────────────────
  -- A ticket whose far_asset_id now points at another factory's register would
  -- break the rule this fixture exists to demonstrate, so move it too.
  insert into ticket_split_pre63_backup (ticket_id, orig_plant_id)
    select id, plant_id from maintenance_tickets where plant_id = any(v_rehla);

  update maintenance_tickets mt
     set plant_id = fa.plant_id
    from fixed_assets fa
   where mt.plant_id = any(v_rehla)
     and fa.id = mt.far_asset_id
     and mt.plant_id is distinct from fa.plant_id;
  get diagnostics v_tickets = row_count;

  -- unit_id belonged to the old Chlorides/Plasticiser sub-units, which are
  -- retired now that the factories themselves carry that meaning. A stale
  -- unit_id pointing into another factory would fail plant_unit_in_scope().
  update maintenance_tickets mt
     set unit_id = null
    from units u
   where mt.unit_id = u.id and mt.plant_id is distinct from u.plant_id;

  raise notice 'FIXTURE APPLIED — % asset(s), % schedule(s), % ticket(s) redistributed across the 3 Rehla factories.',
               v_assets, v_scheds, v_tickets;
  raise notice 'This ownership is ARBITRARY. Replace it with the client''s marked-up register.';
end $$;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   Each Rehla factory now has its own register:
--     select p.name, count(fa.*) as assets
--       from plants p left join fixed_assets fa on fa.plant_id = p.id
--      where p.factory_code in ('SCPL_REHLA','SPPL_REHLA','SPPLK_REHLA')
--      group by p.name order by p.name;
--
--   No ticket points at another factory's asset (expect zero — test F-1):
--     select count(*) from maintenance_tickets t
--       join fixed_assets fa on fa.id = t.far_asset_id
--      where fa.plant_id is distinct from t.plant_id;
--
--   Stock is still shared while the FARs are separate — the whole point:
--     select s.name as store, count(distinct f.plant_id) as factories_served
--       from stores s join factory_store_access f on f.store_id = s.id
--      where s.code = 'REHLA_COMMON' group by s.name;
