-- ═══════════════════════════════════════════════════════════════════════════
-- 59_stores.sql — stores as a first-class entity, separate from factories
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PROBLEM
-- There is no `stores` table. `store_items` is unique(plant_id, item_name), so
-- inventory identity IS (factory, item) — the store and the factory are the
-- same row. Three consequences:
--   • A store shared by several factories is inexpressible. The three Rehla
--     factories share one physical store, so the same monthly workbook was
--     uploaded twice (once as 'Rehla', once as 'SPPL') and the register now
--     holds 434 items TWICE. StockRegister.tsx sums across plants to hide it.
--   • `plant_id` on every stock row answers two different questions at once —
--     "where is this stock" and "who paid for it" — so consumption from a
--     shared store cannot be attributed to the factory that asked for it.
--   • Store access and factory access are the same grant, so letting a store
--     keeper serve three factories would hand them all three FARs.
--
-- THE MODEL
--     store_id            → WHERE the stock physically is
--     plant_id / requesting_plant_id → WHO owns the asset and WHO pays
--
--   stores                — a physical store room, hung off a location
--   factory_store_access  — factory ↔ store, many-to-many
--   user_stores           — store access as its own grant, NOT implied by
--                           factory access (brief §17)
--
-- THIS FILE IS ADDITIVE AND BEHAVIOUR-NEUTRAL. It creates one store per active
-- factory (an identity mapping), so every factory still resolves to exactly
-- one store and every query returns exactly what it did before. The Rehla
-- merge — the only step that changes what anyone sees — is 60, on its own.
-- `plant_id` is retained on every table so 59 can be reverted freely.
--
-- Requires 57 (locations), 58 (factory_code, is_active), 28 (is_global_user),
-- 37 (store_items / events / uploads), 53 (stock_purchase_receipts),
-- 55 (repair_return_receipts). Idempotent. Reversible via 59_rollback_stores.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Store master ─────────────────────────────────────────────────────────
create table if not exists stores (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  name        text not null,              -- 'Rehla Common Store'
  code        text unique,                -- 'REHLA_COMMON' — stable technical key
  is_active   boolean default true,
  created_at  timestamptz default now()
);
create index if not exists stores_location_id_idx on stores (location_id);

-- Reference data, same posture as plants/locations: readable so labels and
-- pickers resolve. What you may DO with a store is gated by user_stores (61).
alter table stores enable row level security;
drop policy if exists "anon read stores" on stores;
create policy "anon read stores" on stores for select to anon, authenticated using (true);

