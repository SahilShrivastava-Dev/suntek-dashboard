-- ═══════════════════════════════════════════════════════════════════════════
-- 54_stock_anomaly_resolutions.sql — review/resolve Stock Register anomalies
-- ═══════════════════════════════════════════════════════════════════════════
-- Stock anomalies are COMPUTED client-side (reconcile() compares the last two
-- store_stock_months snapshots per plant) and were previously display-only.
-- This migration adds a persistence layer keyed by the anomaly's deterministic
-- natural key (plant, month, item, type) so recomputed anomalies can join to
-- their stored review state:
--   • store_stock_anomalies       — lazily created the FIRST time someone acts
--     on an anomaly; snapshots the detected values; carries status + resolution.
--   • store_stock_anomaly_events  — append-only history of every action.
--   • resolve_stock_anomaly(payload jsonb) — SECURITY DEFINER RPC: mandatory
--     comment, optimistic version check, status transition, event + activity
--     log rows, all in one transaction.
--   • capability seed: 'resolve_stock_anomaly' → unit_head, warehouse_manager,
--     store_manager_* (admin implicit).
--
-- The original detected values are never overwritten: they are frozen in the
-- snapshot columns + `detected` jsonb at first action, and every subsequent
-- action appends an event row. Corrected values are RECORDED here; live
-- register corrections still go through the existing Stock Register edit flow
-- (its own justification + store_stock_events + activity_logs trail).
--
-- Requires 28 (plant_in_scope), 32 (has_capability), 37 (store_stock_months).
-- Idempotent. Reversible via 54_rollback_stock_anomalies.sql.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists store_stock_anomalies (
  id                 uuid primary key default gen_random_uuid(),
  plant_id           uuid not null references plants(id) on delete cascade,
  period_month       date not null,              -- first-of-month, as store_stock_months stores it
  item_name          text not null,
  anomaly_type       text not null check (anomaly_type in ('carry_forward','intra_month','negative','added','removed')),
  -- Snapshot of what was detected (frozen at first action; never overwritten):
  severity           text,
  detail             text,
  prev_value         numeric,
  curr_value         numeric,
  delta              numeric,
  suggestion         text,
  detected           jsonb,
  -- Review state:
  status             text not null default 'open'
                     check (status in ('open','confirmed','false_positive','resolved','reopened')),
  action             text,                       -- last action taken
  corrected_value    numeric,
  resolution_comment text,
  resolved_by        uuid references user_accounts(id) on delete set null,
  resolved_by_name   text,
  resolved_at        timestamptz,
  version            integer not null default 1, -- optimistic concurrency
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (plant_id, period_month, item_name, anomaly_type)
);
create index if not exists idx_ssa_plant_month on store_stock_anomalies(plant_id, period_month);

create table if not exists store_stock_anomaly_events (
  id              uuid primary key default gen_random_uuid(),
  anomaly_id      uuid not null references store_stock_anomalies(id) on delete cascade,
  plant_id        uuid not null,
  action          text not null,                 -- confirm | false_positive | resolve | reopen
  from_status     text,
  to_status       text not null,
  comment         text not null check (btrim(comment) <> ''),
  corrected_value numeric,
  actor           uuid references user_accounts(id) on delete set null,
  actor_name      text,
  created_at      timestamptz default now()
);
create index if not exists idx_ssae_anomaly on store_stock_anomaly_events(anomaly_id);

-- ── RLS: read within plant scope; writes ONLY via the RPC below. ─────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['store_stock_anomalies','store_stock_anomaly_events'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "scope_read" on %I', tbl);
    execute format('create policy "scope_read" on %I for select using (public.plant_in_scope(plant_id))', tbl);
  end loop;
end $$;

-- payload: {
--   plant_id, period_month ('YYYY-MM-01'), item_name, anomaly_type,
--   action ('confirm'|'false_positive'|'resolve'|'reopen'),
--   comment (required), corrected_value?, expected_version?,
--   detected? ({ severity, detail, prev, curr, delta, suggestion }) — snapshot
--     used only when this action creates the row, actor_name?
-- }
create or replace function public.resolve_stock_anomaly(payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
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

  v_plant   := (payload->>'plant_id')::uuid;
  v_month   := (payload->>'period_month')::date;
  v_item    := btrim(coalesce(payload->>'item_name',''));
  v_type    := payload->>'anomaly_type';
  v_action  := payload->>'action';
  v_comment := btrim(coalesce(payload->>'comment',''));
  v_corr    := (payload->>'corrected_value')::numeric;

  if v_plant is null or v_month is null or v_item = '' or v_type is null then
    raise exception 'invalid: plant_id, period_month, item_name and anomaly_type are required';
  end if;
  if not public.plant_in_scope(v_plant) then
    raise exception 'forbidden: plant out of scope';
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

  -- Lazy creation: persist the anomaly (with its detected snapshot) the first
  -- time anyone acts on it. do-nothing keeps an existing snapshot intact.
  insert into store_stock_anomalies
    (plant_id, period_month, item_name, anomaly_type,
     severity, detail, prev_value, curr_value, delta, suggestion, detected)
  values
    (v_plant, v_month, v_item, v_type,
     payload->'detected'->>'severity',
     payload->'detected'->>'detail',
     (payload->'detected'->>'prev')::numeric,
     (payload->'detected'->>'curr')::numeric,
     (payload->'detected'->>'delta')::numeric,
     payload->'detected'->>'suggestion',
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
    (anomaly_id, plant_id, action, from_status, to_status, comment, corrected_value, actor, actor_name)
  values
    (v_row.id, v_plant, v_action, v_row.status, v_to_status, v_comment, v_corr, v_actor, v_actor_name);

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

update roles
   set capabilities = array_append(capabilities, 'resolve_stock_anomaly')
 where id in ('unit_head','warehouse_manager','store_manager_maint',
              'store_manager_chlorides','store_manager_plasticiser')
   and not ('resolve_stock_anomaly' = any(capabilities));

notify pgrst, 'reload schema';
