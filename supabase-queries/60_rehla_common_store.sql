-- ═══════════════════════════════════════════════════════════════════════════
-- 60_rehla_common_store.sql — three Rehla registers → one shared store
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ THE ONLY MIGRATION IN THIS SET THAT CHANGES WHAT PEOPLE SEE. Everything
-- before it is additive or behaviour-neutral. Snapshot tables are written
-- first and 60_rollback_rehla_common_store.sql restores from them.
--
-- WHAT IT FIXES
-- SCPL – Rehla, SPPL – Rehla and SPPL(K) – Rehla share ONE physical store, but
-- the schema had no way to say so, so the same monthly workbook was imported
-- against more than one plant. The register holds the same ~434 items twice —
-- 100% overlap by name — and StockRegister.tsx sums across plants to hide it.
-- Stock is double-counted; issuing from one copy leaves the other untouched.
--
-- WHAT IT DOES
--   1. Creates 'Rehla Common Store'.
--   2. Collapses duplicate register rows to one per item, repointing every
--      child record (events, purchase lines, repair allocations, part
--      requests, defective parts) onto the survivor FIRST so no history is
--      lost — store_stock_events.item_id is ON DELETE CASCADE and would
--      otherwise take the audit trail with it.
--   3. Repoints all Rehla stock data at the common store.
--   4. Maps all three factories to it and retires the per-factory Rehla stores.
--   5. Makes store_id the authoritative key: unique(store_id, item_name).
--
-- DUPLICATE RESOLUTION — the surviving row is the one with the HIGHEST
-- on_hand (ties broken by oldest created_at, then id). Quantities are NOT
-- summed: the copies are the same file imported twice, so adding them would
-- double the stock. Any item whose copies disagree on on_hand is reported as
-- a NOTICE — read the output, because that is where a genuine drift would show.
--
-- Requires 59 (stores, store_id columns). Idempotent.
-- Reversible via 60_rollback_rehla_common_store.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.stores') is null then
    raise exception '59_stores.sql has not been applied.';
  end if;
  if not exists (select 1 from locations where code = 'REHLA') then
    raise exception '57_locations.sql has not been applied (no REHLA location).';
  end if;
end $$;

-- ── 1. Snapshots ────────────────────────────────────────────────────────────
create table if not exists store_items_pre60_backup        as select *, now() as snapshot_at from store_items;
create table if not exists store_stock_events_pre60_backup as select *, now() as snapshot_at from store_stock_events;
create table if not exists store_stock_months_pre60_backup as select *, now() as snapshot_at from store_stock_months;
create table if not exists store_stock_uploads_pre60_backup as select *, now() as snapshot_at from store_stock_uploads;
create table if not exists factory_store_access_pre60_backup as select *, now() as snapshot_at from factory_store_access;
create table if not exists user_stores_pre60_backup        as select *, now() as snapshot_at from user_stores;

-- Which duplicate collapsed into which survivor. Persisted (not a temp table)
-- because the rollback needs it, and because it is the audit record of what
-- this migration judged to be the same item.
create table if not exists store_item_merge_pre60_backup (
  loser_id    uuid primary key,
  winner_id   uuid not null,
  item_name   text,
  loser_on_hand  numeric,
  winner_on_hand numeric,
  snapshot_at timestamptz default now()
);

-- Every child row whose store_item pointer this migration moved, with its
-- previous value — so the rollback can put each one back exactly, rather than
-- guessing which rows had already pointed at the survivor.
create table if not exists store_item_repoint_pre60_backup (
  child_table  text not null,
  child_column text not null,
  child_id     uuid not null,
  old_value    uuid not null,
  snapshot_at  timestamptz default now(),
  primary key (child_table, child_column, child_id)
);

do $$
declare
  v_common   uuid;
  v_loc      uuid;
  v_anchor   uuid;                 -- SCPL – Rehla: the legacy plant_id anchor
  v_old      uuid[];               -- the per-factory Rehla stores being retired
  v_fk       record;
  v_dupe     record;
  v_n        bigint;
  v_kept     bigint := 0;
  v_dropped  bigint := 0;
