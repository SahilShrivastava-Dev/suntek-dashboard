-- ═══════════════════════════════════════════════════════════════════════════
-- 72_rollback_anomalies_on_store_model.sql — anomalies back onto the factory key
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ REVERTING RE-INTRODUCES THE BUG 72 FIXED. With plant_id NOT NULL and the
-- app passing a store id, every attempt to review an anomaly at a shared-store
-- site fails again with "This record is linked to other records." Roll back only
-- to unwind a bad deploy, and roll the FRONTEND back with it.
--
-- Restores, in dependency order:
--   1. plant_id from store_id where a store maps to exactly ONE factory
--   2. the original plant-keyed UNIQUE constraint
--   3. the original anomaly_type CHECK (no 'purchase_carry')
--   4. resolve_stock_anomaly() keyed on plant_id and scoped on plant_in_scope
--   5. drops store_id and the provenance columns
--
-- ═══ WHAT CANNOT BE RESTORED ════════════════════════════════════════════════
-- An anomaly on a SHARED store (Rehla) has no single owning factory, so
-- plant_id cannot be reconstructed for it. Those rows are DELETED rather than
-- left with a null plant_id, because step 2 restores a NOT NULL constraint that
-- they would violate. They are reported before deletion — read the output.
-- Any row of type 'purchase_carry' is also deleted, since the restored CHECK
-- does not permit it.
--
-- Reviews recorded on those rows are lost. There is no way around it: they are
-- reviews of anomalies the old schema could not represent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Report, then remove, what the old schema cannot hold ─────────────────
select 'shared-store anomalies that will be DELETED' as warning,
       count(*) as rows
  from store_stock_anomalies a
 where a.store_id is not null
   and (select count(distinct plant_id) from factory_store_access f where f.store_id = a.store_id) <> 1
union all
select 'purchase_carry anomalies that will be DELETED', count(*)
  from store_stock_anomalies where anomaly_type = 'purchase_carry';

do $$
declare v_n bigint;
begin
  if to_regclass('public.store_stock_anomalies') is null then
    raise notice 'store_stock_anomalies is missing — nothing to undo.';
    return;
  end if;

  -- Recover plant_id wherever the store serves exactly one factory.
  update store_stock_anomalies a
     set plant_id = (select f.plant_id from factory_store_access f
                      where f.store_id = a.store_id limit 1)
   where a.plant_id is null
     and a.store_id is not null
     and (select count(distinct plant_id) from factory_store_access f
           where f.store_id = a.store_id) = 1;

  -- Events first (FK to anomalies), then the unrepresentable anomaly rows.
  delete from store_stock_anomaly_events e
   using store_stock_anomalies a
   where e.anomaly_id = a.id
     and (a.plant_id is null or a.anomaly_type = 'purchase_carry');
  get diagnostics v_n = row_count;
  raise notice 'Deleted % anomaly event(s) the old schema cannot hold.', v_n;

  delete from store_stock_anomalies
   where plant_id is null or anomaly_type = 'purchase_carry';
  get diagnostics v_n = row_count;
  raise notice 'Deleted % anomaly row(s) the old schema cannot hold.', v_n;
end $$;

-- ── 2. Restore the plant-keyed natural key ──────────────────────────────────
drop index if exists store_stock_anomalies_store_key;
drop index if exists idx_ssa_store_month;

alter table store_stock_anomalies      alter column plant_id set not null;
alter table store_stock_anomaly_events alter column plant_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'store_stock_anomalies'::regclass and contype = 'u'
       and pg_get_constraintdef(oid) like '%plant_id%period_month%item_name%anomaly_type%'
  ) then
    alter table store_stock_anomalies
      add constraint store_stock_anomalies_plant_id_period_month_item_name_anoma_key
      unique (plant_id, period_month, item_name, anomaly_type);
  end if;
end $$;

-- ── 3. Restore the original type CHECK ──────────────────────────────────────
alter table store_stock_anomalies drop constraint if exists store_stock_anomalies_type_check;
alter table store_stock_anomalies
  add constraint store_stock_anomalies_anomaly_type_check
  check (anomaly_type in ('carry_forward','intra_month','negative','added','removed'));

