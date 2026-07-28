-- ═══════════════════════════════════════════════════════════════════════════
-- 65_tag_events_and_requests.sql — finish what 62 started
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE ACCEPTANCE SWEEP CAUGHT
--   E5  store_stock_events with no store_id / requesting_plant_id   → 1 row
--   G2  maintenance_store_requests with no source_store_id          → 1 row
--
-- 62 added a trigger so no stock ROW could be created without its store, and
-- repointed the RPC item lookups. It did NOT protect the two tables that record
-- the MOVEMENT and the REQUEST, so several writers still insert them untagged:
--
--   • apply_stock_purchase()          (53) — inserts store_stock_events with
--     plant_id but no store_id / requesting_plant_id
--   • apply_repair_return() and
--     record_defective_disposition()  (56) — likewise
--   • the split-fulfilment path in Maintenance.tsx — creates the shortfall
--     request row without source_store_id
--
-- So these are not historical stragglers: every future purchase, repair return
-- and partial fulfilment would add another untagged row, and each one is
-- invisible to the per-factory reconciliation — which is the entire reason
-- those columns exist.
--
-- THE FIX — the same defence-in-depth 62 used, applied where it should have
-- been from the start: a BEFORE INSERT/UPDATE trigger on each table, so the
-- columns are filled no matter which writer is responsible, including writers
-- added later.
--
-- Derivation, in order of trust:
--   store_stock_events.store_id            ← factory's store, else the ITEM's store
--   store_stock_events.requesting_plant_id ← plant_id (who the movement is for)
--   maintenance_store_requests.source_store_id ← factory's store, else the
--                                                TICKET's factory's store
-- The item/ticket fallbacks are what rescue rows whose plant_id is itself null
-- — the case 59's plant-keyed backfill could never reach.
--
-- Requires 59 (store columns), 62 (store_for_plant). Idempotent.
-- Reversible via 65_rollback_tag_events_and_requests.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Stock movements always carry where AND who ───────────────────────────
create or replace function public.store_stock_events_fill_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.store_id is null then
    new.store_id := coalesce(
      public.store_for_plant(new.plant_id),
      (select si.store_id from store_items si where si.id = new.item_id)
    );
  end if;
  -- Who the movement is for, and therefore who carries the cost.
  if new.requesting_plant_id is null then
    new.requesting_plant_id := coalesce(
      new.plant_id,
      (select si.plant_id from store_items si where si.id = new.item_id)
    );
  end if;
  return new;
end $$;

drop trigger if exists store_stock_events_fill_scope on store_stock_events;
create trigger store_stock_events_fill_scope
  before insert or update of plant_id, store_id, requesting_plant_id, item_id
  on store_stock_events
  for each row execute function public.store_stock_events_fill_scope();

-- ── 2. Part requests always name their source store ─────────────────────────
create or replace function public.msr_fill_source_store()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source_store_id is null then
    new.source_store_id := coalesce(
      public.store_for_plant(new.plant_id),
      -- plant_id itself missing → fall back to the ticket's factory
      (select public.store_for_plant(t.plant_id)
         from maintenance_tickets t where t.id = new.ticket_id)
    );
  end if;
  -- Same fallback for the requesting factory, so cost attribution is not lost.
  if new.plant_id is null then
    new.plant_id := (select t.plant_id from maintenance_tickets t where t.id = new.ticket_id);
  end if;
  return new;
end $$;

drop trigger if exists msr_fill_source_store on maintenance_store_requests;
create trigger msr_fill_source_store
  before insert or update of plant_id, source_store_id, ticket_id
  on maintenance_store_requests
  for each row execute function public.msr_fill_source_store();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Backfill the rows already recorded untagged
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_a bigint; v_b bigint; v_c bigint; v_d bigint;
begin
  -- Events: factory's store first, then the item's store for plant-less rows.
  update store_stock_events e
     set store_id = coalesce(public.store_for_plant(e.plant_id),
                             (select si.store_id from store_items si where si.id = e.item_id))
   where e.store_id is null;
  get diagnostics v_a = row_count;

  update store_stock_events e
     set requesting_plant_id = coalesce(e.plant_id,
                                        (select si.plant_id from store_items si where si.id = e.item_id))
   where e.requesting_plant_id is null;
  get diagnostics v_b = row_count;

  -- Requests: inherit the ticket's factory where the row has none of its own.
  update maintenance_store_requests r
     set plant_id = t.plant_id
    from maintenance_tickets t
   where r.plant_id is null and t.id = r.ticket_id and t.plant_id is not null;
  get diagnostics v_c = row_count;

  update maintenance_store_requests r
     set source_store_id = coalesce(public.store_for_plant(r.plant_id),
                                    (select public.store_for_plant(t.plant_id)
                                       from maintenance_tickets t where t.id = r.ticket_id))
   where r.source_store_id is null;
  get diagnostics v_d = row_count;

  raise notice 'Tagged % event store(s), % event factor(ies), % request factor(ies), % request store(s).',
               v_a, v_b, v_c, v_d;

  -- Report anything still untagged: it means the row has no factory, no ticket
  -- and no register item to inherit from, so it must be looked at by hand
  -- rather than quietly left behind.
  if exists (select 1 from store_stock_events where store_id is null or requesting_plant_id is null) then
    raise warning
      'Still untagged: % stock event(s) have no factory, ticket or register item to inherit from.',
      (select count(*) from store_stock_events where store_id is null or requesting_plant_id is null);
  end if;
  if exists (select 1 from maintenance_store_requests where source_store_id is null) then
    raise warning
      'Still untagged: % part request(s) could not resolve a source store.',
      (select count(*) from maintenance_store_requests where source_store_id is null);
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── Diagnostics — these are sweep checks E5 and G2 ──────────────────────────
--   select count(*) from store_stock_events where store_id is null or requesting_plant_id is null;
--   select count(*) from maintenance_store_requests where plant_id is null or source_store_id is null;
--
--   If either is still non-zero, see what the stragglers are missing:
--     select id, item_id, plant_id, store_id, requesting_plant_id, event_type, ref, created_at
--       from store_stock_events where store_id is null or requesting_plant_id is null;
--     select id, ticket_id, plant_id, source_store_id, part_name, created_at
--       from maintenance_store_requests where plant_id is null or source_store_id is null;
