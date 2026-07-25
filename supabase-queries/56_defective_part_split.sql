-- ═══════════════════════════════════════════════════════════════════════════
-- 56_defective_part_split.sql — split removed parts into Repair vs Scrap QTYs
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BUG THIS FIXES
-- A technician who replaces 5 parts could previously only record ONE decision
-- for the whole ticket (`maintenance_tickets.defective_part_decision` = 'repair'
-- OR 'scrap'), with no quantity anywhere. So "5 replaced → 3 repair + 2 scrap"
-- was impossible to express, and migration 55 had to assume `repair_qty = 1`
-- per ticket — understating every multi-part job.
--
-- THE MODEL
--   • maintenance_defective_parts — ONE ROW PER REPLACED PART LINE, carrying
--     replaced_qty and its split into repair_qty + scrap_qty. A ticket that
--     replaced valves AND gaskets gets one row each, so the split is recorded
--     at the granularity the work actually happened at.
--   • A DB-level constraint enforces repair_qty + scrap_qty = replaced_qty:
--     every removed part is accounted for, none can silently disappear.
--   • repair_returned_qty moves HERE — returns are now tracked against the
--     specific part that went out, not a whole-ticket guess. The ticket-level
--     counters from 55 are kept as a denormalised MIRROR (recomputed by the
--     RPCs) so existing reads keep working.
--
-- Existing data is backfilled from the old ticket-level decision, so nothing
-- is lost: a 'repair' ticket becomes one row with its 55-era quantities, a
-- 'scrap' ticket becomes one row with scrap_qty = 1.
--
-- Requires 28 (plant_in_scope), 32 (has_capability), 55 (repair returns).
-- Idempotent. Reversible via 56_rollback_defective_part_split.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) One row per replaced part line.
create table if not exists maintenance_defective_parts (
  id                  uuid primary key default gen_random_uuid(),
  ticket_id           uuid not null references maintenance_tickets(id) on delete cascade,
  -- The store-request line these parts came from (null for free-text/in-house
  -- repairs that never raised a store request).
  store_request_id    uuid references maintenance_store_requests(id) on delete set null,
  plant_id            uuid references plants(id) on delete set null,
  part_name           text not null,
  replaced_qty        numeric not null check (replaced_qty > 0),
  repair_qty          numeric not null default 0 check (repair_qty >= 0),
  scrap_qty           numeric not null default 0 check (scrap_qty >= 0),
  repair_returned_qty numeric not null default 0 check (repair_returned_qty >= 0),
  -- Register row these repaired units return INTO (resolved at return time).
  store_item_id       uuid references store_items(id) on delete set null,
  photo_url           text,
  actor               uuid references user_accounts(id) on delete set null,
  actor_name          text,
  created_at          timestamptz default now(),
  -- Every removed part must be accounted for as either repair or scrap.
  constraint mdp_split_balances      check (repair_qty + scrap_qty = replaced_qty),
  -- Can never return more than was sent for repair.
  constraint mdp_return_within_repair check (repair_returned_qty <= repair_qty)
);
create index if not exists idx_mdp_ticket on maintenance_defective_parts(ticket_id);
create index if not exists idx_mdp_plant  on maintenance_defective_parts(plant_id);
create index if not exists idx_mdp_item   on maintenance_defective_parts(store_item_id);

-- 2) Returns now point at the specific part line (55 only had ticket_id).
alter table repair_return_allocations
  add column if not exists defective_part_id uuid references maintenance_defective_parts(id) on delete set null;
create index if not exists idx_rra_defective on repair_return_allocations(defective_part_id);

-- 2b) `maintenance_tickets.repair_qty` is now a DERIVED MIRROR of the part
--     lines, so 0 is legitimate (an all-scrap ticket sent nothing for repair).
--     55 declared it `> 0`; relax to `>= 0` or every scrap close would fail.
alter table maintenance_tickets drop constraint if exists maintenance_tickets_repair_qty_check;
alter table maintenance_tickets add constraint maintenance_tickets_repair_qty_check
  check (repair_qty >= 0);