-- ── 4. Restore the plant-keyed RPC ──────────────────────────────────────────
create or replace function public.resolve_stock_anomaly(payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_plant uuid; v_month date; v_item text; v_type text; v_action text;
  v_comment text; v_corr numeric; v_actor uuid; v_actor_name text;
  v_row store_stock_anomalies%rowtype; v_to_status text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_capability('resolve_stock_anomaly') then
    raise exception 'forbidden: missing capability resolve_stock_anomaly';
  end if;

  v_plant   := (payload->>'plant_id')::uuid;
  v_month   := (payload->>'period_month')::date;
  v_item    := btrim(coalesce(payload->>'item_name',''));
  v_type    := payload->>'anomaly_type';
  v_action  := payload->>'action';
  v_comment := btrim(coalesce(payload->>'comment',''));
  v_corr    := nullif(payload->>'corrected_value','')::numeric;

  if v_plant is null or v_month is null or v_item = '' or v_type is null then
    raise exception 'invalid: plant_id, period_month, item_name and anomaly_type are required';
  end if;
  if not public.plant_in_scope(v_plant) then raise exception 'forbidden: plant out of scope'; end if;
  if v_comment = '' then raise exception 'comment_required'; end if;
  if v_corr is not null and v_corr < 0 then
    raise exception 'invalid: corrected_value must be >= 0';
  end if;

  v_to_status := case v_action
    when 'confirm' then 'confirmed' when 'false_positive' then 'false_positive'
    when 'resolve' then 'resolved'  when 'reopen' then 'reopened' else null end;
  if v_to_status is null then
    raise exception 'invalid: unknown action %', coalesce(v_action, '(none)');
  end if;

  select ua.id into v_actor from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;
  v_actor_name := coalesce(nullif(btrim(coalesce(payload->>'actor_name','')), ''), 'Unknown');

  insert into store_stock_anomalies
    (plant_id, period_month, item_name, anomaly_type,
     severity, detail, prev_value, curr_value, delta, suggestion, detected)
  values
    (v_plant, v_month, v_item, v_type,
     payload->'detected'->>'severity', payload->'detected'->>'detail',
     (payload->'detected'->>'prev')::numeric, (payload->'detected'->>'curr')::numeric,
     (payload->'detected'->>'delta')::numeric, payload->'detected'->>'suggestion',
     payload->'detected')
  on conflict (plant_id, period_month, item_name, anomaly_type) do nothing;

  select * into v_row from store_stock_anomalies
   where plant_id = v_plant and period_month = v_month
     and item_name = v_item and anomaly_type = v_type
   for update;

  if payload ? 'expected_version'
     and (payload->>'expected_version')::integer <> v_row.version then
    raise exception 'version_conflict: expected %, have %',
      (payload->>'expected_version')::integer, v_row.version;
  end if;

  update store_stock_anomalies
     set status = v_to_status, action = v_action,
         corrected_value = coalesce(v_corr, corrected_value),
         resolution_comment = v_comment, resolved_by = v_actor,
         resolved_by_name = v_actor_name, resolved_at = now(),
         version = v_row.version + 1, updated_at = now()
   where id = v_row.id;

  insert into store_stock_anomaly_events
    (anomaly_id, plant_id, action, from_status, to_status, comment, corrected_value, actor, actor_name)
  values (v_row.id, v_plant, v_action, v_row.status, v_to_status, v_comment, v_corr, v_actor, v_actor_name);

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

-- ── 5. Drop the store-model columns ─────────────────────────────────────────
drop policy if exists "store_all" on store_stock_anomalies;
alter table store_stock_anomalies      drop column if exists store_id;
alter table store_stock_anomaly_events drop column if exists store_id;
alter table store_stock_anomalies drop column if exists prev_period;
alter table store_stock_anomalies drop column if exists curr_period;
alter table store_stock_anomalies drop column if exists prev_register;
alter table store_stock_anomalies drop column if exists curr_register;
alter table store_stock_anomalies drop column if exists prev_upload_id;
alter table store_stock_anomalies drop column if exists curr_upload_id;

notify pgrst, 'reload schema';

-- Verify (optional):
--   select count(*) from information_schema.columns
--    where table_name='store_stock_anomalies' and column_name='store_id';   -- 0
