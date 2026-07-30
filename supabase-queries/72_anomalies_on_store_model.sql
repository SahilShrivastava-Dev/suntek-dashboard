-- ═══════════════════════════════════════════════════════════════════════════
-- 72_anomalies_on_store_model.sql — stock anomalies follow the STORE, not the
--                                   factory, and gain their provenance columns
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BUG (client-reported, critical)
-- Reviewing a stock anomaly failed with:
--     "Something went wrong. This record is linked to other records.
--      Remove those links first."
-- Nothing was linked to anything. That message is errors.ts rendering a raw
-- Postgres 23503 (foreign-key violation), and the violation is ours:
--
--   • store_stock_anomalies.plant_id is `not null references plants(id)`,
--     written by migration 54 — BEFORE stores existed.
--   • Since migration 60 the register key is a STORE id. registerIdOf() returns
--     store_id, StockRegister passes it as `plantId`, and resolve_stock_anomaly
--     inserts it into plant_id. A store id is not a plant id, so the insert is
--     rejected every single time.
--
-- So no anomaly at a shared-store site could EVER be reviewed. The anomaly
-- tables were simply never migrated to the store model; this file finishes that
-- job. It also means plant_in_scope() was being asked about a store id, which
-- would have failed scope for any non-global user even had the FK passed.
--
-- WHAT THIS DOES
--   1. Adds store_id (the authoritative register key) to both anomaly tables.
--   2. Backfills it from plant_id via factory_store_access, then relaxes
--      plant_id to nullable — a shared store has no single owning factory, so
--      requiring one was always wrong.
--   3. Re-keys the natural-key UNIQUE constraint onto store_id.
--   4. Adds the provenance columns the review screen needs to show WHICH two
--      figures were compared (prev/curr period and register side) — the absence
--      of which is what let a May→June anomaly be read as June→July.
--   5. Replaces resolve_stock_anomaly() to key on the store, scope on
--      store_in_scope(), and accept the provenance fields.
--
-- Requires 54 (anomaly tables), 59 (stores, factory_store_access, store_in_scope).
-- Idempotent. Reversible via 72_rollback_anomalies_on_store_model.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.store_stock_anomalies') is null then
    raise exception '54_stock_anomaly_resolutions.sql has not been applied.';
  end if;
  if to_regclass('public.stores') is null then
    raise exception '59_stores.sql has not been applied.';
  end if;
  if to_regprocedure('public.store_in_scope(uuid)') is null then
    raise exception '59_stores.sql has not been applied (no store_in_scope).';
  end if;
end $$;

-- ── 1. The register key ─────────────────────────────────────────────────────
alter table store_stock_anomalies       add column if not exists store_id uuid references stores(id) on delete cascade;
alter table store_stock_anomaly_events  add column if not exists store_id uuid references stores(id) on delete set null;

-- ── 2. Provenance — which two figures were compared ─────────────────────────
-- Requirement: "the review screen should show previous period, previous
-- register type, previous closing value, current period, current register type,
-- current opening value". Stored on the row so a reviewer sees the same
-- attribution later that they saw when they acted, even if the file is
-- re-uploaded and the numbers move.
alter table store_stock_anomalies add column if not exists prev_period   date;
alter table store_stock_anomalies add column if not exists curr_period   date;
alter table store_stock_anomalies add column if not exists prev_register text
  check (prev_register is null or prev_register in ('sales','purchase'));
alter table store_stock_anomalies add column if not exists curr_register text
  check (curr_register is null or curr_register in ('sales','purchase'));

-- The upload each side was read from, so an anomaly can be traced to the exact
-- file that produced it (and disappears cleanly when that batch is deleted).
alter table store_stock_anomalies add column if not exists prev_upload_id uuid;
alter table store_stock_anomalies add column if not exists curr_upload_id uuid;

-- ── 3. Backfill, then relax plant_id ────────────────────────────────────────
-- Existing rows are pre-store-model, so their plant_id is a real factory and
-- maps cleanly to a store. Rows created by the broken path do not exist — the
-- FK rejected every one of them, which is exactly why this bug went unnoticed
-- until someone tried to review an anomaly at Rehla.
update store_stock_anomalies a
   set store_id = f.store_id
  from factory_store_access f
 where a.store_id is null and a.plant_id = f.plant_id;

update store_stock_anomaly_events e
   set store_id = a.store_id
  from store_stock_anomalies a
 where e.store_id is null and e.anomaly_id = a.id;

