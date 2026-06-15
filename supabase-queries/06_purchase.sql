-- ─────────────────────────────────────────────────────────────────────────────
-- 06_purchase.sql
-- Purchase hub tables
-- Tables: activity_logs, fixed_assets, store_requisitions,
--         oil_contracts, marine_insurance, labour_costs
-- ─────────────────────────────────────────────────────────────────────────────

-- Plant activity / maintenance activity log (ActivityLog page)
create table if not exists activity_logs (
  id          uuid primary key default gen_random_uuid(),
  equipment   text not null,
  type        text,             -- 'regular' | 'preventive' | 'breakdown' etc.
  date        date,
  done_by     text,
  verified_by text,
  plant_id    uuid references plants(id),
  created_at  timestamptz default now()
);

-- Fixed Asset Register (FAR page)
create table if not exists fixed_assets (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  identification_mark text,
  model              text,
  capacity           text,
  origin             text,
  year               integer,
  value              numeric,
  invoice_no         text,
  purchase_date      date,
  account_head       text,
  photo_url          text,
  plant_id           uuid references plants(id),
  created_at         timestamptz default now()
);

-- Store / warehouse requisitions (StoreRequisitions page)
create table if not exists store_requisitions (
  id         uuid primary key default gen_random_uuid(),
  item       text not null,
  plant_id   uuid references plants(id),
  qty        numeric,
  urgency    text default 'medium',  -- 'low' | 'medium' | 'high' | 'urgent'
  status     text default 'pending', -- 'pending' | 'approved' | 'rejected' | 'fulfilled'
  remarks    text,
  created_at timestamptz default now()
);

-- Raw material purchase orders (PurchaseOrders page — oil, HCl etc.)
create table if not exists oil_contracts (
  id             uuid primary key default gen_random_uuid(),
  oil_type       text,           -- material name e.g. 'Liquid Paraffin IP'
  company        text,           -- supplier name
  date           date,
  book_qty_mt    numeric,        -- booked quantity in MT
  dispatched_qty numeric default 0,
  pending_qty    numeric,        -- computed or stored
  price          numeric,        -- price per MT
  port           text,           -- destination plant
  status         text default 'open', -- 'open' | 'closed'
  created_at     timestamptz default now()
);

-- Marine insurance fund ledger (MarineInsurance page)
create table if not exists marine_insurance (
  id         uuid primary key default gen_random_uuid(),
  date       date,
  type       text default 'top_up',  -- 'top_up' | 'claim' | 'adjustment'
  reference  text,
  amount     numeric,
  balance    numeric,
  mode       text,    -- 'NEFT' | 'RTGS' | 'Cheque'
  notes      text,
  created_at timestamptz default now()
);

-- Labour cost tracking (Labour page)
create table if not exists labour_costs (
  id         uuid primary key default gen_random_uuid(),
  date       date,
  plant_id   uuid references plants(id),
  category   text,   -- 'contract' | 'permanent' | 'overtime'
  workers    integer,
  amount     numeric,
  notes      text,
  created_at timestamptz default now()
);

-- RLS
alter table activity_logs      enable row level security;
alter table fixed_assets       enable row level security;
alter table store_requisitions enable row level security;
alter table oil_contracts      enable row level security;
alter table marine_insurance   enable row level security;
alter table labour_costs       enable row level security;

create policy "anon_all" on activity_logs      for all using (true) with check (true);
create policy "anon_all" on fixed_assets       for all using (true) with check (true);
create policy "anon_all" on store_requisitions for all using (true) with check (true);
create policy "anon_all" on oil_contracts      for all using (true) with check (true);
create policy "anon_all" on marine_insurance   for all using (true) with check (true);
create policy "anon_all" on labour_costs       for all using (true) with check (true);
