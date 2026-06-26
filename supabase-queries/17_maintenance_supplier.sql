-- ─────────────────────────────────────────────────────────────────────────────
-- 17_maintenance_supplier.sql — record the external supplier on a store request
--
-- The unit head names the supplier when procuring (BUSY ref); the purchase
-- manager enters the price from the bill. Both feed the Purchase Order created
-- on the Purchase Orders page when the part is bought externally.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.maintenance_store_requests
  add column if not exists supplier_name text;
