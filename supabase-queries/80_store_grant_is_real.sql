-- ═══════════════════════════════════════════════════════════════════════════
-- 80_store_grant_is_real.sql — finish what 61 started
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE TWO GRANTS
-- --------------
--   plant tick  → the FACTORY: its assets, its maintenance, its people, and the
--                 store it draws from. The wide grant.
--   store tick  → the STORE: everything that happened in it, whoever owns the
--                 stock, whatever the role. Deliberately does NOT carry the
--                 served factories' assets or maintenance.
--
-- WHAT WAS WRONG
-- --------------
-- Migration 61 moved the core register tables onto the store predicates —
-- `store_in_scope(store_id) or store_in_plant_scope(store_id)` — and 72 did the
-- same for the anomaly table. Everything AROUND them was left on
-- `plant_in_scope(plant_id)`:
--
--   53  stock_purchase_receipts, stock_purchase_lines
--   54  store_stock_anomaly_events   (given a store_id by 72; policy not moved)
--   55  repair_return_receipts, repair_return_allocations
--   70  import_batches, import_batch_deletions
--
-- On a one-factory-one-store site that is invisible: both grants select the
-- same rows. At Rehla it is fatal. Migration 60 merged three factories onto one
-- store and stamped every row with ONE anchor factory (SCPL – Rehla) — hence
-- the column comment store_items.plant_id already carries: "Do NOT filter by
-- it." A keeper granted the common store plus SPPL – Rehla and SPPL(K) – Rehla
-- reads `plant_id in (SPPL, SPPL(K))` against rows all stamped SCPL, and gets
-- nothing.
--
-- 72 has the mirror-image gap: `store_in_scope(store_id)` alone is the DIRECT
-- grant only, so a unit head who reaches their store through their factory —
-- with no user_stores row — cannot read their own anomalies.
--
-- THE FIX
-- -------
-- One predicate composing the three that already exist, so there is a single
-- answer to "may I see this store-keyed row":
--
--   store_row_in_scope(store, plant)
--     = store_in_scope(store)              -- ticked directly (user_stores)
--    or store_in_plant_scope(store)        -- reached via a factory I am in
--    or (store is null and plant_in_scope(plant))
--                                          -- no store on the row: it predates
--                                          -- 59, or it is factory-owned (a FAR
--                                          -- or PM import batch)
--
-- The last clause can never reach a row that HAS a store, so a factory grant
-- still cannot pull in the stock of a store it was not given.
--
-- Strictly widening: no policy here removes access anybody has today.
-- fixed_assets is deliberately untouched — 61 asserts that a shared store must
-- never imply a shared FAR, and that assertion still holds after this file.
--
-- Requires 53, 54, 55, 59, 61, 70, 72. Idempotent.
-- Rollback: 80_rollback_store_grant_is_real.sql
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.store_in_scope(uuid)') is null then
    raise exception '59_stores.sql has not been applied (no store_in_scope).';
  end if;
  if to_regprocedure('public.store_in_plant_scope(uuid)') is null then
    raise exception '59_stores.sql has not been applied (no store_in_plant_scope).';
  end if;
end $$;