begin
  select id into v_loc    from locations where code = 'REHLA';
  select id into v_anchor from plants    where factory_code = 'SCPL_REHLA';

  -- Every store currently reachable from a Rehla factory.
  select coalesce(array_agg(distinct f.store_id), '{}')
    into v_old
    from factory_store_access f
    join plants p on p.id = f.plant_id
   where p.location_id = v_loc and p.is_active and p.is_factory;

  if array_length(v_old, 1) is null then
    raise exception 'No stores are mapped to any Rehla factory — run 59_stores.sql first.';
  end if;

  -- ── 2. The common store ───────────────────────────────────────────────────
  select id into v_common from stores where code = 'REHLA_COMMON';
  if v_common is null then
    insert into stores (location_id, name, code, is_active)
    values (v_loc, 'Rehla Common Store', 'REHLA_COMMON', true)
    returning id into v_common;
    raise notice 'Created Rehla Common Store (%)', v_common;
  end if;

  -- Nothing to do if the merge already ran.
  v_old := array_remove(v_old, v_common);
  if array_length(v_old, 1) is null then
    raise notice 'Rehla already uses the common store — nothing to merge.';
    return;
  end if;

  -- ── 3. Report any genuine quantity drift BEFORE collapsing ────────────────
  for v_dupe in
    select lower(regexp_replace(btrim(item_name), '\s+', ' ', 'g')) as k,
           count(*) as copies, min(on_hand) as lo, max(on_hand) as hi
      from store_items
     where store_id = any(v_old)
     group by 1
    having count(*) > 1 and min(on_hand) is distinct from max(on_hand)
  loop
    raise notice 'DRIFT: "%" has % copies with on_hand between % and % — keeping the highest',
                 v_dupe.k, v_dupe.copies, v_dupe.lo, v_dupe.hi;
  end loop;

  -- ── 4. Collapse duplicates ────────────────────────────────────────────────
  -- Winner per normalised item name; losers' children are repointed first.
  insert into store_item_merge_pre60_backup
        (loser_id, winner_id, item_name, loser_on_hand, winner_on_hand)
  select x.id, x.winner_id, x.item_name, x.on_hand, w.on_hand
    from (
      select si.id, si.item_name, si.on_hand,
             first_value(si.id) over (
               partition by lower(regexp_replace(btrim(si.item_name), '\s+', ' ', 'g'))
               order by si.on_hand desc nulls last, si.created_at asc, si.id
             ) as winner_id
        from store_items si
       where si.store_id = any(v_old)
    ) x
    join store_items w on w.id = x.winner_id
   where x.id <> x.winner_id
  on conflict (loser_id) do nothing;

  select count(*) into v_dropped from store_item_merge_pre60_backup;

  if v_dropped > 0 then
    -- Repoint every foreign key that references store_items, discovered from
    -- the catalogue so a newly-added child table cannot be missed. Each moved
    -- row's previous value is logged first, so the rollback is exact.
    for v_fk in
      select con.conrelid::regclass::text as child_table,
             att.attname                  as child_column
        from pg_constraint con
        join pg_attribute att
          on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
       where con.contype = 'f'
         and con.confrelid = 'public.store_items'::regclass
         and con.conrelid::regclass::text not like '%\_pre60\_backup'
    loop
      execute format(
        'insert into store_item_repoint_pre60_backup (child_table, child_column, child_id, old_value)
           select %L, %L, c.id, c.%I from %s c
            join store_item_merge_pre60_backup m on c.%I = m.loser_id
          on conflict do nothing',
        v_fk.child_table, v_fk.child_column, v_fk.child_column,
        v_fk.child_table, v_fk.child_column);

      execute format(
        'update %s c set %I = m.winner_id
           from store_item_merge_pre60_backup m where c.%I = m.loser_id',
        v_fk.child_table, v_fk.child_column, v_fk.child_column);
      get diagnostics v_n = row_count;
      if v_n > 0 then
        raise notice '  repointed % row(s) in %.%', v_n, v_fk.child_table, v_fk.child_column;
      end if;
    end loop;

    -- Carry the losers' movement history onto the survivor so the survivor's
    -- baseline/procured/issued breakdown still reconciles with its events.
    -- on_hand is deliberately NOT summed (see the header): the copies are the
    -- same import, so the survivor's own on_hand is already the true figure.
    update store_items w
       set procured_qty        = w.procured_qty        + agg.procured,
           issued_qty          = w.issued_qty          + agg.issued,
           manual_delta        = w.manual_delta        + agg.manual,
           ticket_procured_qty = coalesce(w.ticket_procured_qty, 0) + agg.ticket_procured,
           repaired_qty        = coalesce(w.repaired_qty, 0)        + agg.repaired
      from (
        select m.winner_id,
               sum(coalesce(l.procured_qty, 0))        as procured,
               sum(coalesce(l.issued_qty, 0))          as issued,
               sum(coalesce(l.manual_delta, 0))        as manual,
               sum(coalesce(l.ticket_procured_qty, 0)) as ticket_procured,
               sum(coalesce(l.repaired_qty, 0))        as repaired
          from store_item_merge_pre60_backup m
          join store_items l on l.id = m.loser_id
         group by m.winner_id
      ) agg
     where w.id = agg.winner_id;

    delete from store_items
     where id in (select loser_id from store_item_merge_pre60_backup);
    raise notice 'Collapsed % duplicate register row(s).', v_dropped;
  end if;

  -- ── 5. Repoint everything at the common store ─────────────────────────────
  update store_items set store_id = v_common, plant_id = v_anchor where store_id = any(v_old);
  get diagnostics v_kept = row_count;

  update store_stock_events     set store_id = v_common where store_id = any(v_old);
  update store_stock_months     set store_id = v_common where store_id = any(v_old);
  update stock_purchase_receipts set store_id = v_common where store_id = any(v_old);
  update stock_purchase_lines   set store_id = v_common where store_id = any(v_old);
  update repair_return_receipts set store_id = v_common where store_id = any(v_old);
  update maintenance_store_requests set source_store_id = v_common where source_store_id = any(v_old);

  -- Monthly uploads: one file per month for the whole location from now on.
  -- Keep the row with the most parsed rows; the others were the same workbook
  -- imported again under a second plant.
  delete from store_stock_uploads u
   using store_stock_uploads k
   where u.store_id = any(v_old) and k.store_id = any(v_old)
     and u.period_month = k.period_month
     and (coalesce(k.row_count,0), k.created_at, k.id) > (coalesce(u.row_count,0), u.created_at, u.id);
  update store_stock_uploads set store_id = v_common where store_id = any(v_old);

  -- Same for the parsed monthly snapshots: one row per item per month.
  delete from store_stock_months m
   using store_stock_months k
   where m.store_id = v_common and k.store_id = v_common
     and m.period_month = k.period_month
     and lower(btrim(m.item_name)) = lower(btrim(k.item_name))
     and (k.created_at, k.id) > (m.created_at, m.id);

  -- ── 6. Rewire access ──────────────────────────────────────────────────────
  insert into factory_store_access (plant_id, store_id)
  select p.id, v_common from plants p
   where p.location_id = v_loc and p.is_active and p.is_factory
  on conflict do nothing;

  delete from factory_store_access where store_id = any(v_old);

  insert into user_stores (user_account_id, store_id)
  select distinct user_account_id, v_common from user_stores where store_id = any(v_old)
  on conflict do nothing;
  delete from user_stores where store_id = any(v_old);

  update stores set is_active = false where id = any(v_old);

  raise notice 'Rehla Common Store now holds % item(s); % per-factory store(s) retired.',
               v_kept, array_length(v_old, 1);
