-- ─────────────────────────────────────────────────────────────────────────────
-- 08b_maintenance_store_columns.sql
-- Add store availability detail columns + handover columns to
-- maintenance_store_requests (run after 08_maintenance.sql)
-- ─────────────────────────────────────────────────────────────────────────────

alter table maintenance_store_requests
  add column if not exists qty_in_store          numeric,          -- qty available in store (from store manager)
  add column if not exists shelf_location        text,             -- bin/shelf number e.g. "Rack B-12, Shelf 3"
  add column if not exists part_condition        text,             -- 'new' | 'used_good' | 'refurbished'
  add column if not exists handover_invoice_url  text,             -- Cloudinary URL of invoice/bill uploaded by store mgr
  add column if not exists handover_photo_url    text,             -- Cloudinary URL of part photo uploaded by store mgr
  add column if not exists handover_notes        text,
  add column if not exists handover_confirmed_at timestamptz;      -- when store manager confirmed physical handover
