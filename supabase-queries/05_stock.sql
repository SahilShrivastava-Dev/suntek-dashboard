-- ─────────────────────────────────────────────────────────────────────────────
-- 05_stock.sql
-- CPM inventory stock levels
-- Used by: CPMStock page, WarehouseEntry
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists stock_levels (
  id         uuid primary key default gen_random_uuid(),
  item       text not null,
  plant_id   uuid references plants(id),
  qty        numeric default 0,
  direction  text default 'in',   -- 'in' | 'out'
  adjustment numeric,
  note       text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- RLS
alter table stock_levels enable row level security;
create policy "anon_all" on stock_levels for all using (true) with check (true);
