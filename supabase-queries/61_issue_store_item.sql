-- ═══════════════════════════════════════════════════════════════════════════
-- 61_issue_store_item.sql — atomic stock issue + reservations + store-scoped RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BUG THIS FIXES
-- Issuing a part to a technician was a CLIENT-SIDE read-modify-write
-- (Maintenance.tsx: select on_hand → compute → update on_hand). Two handovers
-- of the same item interleave like this:
--
--     A reads on_hand = 10        B reads on_hand = 10
--     A writes 10 - 5 = 5         B writes 10 - 5 = 5
--
-- Ten units leave the store; the register says five went. The
-- store_items_on_hand_nonneg CHECK from 39 stops stock going NEGATIVE but does
-- nothing about a lost update. Adding to stock was already safe —
-- apply_stock_purchase() (53) does `set on_hand = on_hand + qty` inside the
-- database — so only the deduction path was exposed.
--
-- Until now each factory had its own private register, so two people rarely
-- touched the same row. With SCPL, SPPL and SPPL(K) drawing on ONE Rehla row,
-- that collision becomes the normal case. This RPC closes it with SELECT …
-- FOR UPDATE, so concurrent issues serialise on the row instead of racing.
--
-- RESERVATIONS
-- Stock used to be deducted only at handover, so three technicians could each
-- be told "1 in stock" for the same last unit. `reserve` claims the quantity
-- when a unit head APPROVES; everyone else then sees on_hand - reserved_qty as
-- free. `issue` converts a reservation into an actual movement; `release`
-- returns it if the request is rejected or cancelled.
--
-- EVERY MOVEMENT RECORDS BOTH FACTS
--   store_stock_events.store_id            → WHERE the stock moved
--   store_stock_events.requesting_plant_id → WHO asked, and WHO pays
-- One shared register, per-factory cost attribution, from a single row.
--
-- Requires 28 (is_global_user), 32 (has_capability), 37 (store_items/events),
-- 59 (store_id, reserved_qty, store_in_scope). Idempotent.
-- Reversible via 61_rollback_issue_store_item.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Reservations are tracked PER REQUEST, not just in aggregate ──────────
-- store_items.reserved_qty is the running total; this column records how much
-- of it belongs to a given part request. Without it, issuing against a request
-- that never reserved would decrement — and so silently steal — somebody
-- else's claim on the same shared row.
alter table maintenance_store_requests
  add column if not exists reserved_qty numeric not null default 0;

comment on column maintenance_store_requests.reserved_qty is
  'This request''s share of store_items.reserved_qty. Claimed on approval, consumed on handover, returned on rejection.';