-- ── RLS: read within plant scope; writes ONLY via the RPCs below. ───────────
alter table maintenance_defective_parts enable row level security;
drop policy if exists "scope_read" on maintenance_defective_parts;
create policy "scope_read" on maintenance_defective_parts
  for select using (public.plant_in_scope(plant_id));

-- 3) Backfill from the old ticket-level decision so history survives.
--    Guarded: only tickets that have a decision and no row yet.
insert into maintenance_defective_parts
  (ticket_id, plant_id, part_name, replaced_qty, repair_qty, scrap_qty,
   repair_returned_qty, photo_url, created_at)
select
  t.id,
  t.plant_id,
  -- Prefer the REAL part name from the ticket's store request. Never use
  -- `title`: it is built as "<equipment> — Needs part" / "— Repairable", so
  -- using it verbatim produced stock items like "Acid Pump Bello — Needs part"
  -- that fail to match the register and get duplicated on return.
  coalesce(
    (select nullif(btrim(sr.part_name), '')
       from maintenance_store_requests sr
      where sr.ticket_id = t.id
      order by sr.created_at
      limit 1),
    nullif(btrim(t.equipment), ''),
    nullif(btrim(regexp_replace(coalesce(t.title, ''), '\s*[—–-]\s*(Repairable|Needs\s+part)\s*$', '', 'i')), ''),
    'Defective part'),
  case when t.defective_part_decision = 'repair'
       then greatest(coalesce(t.repair_qty, 1), 1) else 1 end,
  case when t.defective_part_decision = 'repair'
       then greatest(coalesce(t.repair_qty, 1), 1) else 0 end,
  case when t.defective_part_decision = 'scrap' then 1 else 0 end,
  case when t.defective_part_decision = 'repair'
       then least(coalesce(t.repair_returned_qty, 0), greatest(coalesce(t.repair_qty, 1), 1))
       else 0 end,
  t.defective_part_photo_url,
  coalesce(t.closed_at, t.created_at, now())
from maintenance_tickets t
where t.defective_part_decision in ('repair', 'scrap')
  and not exists (select 1 from maintenance_defective_parts d where d.ticket_id = t.id);