-- ── 2. Factory ↔ store, many-to-many ────────────────────────────────────────
-- One row per factory  ⇒ today's behaviour, exactly.
-- Three rows onto one store ⇒ the Rehla common store.
create table if not exists factory_store_access (
  plant_id   uuid not null references plants(id) on delete cascade,
  store_id   uuid not null references stores(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (plant_id, store_id)
);
create index if not exists factory_store_access_store_idx on factory_store_access (store_id);

alter table factory_store_access enable row level security;
drop policy if exists "anon read factory_store_access" on factory_store_access;
create policy "anon read factory_store_access" on factory_store_access
  for select to anon, authenticated using (true);

-- ── 3. Store access as its own grant ────────────────────────────────────────
-- Deliberately parallel to user_plants, and deliberately NOT derived from it.
-- A Rehla store keeper gets user_stores = {Rehla Common Store} and
-- user_plants = {} — one part queue across three factories, and no FAR.
create table if not exists user_stores (
  user_account_id uuid not null references user_accounts(id) on delete cascade,
  store_id        uuid not null references stores(id) on delete cascade,
  created_at      timestamptz default now(),
  primary key (user_account_id, store_id)
);
create index if not exists user_stores_store_idx on user_stores (store_id);

alter table user_stores enable row level security;
drop policy if exists "anon_all" on user_stores;
create policy "anon_all" on user_stores for all using (true) with check (true);

-- ── 4. Split the overloaded plant_id ────────────────────────────────────────
-- plant_id is RETAINED on all of these. Until 60 runs it stays authoritative;
-- after 60 store_id is authoritative and plant_id is a legacy anchor (see the
-- column comments below). Keeping both is what makes 59 and 60 revertible.
alter table store_items
  add column if not exists store_id     uuid references stores(id),
  add column if not exists reserved_qty numeric not null default 0;

alter table store_stock_events
  add column if not exists store_id            uuid references stores(id),
  add column if not exists requesting_plant_id uuid references plants(id);

alter table maintenance_store_requests
  add column if not exists source_store_id uuid references stores(id);

alter table store_stock_uploads   add column if not exists store_id uuid references stores(id);
alter table store_stock_months    add column if not exists store_id uuid references stores(id);
alter table stock_purchase_receipts add column if not exists store_id uuid references stores(id);
alter table stock_purchase_lines    add column if not exists store_id uuid references stores(id);
alter table repair_return_receipts  add column if not exists store_id uuid references stores(id);

create index if not exists store_items_store_idx        on store_items (store_id);
create index if not exists store_items_store_name_idx   on store_items (store_id, lower(item_name));
create index if not exists store_stock_events_store_idx on store_stock_events (store_id);
create index if not exists store_stock_events_req_plant_idx
  on store_stock_events (requesting_plant_id, created_at desc);
create index if not exists store_stock_months_store_idx on store_stock_months (store_id, period_month);
create index if not exists msr_source_store_idx on maintenance_store_requests (source_store_id);

-- Reserved stock can never exceed what is on hand, and never go negative.
-- Paired with the existing store_items_on_hand_nonneg check (39).
alter table store_items drop constraint if exists store_items_reserved_sane;
alter table store_items add constraint store_items_reserved_sane
  check (reserved_qty >= 0 and reserved_qty <= on_hand);

comment on column store_items.store_id is
  'AUTHORITATIVE from migration 60 onward — where the stock physically is. Filter by this, not plant_id.';
comment on column store_items.plant_id is
  'LEGACY ANCHOR after migration 60. With a shared store this is ambiguous (one row, several owning factories). Retained only so 59/60 stay revertible. Do NOT filter by it.';
comment on column store_items.reserved_qty is
  'Soft-reserved by approved-but-not-yet-handed-over part requests. Free stock = on_hand - reserved_qty.';
comment on column store_stock_events.store_id is
  'The store the stock moved in or out of.';
comment on column store_stock_events.requesting_plant_id is
  'The factory that asked and that carries the cost. With a shared store this differs from the store owner — it is what makes per-factory consumption reporting possible.';
comment on column maintenance_store_requests.source_store_id is
  'Store the part is drawn from. plant_id on the same row remains the REQUESTING factory.';

-- ── 5. Scope predicate, mirroring plant_in_scope() from 28 ──────────────────
create or replace function public.my_store_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select us.store_id
    from user_stores us
    join user_accounts ua on ua.id = us.user_account_id
   where ua.auth_user_id = auth.uid();
$$;

create or replace function public.store_in_scope(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_global_user()
      or (p_store is not null and p_store in (select public.my_store_ids()));
$$;

-- Does the current user reach this store via a factory they belong to? Used so
-- a unit head keeps seeing their own store without needing a user_stores row.
create or replace function public.store_in_plant_scope(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_global_user()
      or (p_store is not null and exists (
            select 1 from factory_store_access fsa
             where fsa.store_id = p_store
               and fsa.plant_id in (select public.my_plant_ids())));
$$;

grant execute on function
  public.my_store_ids(), public.store_in_scope(uuid), public.store_in_plant_scope(uuid)
  to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL — identity mapping. One store per active factory ⇒ NOTHING CHANGES.
-- ═══════════════════════════════════════════════════════════════════════════

-- 6a. A store per active factory, named for its location. The three Rehla
--     factories each get their own for now; 60 collapses them into one.
insert into stores (location_id, name, code)
select p.location_id,
       coalesce(l.name, p.entity_name, p.name) || ' Store',
       p.factory_code || '_STORE'
  from plants p
  left join locations l on l.id = p.location_id
 where p.is_active and p.is_factory and p.factory_code is not null
on conflict (code) do nothing;

insert into factory_store_access (plant_id, store_id)
select p.id, s.id
  from plants p
  join stores s on s.code = p.factory_code || '_STORE'
 where p.is_active and p.is_factory and p.factory_code is not null
on conflict do nothing;

-- 6b. Point every existing stock row at its factory's store.
update store_items t          set store_id = f.store_id from factory_store_access f
 where t.store_id is null and t.plant_id = f.plant_id;
update store_stock_events t   set store_id = f.store_id from factory_store_access f
 where t.store_id is null and t.plant_id = f.plant_id;
update store_stock_uploads t  set store_id = f.store_id from factory_store_access f
 where t.store_id is null and t.plant_id = f.plant_id;
update store_stock_months t   set store_id = f.store_id from factory_store_access f
 where t.store_id is null and t.plant_id = f.plant_id;
update stock_purchase_receipts t set store_id = f.store_id from factory_store_access f
 where t.store_id is null and t.plant_id = f.plant_id;
update stock_purchase_lines t    set store_id = f.store_id from factory_store_access f
 where t.store_id is null and t.plant_id = f.plant_id;
update repair_return_receipts t  set store_id = f.store_id from factory_store_access f
 where t.store_id is null and t.plant_id = f.plant_id;

-- 6c. Historical stock events: the requesting factory was, by definition, the
--     factory that owned the store. Backfilling makes pre-existing history
--     comparable with everything recorded from now on.
update store_stock_events
   set requesting_plant_id = plant_id
 where requesting_plant_id is null and plant_id is not null;

-- 6d. Existing part requests drew from their own factory's store.
update maintenance_store_requests t
   set source_store_id = f.store_id
  from factory_store_access f
 where t.source_store_id is null and t.plant_id = f.plant_id;

-- 6e. user_stores from user_plants — ADDITIVE ONLY. Everyone keeps exactly the
--     store access their factory membership already implied, so day one is
--     identical. Nothing is revoked and nothing new is granted.
insert into user_stores (user_account_id, store_id)
select distinct up.user_account_id, f.store_id
  from user_plants up
  join factory_store_access f on f.plant_id = up.plant_id
on conflict do nothing;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   Factory → store mapping (expect exactly one store each at this point):
--     select p.name as factory, s.name as store, s.code
--       from factory_store_access f
--       join plants p on p.id = f.plant_id
--       join stores s on s.id = f.store_id
--      order by p.name;
--
--   Nothing left unmapped:
--     select 'store_items' t, count(*) from store_items where store_id is null
--     union all select 'store_stock_events', count(*) from store_stock_events where store_id is null
--     union all select 'store_stock_months', count(*) from store_stock_months where store_id is null;
--
--   The duplication 60 will resolve — same item name in two Rehla stores:
--     select si.item_name, count(distinct si.store_id) stores, sum(si.on_hand) total
--       from store_items si join stores s on s.id = si.store_id
--       join factory_store_access f on f.store_id = s.id
--       join plants p on p.id = f.plant_id join locations l on l.id = p.location_id
--      where l.code = 'REHLA'
--      group by si.item_name having count(distinct si.store_id) > 1
--      order by si.item_name;