-- A shared store serves several factories, so an anomaly about the SHARED
-- register genuinely has no single owning factory. plant_id stays as an
-- informational anchor for history and for the activity log.
alter table store_stock_anomalies      alter column plant_id drop not null;
alter table store_stock_anomaly_events alter column plant_id drop not null;

-- ── 4. Re-key the natural key onto the store ────────────────────────────────
-- The old constraint keyed on plant_id. At Rehla three factories share one
-- register, so the same anomaly reached through two different factories would
-- have produced two rows.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'store_stock_anomalies'::regclass
       and conname = 'store_stock_anomalies_plant_id_period_month_item_name_anoma_key'
  ) then
    alter table store_stock_anomalies
      drop constraint store_stock_anomalies_plant_id_period_month_item_name_anoma_key;
  end if;
end $$;

-- Partial unique index rather than a table constraint: store_id is nullable
-- during the transition, and a NULL store must not silently collide.
create unique index if not exists store_stock_anomalies_store_key
  on store_stock_anomalies (store_id, period_month, item_name, anomaly_type)
  where store_id is not null;

create index if not exists idx_ssa_store_month on store_stock_anomalies(store_id, period_month);

-- Widen the allowed anomaly types to include the new purchase-side carry check.
do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'store_stock_anomalies'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%anomaly_type%';
  if v_con is not null then
    execute format('alter table store_stock_anomalies drop constraint %I', v_con);
  end if;
end $$;