-- 3b) Re-mirror the ticket counters from the rows just backfilled. Scrap-only
--     tickets carried repair_qty = 1 (55's default) which is now plainly wrong:
--     they sent nothing for repair.
update maintenance_tickets t
   set repair_qty          = d.rep,
       repair_returned_qty = d.ret
  from (select ticket_id,
               sum(repair_qty)          as rep,
               sum(repair_returned_qty) as ret
          from maintenance_defective_parts group by ticket_id) d
 where d.ticket_id = t.id
   and (t.repair_qty is distinct from d.rep or t.repair_returned_qty is distinct from d.ret);

-- 4) Record the split when the technician closes the ticket.
-- payload: {
--   ticket_id, plant_id, photo_url?, actor_name?,
--   lines: [{ store_request_id?, part_name, replaced_qty, repair_qty, scrap_qty, store_item_id? }]
-- }
create or replace function public.record_defective_disposition(payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ticket_id uuid;
  v_plant     uuid;
  v_actor     uuid;
  v_actor_name text;
  v_line      jsonb;
  v_replaced  numeric;
  v_repair    numeric;
  v_scrap     numeric;
  v_name      text;
  v_ticket    maintenance_tickets%rowtype;
  v_total_rep numeric := 0;
  v_total_scr numeric := 0;
  v_count     integer := 0;
  v_decision  text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_ticket_id := (payload->>'ticket_id')::uuid;
  if v_ticket_id is null then raise exception 'invalid: ticket_id is required'; end if;

  select * into v_ticket from maintenance_tickets where id = v_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'invalid: ticket % not found', v_ticket_id;
  end if;
  v_plant := coalesce((payload->>'plant_id')::uuid, v_ticket.plant_id);
  if v_plant is not null and not public.plant_in_scope(v_plant) then
    raise exception 'forbidden: plant out of scope';
  end if;

  if payload->'lines' is null or jsonb_typeof(payload->'lines') <> 'array'
     or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'invalid: at least one defective part line is required';
  end if;

  select ua.id into v_actor from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;
  v_actor_name := coalesce(nullif(btrim(coalesce(payload->>'actor_name','')), ''), 'Unknown');

  -- Re-submitting a disposition for the same ticket replaces it wholesale, but
  -- only while nothing has been returned yet — otherwise the return history
  -- would point at rows that no longer exist.
  if exists (select 1 from maintenance_defective_parts
              where ticket_id = v_ticket_id and repair_returned_qty > 0) then
    raise exception 'disposition_locked: repaired units have already been returned against this ticket';
  end if;
  delete from maintenance_defective_parts where ticket_id = v_ticket_id;

  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_name     := btrim(coalesce(v_line->>'part_name',''));
    v_replaced := (v_line->>'replaced_qty')::numeric;
    v_repair   := coalesce((v_line->>'repair_qty')::numeric, 0);
    v_scrap    := coalesce((v_line->>'scrap_qty')::numeric, 0);

    if v_name = '' then
      raise exception 'invalid: every line needs a part_name';
    end if;
    if v_replaced is null or v_replaced <= 0 then
      raise exception 'invalid: %: replaced_qty must be greater than 0', v_name;
    end if;
    if v_repair < 0 or v_scrap < 0 then
      raise exception 'invalid: %: quantities cannot be negative', v_name;
    end if;
    -- The rule the UI enforces, restated server-side: nothing unaccounted for.
    if v_repair + v_scrap <> v_replaced then
      raise exception 'split_mismatch: %: repair % + scrap % must equal % replaced',
        v_name, v_repair, v_scrap, v_replaced;
    end if;

    insert into maintenance_defective_parts
      (ticket_id, store_request_id, plant_id, part_name, replaced_qty,
       repair_qty, scrap_qty, store_item_id, photo_url, actor, actor_name)
    values
      (v_ticket_id, nullif(v_line->>'store_request_id','')::uuid, v_plant, v_name, v_replaced,
       v_repair, v_scrap, nullif(v_line->>'store_item_id','')::uuid,
       nullif(payload->>'photo_url',''), v_actor, v_actor_name);

    v_total_rep := v_total_rep + v_repair;
    v_total_scr := v_total_scr + v_scrap;
    v_count := v_count + 1;
  end loop;

  -- Ticket-level mirror so 55-era reads and the old enum keep working.
  v_decision := case
    when v_total_rep > 0 and v_total_scr > 0 then 'mixed'
    when v_total_rep > 0                     then 'repair'
    else 'scrap' end;

  update maintenance_tickets
     set defective_part_decision  = v_decision,
         defective_part_photo_url = coalesce(nullif(payload->>'photo_url',''), defective_part_photo_url),
         repair_qty               = v_total_rep,   -- 0 is valid: an all-scrap ticket
         repair_returned_qty      = 0,
         status                   = 'closed',
         closed_at                = now(),
         assigned_to              = coalesce(v_actor_name, assigned_to)
   where id = v_ticket_id;

  insert into activity_logs (plant_id, type, date, done_by, equipment, note)
  values (v_plant, 'defective_disposition', current_date, v_actor_name,
          format('Defective parts: %s', v_ticket.equipment),
          format('%s line(s) · %s to repair · %s scrapped', v_count, v_total_rep, v_total_scr));

  return jsonb_build_object('ticket_id', v_ticket_id, 'lines', v_count,
                            'repair_qty', v_total_rep, 'scrap_qty', v_total_scr,
                            'decision', v_decision);
end $$;

revoke all on function public.record_defective_disposition(jsonb) from public, anon;
grant execute on function public.record_defective_disposition(jsonb) to authenticated;

-- 5) Returns now settle against a defective-part row, not a whole ticket.
create or replace function public.apply_repair_return(payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id         uuid;
  v_plant      uuid;
  v_comment    text;
  v_actor      uuid;
  v_actor_name text;
  v_alloc      jsonb;
  v_dp         maintenance_defective_parts%rowtype;
  v_qty        numeric;
  v_name       text;
  v_item_id    uuid;
  v_existing   uuid;
  v_on_hand    numeric;
  v_pending    numeric;
  v_total      numeric := 0;
  v_count      integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_capability('return_repairs') then
    raise exception 'forbidden: missing capability return_repairs';
  end if;

  v_id      := (payload->>'id')::uuid;
  v_plant   := (payload->>'plant_id')::uuid;
  v_comment := btrim(coalesce(payload->>'comment',''));

  if v_id is null then raise exception 'invalid: id is required'; end if;
  if v_plant is null then raise exception 'invalid: plant_id is required'; end if;
  if not public.plant_in_scope(v_plant) then
    raise exception 'forbidden: plant out of scope';
  end if;
  if v_comment = '' then raise exception 'comment_required'; end if;
  if payload->'allocations' is null or jsonb_typeof(payload->'allocations') <> 'array'
     or jsonb_array_length(payload->'allocations') = 0 then
    raise exception 'invalid: at least one allocation is required';
  end if;

  select ua.id into v_actor from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;
  v_actor_name := coalesce(nullif(btrim(coalesce(payload->>'actor_name','')), ''), 'Unknown');

  insert into repair_return_receipts
    (id, plant_id, vendor_name, invoice_no, invoice_url, return_date,
     comment, repair_cost, condition_note, actor, actor_name)
  values
    (v_id, v_plant,
     nullif(btrim(coalesce(payload->>'vendor_name','')), ''),
     nullif(btrim(coalesce(payload->>'invoice_no','')), ''),
     nullif(payload->>'invoice_url',''),
     coalesce(nullif(payload->>'return_date','')::date, current_date),
     v_comment, (payload->>'repair_cost')::numeric,
     nullif(payload->>'condition_note',''), v_actor, v_actor_name)
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('already_applied', true, 'receipt_id', v_id);
  end if;

  for v_alloc in select * from jsonb_array_elements(payload->'allocations') loop
    v_qty  := (v_alloc->>'qty')::numeric;
    v_name := btrim(coalesce(v_alloc->>'item_name',''));
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid: allocation qty must be > 0';
    end if;
    if v_name = '' then
      raise exception 'invalid: every allocation needs an item_name';
    end if;

    -- Prefer the exact part line. Fall back to the ticket's oldest outstanding
    -- repair line when the caller sent no defective_part_id — that is a
    -- PRE-56 frontend (it only knew about tickets). Without this fallback,
    -- applying 56 would break every already-deployed client until it is
    -- redeployed, so the RPC stays compatible in BOTH directions.
    if coalesce(v_alloc->>'defective_part_id','') <> '' then
      select * into v_dp from maintenance_defective_parts
       where id = (v_alloc->>'defective_part_id')::uuid for update;
      if v_dp.id is null then
        raise exception 'invalid: defective part % not found', v_alloc->>'defective_part_id';
      end if;
    else
      if coalesce(v_alloc->>'ticket_id','') = '' then
        raise exception 'invalid: allocation needs defective_part_id or ticket_id';
      end if;
      select * into v_dp from maintenance_defective_parts
       where ticket_id = (v_alloc->>'ticket_id')::uuid
         and repair_qty > repair_returned_qty
       order by created_at
       limit 1
       for update;
      if v_dp.id is null then
        raise exception 'over_return: ticket % has no repair units still pending', v_alloc->>'ticket_id';
      end if;
    end if;
    if v_dp.plant_id is distinct from v_plant then
      raise exception 'invalid: defective part % belongs to a different plant', v_dp.id;
    end if;
    -- Scrap can NEVER re-enter stock: a line with no repair quantity is rejected.
    if v_dp.repair_qty <= 0 then
      raise exception 'not_repair: "%" was scrapped, not sent for repair', v_dp.part_name;
    end if;
    v_pending := v_dp.repair_qty - v_dp.repair_returned_qty;
    if v_qty > v_pending then
      raise exception 'over_return: "%" has % pending, requested %', v_dp.part_name, v_pending, v_qty;
    end if;

    update maintenance_defective_parts
       set repair_returned_qty = repair_returned_qty + v_qty
     where id = v_dp.id;

    -- Target register row: explicit id (verified for plant) or by name.
    v_existing := null;
    if coalesce(v_alloc->>'store_item_id','') <> '' then
      select si.id into v_existing from store_items si
       where si.id = (v_alloc->>'store_item_id')::uuid and si.plant_id = v_plant;
    end if;
    if v_existing is null then
      select si.id into v_existing from store_items si
       where si.plant_id = v_plant and lower(si.item_name) = lower(v_name);
    end if;

    if v_existing is not null then
      update store_items
         set repaired_qty = repaired_qty + v_qty,
             on_hand      = on_hand + v_qty,
             updated_at   = now()
       where id = v_existing
       returning id, on_hand into v_item_id, v_on_hand;
    else
      insert into store_items (plant_id, item_name, unit, baseline_qty, procured_qty, issued_qty, manual_delta, repaired_qty, on_hand)
      values (v_plant, v_name, nullif(v_alloc->>'unit',''), 0, 0, 0, 0, v_qty, v_qty)
      returning id, on_hand into v_item_id, v_on_hand;
    end if;

    insert into repair_return_allocations
      (receipt_id, plant_id, ticket_id, defective_part_id, store_item_id, item_name, qty)
    values (v_id, v_plant, v_dp.ticket_id, v_dp.id, v_item_id, v_name, v_qty);

    insert into store_stock_events (item_id, plant_id, event_type, qty_delta, on_hand_after, ref, justification, actor, actor_name)
    values (v_item_id, v_plant, 'repair_return', v_qty, v_on_hand, 'repair_return:' || v_id,
            format('Repaired & returned %s · %s · ticket #%s', v_qty, v_name, left(v_dp.ticket_id::text, 8)),
            v_actor, v_actor_name);

    -- Keep the ticket mirror exact (sum of its part lines).
    update maintenance_tickets t
       set repair_returned_qty = (select coalesce(sum(d.repair_returned_qty), 0)
                                    from maintenance_defective_parts d where d.ticket_id = t.id)
     where t.id = v_dp.ticket_id;

    v_total := v_total + v_qty;
    v_count := v_count + 1;
  end loop;

  insert into activity_logs (plant_id, type, date, done_by, equipment, note)
  values (v_plant, 'repair_return', current_date, v_actor_name,
          format('Repair return: %s unit(s), %s part line(s)', v_total, v_count),
          format('%s%s · %s',
                 coalesce('vendor ' || nullif(btrim(coalesce(payload->>'vendor_name','')), ''), 'no vendor'),
                 coalesce(' · invoice ' || nullif(btrim(coalesce(payload->>'invoice_no','')), ''), ''),
                 v_comment));

  return jsonb_build_object('already_applied', false, 'receipt_id', v_id,
                            'lines', v_count, 'total_qty', v_total);
end $$;

revoke all on function public.apply_repair_return(jsonb) from public, anon;
grant execute on function public.apply_repair_return(jsonb) to authenticated;

-- 6) Reversal decrements the part line (and re-mirrors the ticket).
create or replace function public.reverse_repair_return(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_receipt    repair_return_receipts%rowtype;
  v_actor      uuid;
  v_actor_name text;
  v_alloc      record;
  v_on_hand    numeric;
  v_blocked    text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_capability('reverse_repair_return') then
    raise exception 'forbidden: missing capability reverse_repair_return';
  end if;
  if btrim(coalesce(p_reason,'')) = '' then
    raise exception 'reason_required';
  end if;

  select * into v_receipt from repair_return_receipts where id = p_receipt_id for update;
  if v_receipt.id is null then
    raise exception 'invalid: receipt % not found', p_receipt_id;
  end if;
  if not public.plant_in_scope(v_receipt.plant_id) then
    raise exception 'forbidden: plant out of scope';
  end if;
  if v_receipt.status = 'reversed' then
    return jsonb_build_object('already_reversed', true, 'receipt_id', p_receipt_id);
  end if;

  select ua.id into v_actor from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;
  select ua.name into v_actor_name from user_accounts ua where ua.id = v_actor;
  v_actor_name := coalesce(v_actor_name, 'Unknown');

  -- Readable pre-check: if a returned unit has since been issued, name the item
  -- instead of surfacing a raw CHECK violation.
  select si.item_name into v_blocked
    from repair_return_allocations a
    join store_items si on si.id = a.store_item_id
   where a.receipt_id = p_receipt_id and si.on_hand < a.qty
   limit 1;
  if v_blocked is not null then
    raise exception 'reversal_blocked: % has been issued since the return', v_blocked;
  end if;

  for v_alloc in
    select a.*, si.id as item_id
      from repair_return_allocations a
      left join store_items si on si.id = a.store_item_id
     where a.receipt_id = p_receipt_id
  loop
    if v_alloc.item_id is null then
      raise exception 'reversal_blocked: register row for % no longer exists', v_alloc.item_name;
    end if;
    update store_items
       set repaired_qty = greatest(0, repaired_qty - v_alloc.qty),
           on_hand      = on_hand - v_alloc.qty,
           updated_at   = now()
     where id = v_alloc.item_id
     returning on_hand into v_on_hand;

    if v_alloc.defective_part_id is not null then
      update maintenance_defective_parts
         set repair_returned_qty = greatest(0, repair_returned_qty - v_alloc.qty)
       where id = v_alloc.defective_part_id;
    end if;

    update maintenance_tickets t
       set repair_returned_qty = greatest(0, coalesce(
             (select sum(d.repair_returned_qty) from maintenance_defective_parts d where d.ticket_id = t.id),
             t.repair_returned_qty - v_alloc.qty))
     where t.id = v_alloc.ticket_id;

    insert into store_stock_events (item_id, plant_id, event_type, qty_delta, on_hand_after, ref, justification, actor, actor_name)
    values (v_alloc.item_id, v_receipt.plant_id, 'repair_reversal', -v_alloc.qty, v_on_hand,
            'repair_return:' || p_receipt_id,
            format('Reversed repair return · %s · %s', v_alloc.item_name, btrim(p_reason)),
            v_actor, v_actor_name);
  end loop;

  update repair_return_receipts
     set status = 'reversed', reversed_by = v_actor, reversed_by_name = v_actor_name,
         reversed_at = now(), reversal_reason = btrim(p_reason)
   where id = p_receipt_id;

  insert into activity_logs (plant_id, type, date, done_by, equipment, note)
  values (v_receipt.plant_id, 'repair_return_reversed', current_date, v_actor_name,
          'Repair return reversed',
          format('receipt %s · %s', left(p_receipt_id::text, 8), btrim(p_reason)));

  return jsonb_build_object('already_reversed', false, 'receipt_id', p_receipt_id);
exception
  when check_violation then
    raise exception 'reversal_blocked_concurrent: stock changed while reversing — retry';
end $$;

revoke all on function public.reverse_repair_return(uuid, text) from public, anon;
grant execute on function public.reverse_repair_return(uuid, text) to authenticated;

notify pgrst, 'reload schema';
