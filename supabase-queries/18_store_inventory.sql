-- ─────────────────────────────────────────────────────────────────────────────
-- 18_store_inventory.sql — maintenance spare-parts store register
--
-- Acts as a live register of parts in each store/unit. When a store manager
-- reports stock for a maintenance request, the quantity is recorded here; when a
-- part is handed over from store, the quantity is subtracted. The Store Req page
-- shows it colour-coded: green = in stock, yellow = low, red = out of stock.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.store_inventory (
  id            uuid primary key default gen_random_uuid(),
  store         text not null,                 -- unit / plant, e.g. 'Suntek Chlorides', 'SHD'
  part_name     text not null,
  quantity      numeric not null default 0,
  low_threshold numeric not null default 2,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (store, part_name)
);

create index if not exists store_inventory_store_idx on public.store_inventory (store);

alter table public.store_inventory enable row level security;
drop policy if exists anon_all on public.store_inventory;
create policy anon_all on public.store_inventory for all using (true) with check (true);