-- ── 1. The predicate ──────────────────────────────────────────────────────
-- Composes 59's helpers rather than restating them: one place to change if the
-- membership rules ever move. Mirrors storeScopeFilter() in
-- src/lib/store/registers.ts — the app filter and the RLS predicate must agree,
-- or the UI shows a count the database will not serve.
create or replace function public.store_row_in_scope(p_store uuid, p_plant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.store_in_scope(p_store)
      or public.store_in_plant_scope(p_store)
      or (p_store is null and public.plant_in_scope(p_plant));
$$;

comment on function public.store_row_in_scope(uuid, uuid) is
  'Row predicate for store-keyed tables. A ticked store grants the WHOLE store regardless of which factory owns the stock; a factory grant reaches its own store via factory_store_access; a store-less row falls back to the factory that owns it. Never use plant_in_scope alone on a table that carries a store id.';

grant execute on function public.store_row_in_scope(uuid, uuid) to anon, authenticated;

-- ── 2. The purchase ledger (53) ───────────────────────────────────────────
-- Read only — writes stay with the SECURITY DEFINER RPC, because this is money.
do $$
declare tbl text;
begin
  foreach tbl in array array['stock_purchase_receipts','stock_purchase_lines'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "scope_read" on %I', tbl);
    execute format(
      'create policy "scope_read" on %I for select using (public.store_row_in_scope(store_id, plant_id))', tbl);
  end loop;
end $$;

-- ── 3. Anomaly review trail (54 + 72) ─────────────────────────────────────
-- 72 gave store_stock_anomaly_events a store_id but left its policy on
-- plant_in_scope, and gave store_stock_anomalies the direct grant only. Both
-- move to the composed predicate.
alter table store_stock_anomaly_events enable row level security;
drop policy if exists "scope_read" on store_stock_anomaly_events;
drop policy if exists "store_all"  on store_stock_anomaly_events;
create policy "scope_read" on store_stock_anomaly_events for select
  using (public.store_row_in_scope(store_id, plant_id));

drop policy if exists "store_all"  on store_stock_anomalies;
drop policy if exists "scope_read" on store_stock_anomalies;
create policy "store_all" on store_stock_anomalies for all
  using      (public.store_row_in_scope(store_id, plant_id))
  with check (public.store_row_in_scope(store_id, plant_id));

-- ── 4. Repair returns (55) ────────────────────────────────────────────────
-- A repaired part comes back into the STORE, not into the factory that sent it
-- out. Allocations have no store column; they are reached through the receipt.
alter table repair_return_receipts enable row level security;
drop policy if exists "scope_read" on repair_return_receipts;
create policy "scope_read" on repair_return_receipts for select
  using (public.store_row_in_scope(store_id, plant_id));

alter table repair_return_allocations enable row level security;
drop policy if exists "scope_read" on repair_return_allocations;
create policy "scope_read" on repair_return_allocations for select
  using (exists (
    select 1 from repair_return_receipts r
     where r.id = repair_return_allocations.receipt_id
       and public.store_row_in_scope(r.store_id, r.plant_id)
  ));

-- ── 5. Upload history (70) ────────────────────────────────────────────────
-- A stock batch carries a store_id; FAR and PM batches carry none and stay
-- factory-owned through the null clause. Without this the keeper who uploaded a
-- shared store's workbook cannot see it in his own history — so he cannot
-- delete it either, which is the one thing Upload History exists to allow.
alter table import_batches enable row level security;
drop policy if exists "scope_all" on import_batches;
create policy "scope_all" on import_batches for all
  using      (public.store_row_in_scope(store_id, plant_id))
  with check (public.store_row_in_scope(store_id, plant_id));

-- The deletion audit has no store of its own — add one, backfilled from the
-- batch it records, so the tombstone is visible to whoever could see the batch.
alter table import_batch_deletions add column if not exists store_id uuid references stores(id) on delete set null;

update import_batch_deletions d
   set store_id = b.store_id
  from import_batches b
 where b.id = d.batch_id and d.store_id is null and b.store_id is not null;

create index if not exists import_batch_deletions_store_idx
  on import_batch_deletions (store_id) where store_id is not null;

drop policy if exists "scope_read" on import_batch_deletions;
create policy "scope_read" on import_batch_deletions for select
  using (public.store_row_in_scope(store_id, plant_id));

-- The audit row is written by delete_import_batch(), which is SECURITY DEFINER
-- and so is not subject to the policy above. Stamp the store on the way in, or
-- every future deletion lands with a null store_id and falls back to the anchor
-- factory — reintroducing this exact bug one row at a time. A trigger rather
-- than an edit to that function, so the two migrations stay independent.
create or replace function public.import_batch_deletion_store()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.store_id is null then
    select b.store_id into new.store_id from import_batches b where b.id = new.batch_id;
  end if;
  return new;
end $$;

drop trigger if exists import_batch_deletions_store_trg on import_batch_deletions;
create trigger import_batch_deletions_store_trg
  before insert on import_batch_deletions
  for each row execute function public.import_batch_deletion_store();

-- ── 6. Guard: a store must still never grant assets ───────────────────────
-- Restated from 61 so a future edit here cannot quietly widen the FAR.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fixed_assets'
       and (coalesce(qual,'') like '%store_%scope%' or coalesce(with_check,'') like '%store_%scope%'))
  then
    raise exception
      'fixed_assets policy references store scope. FAR must remain factory-scoped '
      '(plant_in_scope) — store access must never grant asset access.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--   No store-keyed table is left on plant scope alone (expect 0 rows):
--     select tablename, policyname, qual from pg_policies
--      where schemaname = 'public'
--        and tablename in ('store_items','store_stock_months','store_stock_uploads',
--                          'store_stock_events','stock_purchase_receipts',
--                          'stock_purchase_lines','store_stock_anomalies',
--                          'store_stock_anomaly_events','repair_return_receipts',
--                          'maintenance_store_requests','import_batches',
--                          'import_batch_deletions')
--        and coalesce(qual,'') not like '%store%scope%';
--
--   FAR is still factory-only (expect >= 1 row):
--     select policyname, qual from pg_policies
--      where schemaname='public' and tablename='fixed_assets'
--        and qual like '%plant_in_scope%';
--
--   The regression this file closes — Rehla rows are stamped with ONE factory,
--   so a plant filter cannot serve a keeper granted the other two:
--     select count(*) as rows, count(distinct plant_id) as anchors
--       from store_items
--      where store_id = (select id from stores where code = 'REHLA_COMMON');
--     -- expect: many rows, exactly 1 anchor
--
--   What a given user reaches (run as that user):
--     select public.store_row_in_scope(
--              (select id from stores where code = 'REHLA_COMMON'), null);
-- ═══════════════════════════════════════════════════════════════════════════
