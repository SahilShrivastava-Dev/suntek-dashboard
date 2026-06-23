-- ─────────────────────────────────────────────────────────────────────────────
-- 15_maintenance_cost.sql — capture the cost of procured maintenance parts
--
-- The unit head (at procurement) and the purchase manager (at bill upload) enter
-- the product's unit price; total_price = unit_price × quantity. These feed the
-- FAR "Maintenance & Repairs by Financial Year" aggregate (insurance deduction).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.maintenance_store_requests
  add column if not exists unit_price  numeric,
  add column if not exists total_price numeric;
