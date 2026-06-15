-- ─────────────────────────────────────────────────────────────────────────────
-- 07_sales.sql
-- Sales module tables
-- Tables: customers, sales_contracts
-- ─────────────────────────────────────────────────────────────────────────────

-- Customer master (CustomerHistory, Sales pages)
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  outstanding numeric default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

-- Sales contracts (booked quantity + dispatch tracking)
create table if not exists sales_contracts (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references customers(id),
  density        integer default 1400,   -- product grade e.g. 1400 kg/m³
  locked_price   numeric,                -- price locked at booking
  booked_qty     numeric,                -- total quantity booked in MT
  dispatched_qty numeric default 0,
  status         text default 'open',    -- 'open' | 'partial' | 'closed'
  created_at     timestamptz default now()
);

-- RLS
alter table customers       enable row level security;
alter table sales_contracts enable row level security;

create policy "anon_all" on customers       for all using (true) with check (true);
create policy "anon_all" on sales_contracts for all using (true) with check (true);
