-- ═══════════════════════════════════════════════════════════════════════════
-- 55_repair_returns.sql — return repaired parts to inventory (receipts +
--                         allocations + repaired-stock bucket + RPCs)
-- ═══════════════════════════════════════════════════════════════════════════
-- Repair flow today: a closed emergency ticket with defective_part_decision =
-- 'repair' means the part went to a third-party vendor — and that was the end
-- of the trail. This migration adds the way back:
--   • maintenance_tickets.repair_qty / repair_returned_qty — units sent vs
--     returned (existing repair tickets default to qty 1 — one defective part
--     per ticket was the historical model).
--   • store_items.repaired_qty — repaired units are a SEPARATE bucket so the
--     register can always show new vs repaired stock:
--       on_hand = baseline + procured − issued + manual_delta + repaired
--   • repair_return_receipts   — one physical return event (vendor, invoice,
--     bill file, date, mandatory comment). CLIENT-generated id = idempotency.
--   • repair_return_allocations — how the receipt's quantity is split across
--     one or MORE repair tickets (multi-batch returns on a single invoice).
--   • apply_repair_return(payload jsonb)          — atomic + idempotent apply.
--   • reverse_repair_return(p_receipt_id, p_reason) — controlled reversal via
--     offsetting movements; history is never deleted.
--   • capability seeds: 'return_repairs' → unit_head, warehouse_manager,
--     store_manager_*; 'reverse_repair_return' → unit_head (admin implicit).
--
-- Scrap safety: the RPC hard-rejects tickets whose decision is not 'repair',
-- so scrapped parts can never re-enter stock through this path.
--
-- Requires 08 (maintenance_tickets), 28 (plant_in_scope), 32 (has_capability),
-- 37 (store_items/events). Idempotent. Reversible via 55_rollback_repair_returns.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Quantity tracking on the repair source.
alter table maintenance_tickets
  add column if not exists repair_qty numeric not null default 1 check (repair_qty > 0),
  add column if not exists repair_returned_qty numeric not null default 0 check (repair_returned_qty >= 0);

-- 2) Repaired-stock bucket on the living register.
alter table store_items add column if not exists repaired_qty numeric not null default 0;
comment on column store_items.on_hand is
  'baseline_qty + procured_qty - issued_qty + manual_delta + repaired_qty (app/RPC-maintained)';

-- 3) One row per physical return event.
create table if not exists repair_return_receipts (
  id              uuid primary key,              -- CLIENT-generated (idempotency key)
  plant_id        uuid not null references plants(id) on delete cascade,
  vendor_name     text,
  invoice_no      text,
  invoice_url     text,                          -- Cloudinary bill archive
  return_date     date default current_date,
  comment         text not null check (btrim(comment) <> ''),
  repair_cost     numeric,
  condition_note  text,
  actor           uuid references user_accounts(id) on delete set null,
  actor_name      text,
  status          text not null default 'active' check (status in ('active','reversed')),
  reversed_by     uuid references user_accounts(id) on delete set null,
  reversed_by_name text,
  reversed_at     timestamptz,
  reversal_reason text,
  created_at      timestamptz default now()
);
create index if not exists idx_rrr_plant_date on repair_return_receipts(plant_id, return_date);
-- NON-unique on purpose: invoice numbers are only unique per vendor and may be
-- blank; this backs the client's soft duplicate warning.
create index if not exists idx_rrr_vendor_invoice
  on repair_return_receipts(plant_id, lower(vendor_name), invoice_no)
  where invoice_no is not null;

-- 4) Receipt → ticket quantity split.
create table if not exists repair_return_allocations (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references repair_return_receipts(id) on delete cascade,
  plant_id      uuid not null,                   -- denormalized for RLS
  ticket_id     uuid not null references maintenance_tickets(id) on delete cascade,
  store_item_id uuid references store_items(id) on delete set null,
  item_name     text not null,
  qty           numeric not null check (qty > 0),
  created_at    timestamptz default now()
);
create index if not exists idx_rra_receipt on repair_return_allocations(receipt_id);
create index if not exists idx_rra_ticket  on repair_return_allocations(ticket_id);