alter table store_stock_anomalies
  add constraint store_stock_anomalies_type_check
  check (anomaly_type in ('carry_forward','purchase_carry','intra_month','sheet_self','negative','added','removed'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. THE RPC — keyed on the store, scoped on the store
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.resolve_stock_anomaly(payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_store     uuid;
  v_plant     uuid;
  v_month     date;
  v_item      text;
  v_type      text;
  v_action    text;
  v_comment   text;
  v_corr      numeric;
  v_actor     uuid;
  v_actor_name text;
  v_row       store_stock_anomalies%rowtype;
  v_to_status text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_capability('resolve_stock_anomaly') then
    raise exception 'forbidden: missing capability resolve_stock_anomaly';
  end if;

  -- store_id is the key. plant_id is accepted for backward compatibility with
  -- an older client build and as the informational owning-factory anchor.
  v_store   := nullif(payload->>'store_id','')::uuid;
  v_plant   := nullif(payload->>'plant_id','')::uuid;
  v_month   := (payload->>'period_month')::date;
  v_item    := btrim(coalesce(payload->>'item_name',''));
  v_type    := payload->>'anomaly_type';
  v_action  := payload->>'action';
  v_comment := btrim(coalesce(payload->>'comment',''));
  v_corr    := nullif(payload->>'corrected_value','')::numeric;

  -- A client that sent only the register id (which IS the store id) still works.
  if v_store is null and v_plant is not null
     and exists (select 1 from stores s where s.id = v_plant) then
    v_store := v_plant;
    v_plant := null;
  end if;
  -- And a factory id alone resolves to the store it draws from.
  if v_store is null and v_plant is not null then
    select f.store_id into v_store from factory_store_access f where f.plant_id = v_plant limit 1;
  end if;

  if v_store is null or v_month is null or v_item = '' or v_type is null then
    raise exception 'invalid: store_id, period_month, item_name and anomaly_type are required';
  end if;
  -- Scoped on the STORE. plant_in_scope() would have been asked about a store
  -- id and refused for every non-global user.
  if not public.store_in_scope(v_store) then
    raise exception 'forbidden: store out of scope';
  end if;
  if v_comment = '' then
    raise exception 'comment_required';
  end if;
  if v_corr is not null and v_corr < 0 then
    raise exception 'invalid: corrected_value must be >= 0';
  end if;

  v_to_status := case v_action
    when 'confirm'        then 'confirmed'
    when 'false_positive' then 'false_positive'
    when 'resolve'        then 'resolved'
    when 'reopen'         then 'reopened'
    else null end;
  if v_to_status is null then
    raise exception 'invalid: unknown action %', coalesce(v_action, '(none)');
  end if;

  select ua.id into v_actor from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;
  v_actor_name := coalesce(nullif(btrim(coalesce(payload->>'actor_name','')), ''), 'Unknown');

  -- Owning factory, for the activity log only. Left null for a shared store,
  -- where no single factory owns the register.
  if v_plant is null then
    select f.plant_id into v_plant
      from factory_store_access f where f.store_id = v_store
     group by f.plant_id having count(*) = 1 limit 1;
    if (select count(distinct plant_id) from factory_store_access where store_id = v_store) <> 1 then
      v_plant := null;
    end if;
  end if;

  insert into store_stock_anomalies
    (store_id, plant_id, period_month, item_name, anomaly_type,
     severity, detail, prev_value, curr_value, delta, suggestion, detected,
     prev_period, curr_period, prev_register, curr_register)
  values
    (v_store, v_plant, v_month, v_item, v_type,
     payload->'detected'->>'severity',
     payload->'detected'->>'detail',
     (payload->'detected'->>'prev')::numeric,
     (payload->'detected'->>'curr')::numeric,
     (payload->'detected'->>'delta')::numeric,
     payload->'detected'->>'suggestion',
     payload->'detected',
     nullif(payload->'detected'->>'prevPeriod','')::date,
     nullif(payload->'detected'->>'currPeriod','')::date,
     nullif(payload->'detected'->>'prevRegister',''),
     nullif(payload->'detected'->>'currRegister',''))
  on conflict (store_id, period_month, item_name, anomaly_type) where store_id is not null
  do nothing;

  select * into v_row from store_stock_anomalies
   where store_id = v_store and period_month = v_month
     and item_name = v_item and anomaly_type = v_type
   for update;

  if payload ? 'expected_version'
     and (payload->>'expected_version')::integer <> v_row.version then
    raise exception 'version_conflict: expected %, have %',
      (payload->>'expected_version')::integer, v_row.version;
  end if;

  -- ONLY review fields are written. The source snapshots (prev_value,
  -- curr_value, detected, provenance) are frozen at first action and never
  -- touched again, and no source stock row is modified — reviewing an anomaly
  -- must never rewrite the data it describes.
  update store_stock_anomalies
     set status = v_to_status,
         action = v_action,
         corrected_value = coalesce(v_corr, corrected_value),
         resolution_comment = v_comment,
         resolved_by = v_actor,
         resolved_by_name = v_actor_name,
         resolved_at = now(),
         version = v_row.version + 1,
         updated_at = now()
   where id = v_row.id;

  insert into store_stock_anomaly_events
    (anomaly_id, store_id, plant_id, action, from_status, to_status, comment,
     corrected_value, actor, actor_name)
  values
    (v_row.id, v_store, v_plant, v_action, v_row.status, v_to_status, v_comment,
     v_corr, v_actor, v_actor_name);

  insert into activity_logs (plant_id, type, date, done_by, equipment, note)
  values (v_plant, 'stock_anomaly', current_date, v_actor_name,
          format('Anomaly %s · %s', v_action, v_item),
          format('%s → %s · %s (%s, %s)%s · %s',
                 v_row.status, v_to_status, v_item, v_type, to_char(v_month, 'Mon YYYY'),
                 case when v_corr is not null then format(' · corrected to %s', v_corr) else '' end,
                 v_comment));

  return jsonb_build_object('id', v_row.id, 'status', v_to_status, 'version', v_row.version + 1);
end $$;

revoke all on function public.resolve_stock_anomaly(jsonb) from public, anon;
grant execute on function public.resolve_stock_anomaly(jsonb) to authenticated;

-- RLS: readable/writable within the STORE scope, matching the new key.
alter table store_stock_anomalies enable row level security;
drop policy if exists "anon_all"   on store_stock_anomalies;
drop policy if exists "scope_all"  on store_stock_anomalies;
drop policy if exists "store_all"  on store_stock_anomalies;
create policy "store_all" on store_stock_anomalies for all
  using (store_id is null or public.store_in_scope(store_id))
  with check (store_id is null or public.store_in_scope(store_id));

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   Anomalies per register (expect store_id populated everywhere):
--     select s.name as store, a.status, count(*)
--       from store_stock_anomalies a left join stores s on s.id = a.store_id
--      group by 1,2 order by 1,2;
--
--   Any row still missing its register key (expect 0):
--     select count(*) from store_stock_anomalies where store_id is null;
--
--   What two figures did a given anomaly compare?
--     select item_name, anomaly_type, prev_register, prev_period, prev_value,
--            curr_register, curr_period, curr_value, delta
--       from store_stock_anomalies order by created_at desc limit 20;
