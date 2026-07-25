-- ═══════════════════════════════════════════════════════════════════════════
-- 53_stock_purchases.sql — Purchase receipts + atomic apply_stock_purchase RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- "Add purchase to stock" previously wrote store_items / store_stock_events /
-- activity_logs line-by-line from the client: not atomic, not idempotent, and
-- the purchase itself (vendor, amount, GST, invoice) was never persisted.
-- This migration adds:
--   • stock_purchase_receipts — one row per purchase (vendor, amount, GST,
--     invoice no/date, bill URL, notes). The id is CLIENT-generated and doubles
--     as the idempotency key: retrying the same submission cannot double-apply.
--   • stock_purchase_lines    — the items bought on that receipt.
--   • apply_stock_purchase(payload jsonb) — SECURITY DEFINER RPC that validates,
--     inserts the receipt + lines, increments store_items (procured_qty/on_hand),
--     writes store_stock_events 'procure' rows and one activity_logs row — all
--     in ONE transaction. Enforces auth + capability + plant scope internally.
--   • capability seed: 'add_stock_purchase' → unit_head, warehouse_manager,
--     store_manager_*, purchase_manager (admin holds everything implicitly).
--
-- Requires 28 (plant_in_scope), 32 (has_capability), 37 (store_items/events).
-- Idempotent. Reversible via 53_rollback_stock_purchases.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Receipt header — one per purchase submission.
create table if not exists stock_purchase_receipts (
  id            uuid primary key,                -- CLIENT-generated (idempotency key)
  plant_id      uuid not null references plants(id) on delete cascade,
  vendor_name   text not null check (btrim(vendor_name) <> ''),
  amount        numeric not null check (amount >= 0),   -- total bill amount (₹)
  gst_no        text,                            -- vendor GSTIN (validated client-side)
  invoice_no    text,
  purchase_date date,
  bill_url      text,                            -- Cloudinary archive of the bill
  notes         text,
  source        text default 'manual' check (source in ('manual','bill')),
  actor         uuid references user_accounts(id) on delete set null,
  actor_name    text,
  created_at    timestamptz default now()
);
create index if not exists idx_spr_plant_date on stock_purchase_receipts(plant_id, purchase_date);
-- NON-unique: invoice numbers are only unique per vendor in the real world and
-- may be blank / OCR-misread. Used for the client's soft duplicate warning.
create index if not exists idx_spr_vendor_invoice
  on stock_purchase_receipts(plant_id, lower(vendor_name), invoice_no)
  where invoice_no is not null;

-- 2) Receipt lines — items on the bill.
create table if not exists stock_purchase_lines (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references stock_purchase_receipts(id) on delete cascade,
  plant_id      uuid not null,                   -- denormalized for RLS
  item_name     text not null,
  qty           numeric not null check (qty > 0),
  unit          text,
  unit_price    numeric,
  amount        numeric,                         -- line amount when known (from OCR)
  store_item_id uuid references store_items(id) on delete set null,
  created_new   boolean default false,           -- true when the line created the register row
  created_at    timestamptz default now()
);
create index if not exists idx_spl_receipt on stock_purchase_lines(receipt_id);
create index if not exists idx_spl_item    on stock_purchase_lines(store_item_id);