-- ── RLS: read within plant scope; writes ONLY via the RPCs below. ────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['repair_return_receipts','repair_return_allocations'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "scope_read" on %I', tbl);
    execute format('create policy "scope_read" on %I for select using (public.plant_in_scope(plant_id))', tbl);
  end loop;
end $$;

-- 5) Atomic, idempotent apply.
-- payload: {
--   id: uuid (client-generated), plant_id: uuid,
--   vendor_name?, invoice_no?, invoice_url?, return_date? ('YYYY-MM-DD'),
--   comment (required), repair_cost?, condition_note?, actor_name?,
--   allocations: [{ ticket_id, qty, item_name, store_item_id?, unit? }, …]
-- }
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
  v_ticket     maintenance_tickets%rowtype;
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

  -- Idempotency gate.
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

    -- Lock the ticket row; validate eligibility.
    select * into v_ticket from maintenance_tickets
     where id = (v_alloc->>'ticket_id')::uuid for update;
    if v_ticket.id is null then
      raise exception 'invalid: ticket % not found', v_alloc->>'ticket_id';
    end if;
    if v_ticket.plant_id is distinct from v_plant then
      raise exception 'invalid: ticket % belongs to a different plant', v_alloc->>'ticket_id';
    end if;
    if v_ticket.defective_part_decision is distinct from 'repair' then
      raise exception 'not_repair: ticket % is not a repair ticket (decision: %)',
        v_alloc->>'ticket_id', coalesce(v_ticket.defective_part_decision, 'none');
    end if;
    v_pending := v_ticket.repair_qty - v_ticket.repair_returned_qty;
    if v_qty > v_pending then
      raise exception 'over_return: ticket % has % pending, requested %',
        v_alloc->>'ticket_id', v_pending, v_qty;
    end if;

    update maintenance_tickets
       set repair_returned_qty = repair_returned_qty + v_qty
     where id = v_ticket.id;

    -- Target register row: explicit store_item_id (verified for plant) or by
    -- name; created when the part has no register row yet.
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

    insert into repair_return_allocations (receipt_id, plant_id, ticket_id, store_item_id, item_name, qty)
    values (v_id, v_plant, v_ticket.id, v_item_id, v_name, v_qty);

    insert into store_stock_events (item_id, plant_id, event_type, qty_delta, on_hand_after, ref, justification, actor, actor_name)
    values (v_item_id, v_plant, 'repair_return', v_qty, v_on_hand, 'repair_return:' || v_id,
            format('Repaired & returned %s · %s · ticket #%s', v_qty, v_name, left(v_ticket.id::text, 8)),
            v_actor, v_actor_name);

    v_total := v_total + v_qty;
    v_count := v_count + 1;
  end loop;

  insert into activity_logs (plant_id, type, date, done_by, equipment, note)
  values (v_plant, 'repair_return', current_date, v_actor_name,
          format('Repair return: %s unit(s), %s ticket(s)', v_total, v_count),
          format('%s%s · %s',
                 coalesce('vendor ' || nullif(btrim(coalesce(payload->>'vendor_name','')), ''), 'no vendor'),
                 coalesce(' · invoice ' || nullif(btrim(coalesce(payload->>'invoice_no','')), ''), ''),
                 v_comment));

  return jsonb_build_object('already_applied', false, 'receipt_id', v_id,
                            'tickets', v_count, 'total_qty', v_total);
end $$;

revoke all on function public.apply_repair_return(jsonb) from public, anon;
grant execute on function public.apply_repair_return(jsonb) to authenticated;

-- 6) Controlled reversal — offsetting movements, never deletes.
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

  -- Readable pre-check: if any returned unit has since been issued, the
  -- reversal would drive on_hand negative — name the item instead of a raw
  -- constraint error. (Rows get locked in the loop below; the CHECK constraint
  -- remains the backstop for the tiny race window.)
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

    update maintenance_tickets
       set repair_returned_qty = greatest(0, repair_returned_qty - v_alloc.qty)
     where id = v_alloc.ticket_id;

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

-- 7) Capability seeds.
update roles
   set capabilities = array_append(capabilities, 'return_repairs')
 where id in ('unit_head','warehouse_manager','store_manager_maint',
              'store_manager_chlorides','store_manager_plasticiser')
   and not ('return_repairs' = any(capabilities));

update roles
   set capabilities = array_append(capabilities, 'reverse_repair_return')
 where id in ('unit_head')
   and not ('reverse_repair_return' = any(capabilities));

notify pgrst, 'reload schema';