-- ── 1. The RPC ──────────────────────────────────────────────────────────────
-- payload: {
--   action:              'reserve' | 'issue' | 'release',
--   store_item_id:       uuid,
--   qty:                 numeric  (> 0),
--   requesting_plant_id: uuid     — the factory that pays
--   store_request_id:    uuid?    — maintenance_store_requests row, for the trail
--   ref:                 text?    — e.g. 'ticket a1b2c3d4'
--   justification:       text?
--   actor_name:          text?
-- }
-- returns: { ok, action, store_item_id, requested, applied, on_hand, reserved_qty, short }
create or replace function public.issue_store_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action   text;
  v_item     uuid;
  v_qty      numeric;
  v_plant    uuid;
  v_req      uuid;
  v_ref      text;
  v_just     text;
  v_actor    uuid;
  v_actorname text;

  v_store    uuid;
  v_name     text;
  v_on_hand  numeric;
  v_reserved numeric;
  v_free     numeric;
  v_applied  numeric;
  v_req_res  numeric;   -- this request's existing share of the reservation
  v_release  numeric;   -- how much of it to give back
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_action := lower(btrim(coalesce(payload->>'action', '')));
  v_item   := (payload->>'store_item_id')::uuid;
  v_qty    := (payload->>'qty')::numeric;
  v_plant  := (payload->>'requesting_plant_id')::uuid;
  v_req    := nullif(payload->>'store_request_id', '')::uuid;
  v_ref    := nullif(btrim(coalesce(payload->>'ref', '')), '');
  v_just   := nullif(btrim(coalesce(payload->>'justification', '')), '');

  if v_action not in ('reserve', 'issue', 'release') then
    raise exception 'invalid: action must be reserve, issue or release';
  end if;
  if v_item is null then raise exception 'invalid: store_item_id is required'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'invalid: qty must be > 0'; end if;
  if v_plant is null then raise exception 'invalid: requesting_plant_id is required'; end if;

  -- ── Lock the register row. Everything below is serialised on it, which is
  --    the entire point of this function. ───────────────────────────────────
  select si.store_id, si.item_name, si.on_hand, si.reserved_qty
    into v_store, v_name, v_on_hand, v_reserved
    from store_items si
   where si.id = v_item
   for update;

  if not found then
    raise exception 'not_found: store item %', v_item;
  end if;

  -- ── Authorisation ─────────────────────────────────────────────────────────
  -- The caller must reach the store, either directly (a store keeper, via
  -- user_stores) or through a factory that uses it (a unit head or technician).
  if not (public.store_in_scope(v_store) or public.store_in_plant_scope(v_store)) then
    raise exception 'forbidden: store out of scope';
  end if;
  -- The paying factory must be one this store actually serves — otherwise a
  -- caller could charge another location's factory for stock taken here.
  if not exists (select 1 from factory_store_access f
                  where f.store_id = v_store and f.plant_id = v_plant) then
    raise exception 'forbidden: factory % is not served by this store', v_plant;
  end if;

  v_reserved := coalesce(v_reserved, 0);
  v_on_hand  := coalesce(v_on_hand, 0);

  -- How much of the running reservation belongs to THIS request. Anything
  -- claimed by other requests on the same shared row is off limits.
  v_req_res := 0;
  if v_req is not null then
    select coalesce(reserved_qty, 0) into v_req_res
      from maintenance_store_requests where id = v_req for update;
    v_req_res := coalesce(v_req_res, 0);
  end if;

  if v_action = 'reserve' then
    -- Free stock excludes what other approved requests have already claimed.
    v_free := greatest(0, v_on_hand - v_reserved);
    v_applied := least(v_qty, v_free);
    if v_applied > 0 then
      update store_items
         set reserved_qty = reserved_qty + v_applied, updated_at = now()
       where id = v_item;
      v_reserved := v_reserved + v_applied;
      if v_req is not null then
        update maintenance_store_requests
           set reserved_qty = coalesce(reserved_qty, 0) + v_applied where id = v_req;
      end if;
    end if;
    -- No stock event: a reservation is an intent, not a movement. It shows up
    -- in the register as reduced availability, not as a transaction.

  elsif v_action = 'release' then
    -- Give back only what this request is holding.
    v_applied := least(v_qty, case when v_req is not null then v_req_res else v_reserved end);
    if v_applied > 0 then
      update store_items
         set reserved_qty = greatest(0, reserved_qty - v_applied), updated_at = now()
       where id = v_item
       returning reserved_qty into v_reserved;
      if v_req is not null then
        update maintenance_store_requests
           set reserved_qty = greatest(0, coalesce(reserved_qty, 0) - v_applied) where id = v_req;
      end if;
    end if;

  else  -- issue
    -- Never issue more than is physically there, whoever reserved it.
    v_applied := least(v_qty, v_on_hand);
    -- Consume only this request's own claim; other requests keep theirs.
    v_release := least(v_applied, case when v_req is not null then v_req_res else v_reserved end);
    if v_applied > 0 then
      update store_items
         set issued_qty   = issued_qty + v_applied,
             on_hand      = on_hand - v_applied,
             -- Give back this request's own claim, then clamp to what is
             -- actually left: you cannot hold a reservation against stock that
             -- has physically gone. Without the clamp, issuing un-reserved
             -- stock out of a row that others have fully reserved would breach
             -- store_items_reserved_sane (reserved_qty <= on_hand).
             reserved_qty = least(
               greatest(0, reserved_qty - v_release),
               greatest(0, on_hand - v_applied)
             ),
             updated_at   = now()
       where id = v_item
       returning on_hand, reserved_qty into v_on_hand, v_reserved;

      if v_req is not null and v_release > 0 then
        update maintenance_store_requests
           set reserved_qty = greatest(0, coalesce(reserved_qty, 0) - v_release) where id = v_req;
      end if;

      select ua.id into v_actor from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;
      v_actorname := coalesce(nullif(btrim(coalesce(payload->>'actor_name','')), ''), 'Unknown');

      insert into store_stock_events
        (item_id, plant_id, store_id, requesting_plant_id, event_type,
         qty_delta, on_hand_after, ref, justification, actor, actor_name)
      values
        (v_item, v_plant, v_store, v_plant, 'issue',
         -v_applied, v_on_hand, coalesce(v_ref, 'manual issue'),
         coalesce(v_just, format('Issued %s · %s', v_applied, v_name))
           || case when v_applied < v_qty
                   then format(' (only %s of %s were on hand)', v_applied, v_qty)
                   else '' end,
         v_actor, v_actorname);
    end if;
  end if;

  return jsonb_build_object(
    'ok',            true,
    'action',        v_action,
    'store_item_id', v_item,
    'store_id',      v_store,
    'requested',     v_qty,
    'applied',       coalesce(v_applied, 0),
    'short',         greatest(0, v_qty - coalesce(v_applied, 0)),
    'on_hand',       v_on_hand,
    'reserved_qty',  v_reserved
  );