-- ── RLS: read within plant scope; NO write policies — writes go through the
--    SECURITY DEFINER RPC below only (these tables are a financial ledger). ────
do $$
declare tbl text;
begin
  foreach tbl in array array['stock_purchase_receipts','stock_purchase_lines'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "scope_read" on %I', tbl);
    execute format('create policy "scope_read" on %I for select using (public.plant_in_scope(plant_id))', tbl);
  end loop;
end $$;

-- 3) The atomic, idempotent apply.
-- payload: {
--   id: uuid (client-generated), plant_id: uuid, vendor_name: text,
--   amount: number, gst_no?, invoice_no?, purchase_date? ('YYYY-MM-DD'),
--   bill_url?, notes?, source? ('manual'|'bill'), actor_name?,
--   lines: [{ item_name, qty, unit?, unit_price?, amount?, store_item_id? }, …]
-- }
create or replace function public.apply_stock_purchase(payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id         uuid;
  v_plant      uuid;
  v_vendor     text;
  v_amount     numeric;
  v_actor      uuid;
  v_actor_name text;
  v_line       jsonb;
  v_name       text;
  v_qty        numeric;
  v_item_id    uuid;
  v_on_hand    numeric;
  v_existing   uuid;
  v_count      integer := 0;
  v_ref        text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_capability('add_stock_purchase') then
    raise exception 'forbidden: missing capability add_stock_purchase';
  end if;

  v_id     := (payload->>'id')::uuid;
  v_plant  := (payload->>'plant_id')::uuid;
  v_vendor := btrim(coalesce(payload->>'vendor_name', ''));
  v_amount := (payload->>'amount')::numeric;

  if v_id is null then raise exception 'invalid: id is required'; end if;
  if v_plant is null then raise exception 'invalid: plant_id is required'; end if;
  if not public.plant_in_scope(v_plant) then
    raise exception 'forbidden: plant out of scope';
  end if;
  if v_vendor = '' then raise exception 'invalid: vendor_name is required'; end if;
  if v_amount is null or v_amount < 0 then raise exception 'invalid: amount must be >= 0'; end if;
  if payload->'lines' is null or jsonb_typeof(payload->'lines') <> 'array'
     or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'invalid: at least one line is required';
  end if;
  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    if btrim(coalesce(v_line->>'item_name','')) = '' then
      raise exception 'invalid: every line needs an item_name';
    end if;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      raise exception 'invalid: every line qty must be > 0';
    end if;
  end loop;

  select ua.id into v_actor from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;
  v_actor_name := coalesce(nullif(btrim(coalesce(payload->>'actor_name','')), ''), 'Unknown');
  v_ref := case when coalesce(payload->>'invoice_no','') <> ''
                then 'invoice ' || (payload->>'invoice_no') else 'manual purchase' end;

  -- Idempotency gate: same receipt id already committed → report, change nothing.
  insert into stock_purchase_receipts
    (id, plant_id, vendor_name, amount, gst_no, invoice_no, purchase_date,
     bill_url, notes, source, actor, actor_name)
  values
    (v_id, v_plant, v_vendor, v_amount,
     nullif(upper(btrim(coalesce(payload->>'gst_no',''))), ''),
     nullif(btrim(coalesce(payload->>'invoice_no','')), ''),
     nullif(payload->>'purchase_date','')::date,
     nullif(payload->>'bill_url',''), nullif(payload->>'notes',''),
     coalesce(nullif(payload->>'source',''), 'manual'),
     v_actor, v_actor_name)
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('already_applied', true, 'receipt_id', v_id);
  end if;

  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_name := btrim(v_line->>'item_name');
    v_qty  := (v_line->>'qty')::numeric;

    -- Explicit register-row target (client matched it) — verify plant, else fall
    -- through to the name upsert.
    v_existing := null;
    if coalesce(v_line->>'store_item_id','') <> '' then
      select si.id into v_existing from store_items si
       where si.id = (v_line->>'store_item_id')::uuid and si.plant_id = v_plant;
    end if;
    if v_existing is null then
      select si.id into v_existing from store_items si
       where si.plant_id = v_plant and lower(si.item_name) = lower(v_name);
    end if;

    if v_existing is not null then
      update store_items
         set procured_qty = procured_qty + v_qty,
             on_hand      = on_hand + v_qty,
             updated_at   = now()
       where id = v_existing
       returning id, on_hand into v_item_id, v_on_hand;
      insert into stock_purchase_lines (receipt_id, plant_id, item_name, qty, unit, unit_price, amount, store_item_id, created_new)
      values (v_id, v_plant, v_name, v_qty, nullif(v_line->>'unit',''),
              (v_line->>'unit_price')::numeric, (v_line->>'amount')::numeric, v_item_id, false);
      insert into store_stock_events (item_id, plant_id, event_type, qty_delta, on_hand_after, ref, justification, actor, actor_name)
      values (v_item_id, v_plant, 'procure', v_qty, v_on_hand, 'purchase:' || v_id,
              format('Purchased %s · %s · %s', v_qty, v_name, v_vendor), v_actor, v_actor_name);
    else
      insert into store_items (plant_id, item_name, unit, equipment, model, baseline_qty, procured_qty, issued_qty, manual_delta, on_hand)
      values (v_plant, v_name, nullif(v_line->>'unit',''), nullif(v_line->>'equipment',''), nullif(v_line->>'model',''), 0, v_qty, 0, 0, v_qty)
      returning id, on_hand into v_item_id, v_on_hand;
      insert into stock_purchase_lines (receipt_id, plant_id, item_name, qty, unit, unit_price, amount, store_item_id, created_new)
      values (v_id, v_plant, v_name, v_qty, nullif(v_line->>'unit',''),
              (v_line->>'unit_price')::numeric, (v_line->>'amount')::numeric, v_item_id, true);
      insert into store_stock_events (item_id, plant_id, event_type, qty_delta, on_hand_after, ref, justification, actor, actor_name)
      values (v_item_id, v_plant, 'procure', v_qty, v_on_hand, 'purchase:' || v_id,
              format('New item from purchase · %s · %s', v_name, v_vendor), v_actor, v_actor_name);
    end if;
    v_count := v_count + 1;
  end loop;

  insert into activity_logs (plant_id, type, date, done_by, equipment, note)
  values (v_plant, 'stock_purchase', current_date, v_actor_name,
          format('Purchase: %s item(s)', v_count),
          format('%s · %s · ₹%s%s', v_ref, v_vendor, v_amount,
                 case when coalesce(payload->>'bill_url','') <> '' then ' · bill: ' || (payload->>'bill_url') else '' end));

  return jsonb_build_object('already_applied', false, 'receipt_id', v_id, 'lines_applied', v_count);
end $$;

revoke all on function public.apply_stock_purchase(jsonb) from public, anon;
grant execute on function public.apply_stock_purchase(jsonb) to authenticated;

-- 4) Capability seed (idempotent append; admin implicit via has_capability).
update roles
   set capabilities = array_append(capabilities, 'add_stock_purchase')
 where id in ('unit_head','warehouse_manager','store_manager_maint',
              'store_manager_chlorides','store_manager_plasticiser','purchase_manager')
   and not ('add_stock_purchase' = any(capabilities));

notify pgrst, 'reload schema';