end $$;

-- ── 7. store_id becomes the authoritative key ───────────────────────────────
-- Until now inventory identity was (plant, item). It is now (store, item),
-- which is what lets one register serve three factories.
alter table store_items drop constraint if exists store_items_plant_id_item_name_key;
create unique index if not exists store_items_store_item_key
  on store_items (store_id, item_name);

alter table store_stock_uploads drop constraint if exists store_stock_uploads_plant_id_period_month_key;
create unique index if not exists store_stock_uploads_store_month_key
  on store_stock_uploads (store_id, period_month);

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   All three Rehla factories on one store:
--     select p.name as factory, s.name as store
--       from factory_store_access f
--       join plants p on p.id = f.plant_id
--       join stores s on s.id = f.store_id
--      where s.code = 'REHLA_COMMON' order by p.name;
--
--   Stock now exists ONCE (expect zero rows):
--     select item_name, count(*) from store_items where store_id =
--       (select id from stores where code='REHLA_COMMON')
--      group by item_name having count(*) > 1;
--
--   No history was orphaned by the collapse (expect zero):
--     select count(*) from store_stock_events e
--      where e.item_id is not null
--        and not exists (select 1 from store_items si where si.id = e.item_id);
--
--   Events before vs after — the audit trail must be intact:
--     select (select count(*) from store_stock_events_pre60_backup) as before,
--            (select count(*) from store_stock_events)              as after;