end $$;

grant execute on function public.issue_store_item(jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RLS — store access grants the PART QUEUE, never the ASSET REGISTER
-- ═══════════════════════════════════════════════════════════════════════════
-- This is the rule the whole shared-store design turns on. A Rehla store
-- keeper serves three factories, so they must see part requests from all
-- three — but they must NOT thereby gain those factories' fixed assets.
--
--   store tables            → reachable via user_stores OR via a factory you
--                             belong to that uses the store
--   tickets + part requests → your factory's, OR any ticket drawing on your store
--   fixed_assets            → UNCHANGED. plant_in_scope() only.  ← the point

-- ── Store tables ────────────────────────────────────────────────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'store_items', 'store_stock_events', 'store_stock_months', 'store_stock_uploads'
  ] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "anon_all"  on %I', tbl);
    execute format('drop policy if exists "scope_all" on %I', tbl);
    execute format($f$
      create policy "scope_all" on %I for all
        using      (public.store_in_scope(store_id) or public.store_in_plant_scope(store_id))
        with check (public.store_in_scope(store_id) or public.store_in_plant_scope(store_id))
    $f$, tbl);
  end loop;
end $$;

-- ── Maintenance tickets: my factory, OR a ticket drawing on my store ────────
alter table maintenance_tickets enable row level security;
drop policy if exists "scope_all" on maintenance_tickets;
create policy "scope_all" on maintenance_tickets for all
  using (
    public.plant_unit_in_scope(plant_id, unit_id)
    or exists (
      select 1 from maintenance_store_requests r
       where r.ticket_id = maintenance_tickets.id
         and public.store_in_scope(r.source_store_id))
  )
  -- A store keeper may act on a ticket that draws on their store, but may not
  -- CREATE or MOVE a ticket into a factory they do not belong to.
  with check (public.plant_unit_in_scope(plant_id, unit_id));

-- ── Part requests: my factory's ticket, OR my store ─────────────────────────
alter table maintenance_store_requests enable row level security;
drop policy if exists "scope_all" on maintenance_store_requests;
create policy "scope_all" on maintenance_store_requests for all
  using      (public.ticket_in_scope(ticket_id) or public.store_in_scope(source_store_id))
  with check (public.ticket_in_scope(ticket_id) or public.store_in_scope(source_store_id));

-- ── fixed_assets is deliberately NOT touched here ───────────────────────────
-- Its policy stays `plant_in_scope(plant_id)` from 28_rls_phase2a_operational.
-- Restated as an assertion so a future edit to this file cannot quietly widen
-- it: a shared store must never imply a shared FAR.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fixed_assets'
       and (qual like '%store_in_scope%' or with_check like '%store_in_scope%'))
  then
    raise exception
      'fixed_assets policy references store scope. FAR must remain factory-scoped '
      '(plant_in_scope) — store access must never grant asset access.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   Which predicate guards what:
--     select tablename, policyname, cmd, qual from pg_policies
--      where schemaname='public'
--        and tablename in ('store_items','store_stock_events','maintenance_tickets',
--                          'maintenance_store_requests','fixed_assets')
--      order by tablename;
--
--   Concurrency check — run in two sessions at once against the same item and
--   confirm the second blocks until the first commits, and that the sum of
--   `applied` never exceeds the starting on_hand:
--     select public.issue_store_item(jsonb_build_object(
--       'action','issue','store_item_id','<uuid>','qty',5,
--       'requesting_plant_id','<uuid>','ref','concurrency test'));
