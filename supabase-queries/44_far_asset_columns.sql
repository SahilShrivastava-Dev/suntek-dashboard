-- ═══════════════════════════════════════════════════════════════════════════
-- 44_far_asset_columns.sql — round out fixed_assets for the full FAR file
-- ═══════════════════════════════════════════════════════════════════════════
-- The client's FAR sheet carries Make, Serial no. and Quantity, which the asset
-- table didn't store. FAR becomes the master for Preventive Maintenance, so it
-- must hold everything. (identification_mark already exists — it's the join key
-- to a PM schedule, normalised in the app so "GLC 1" ≈ "GLC1".)
-- Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

alter table fixed_assets
  add column if not exists make      text,
  add column if not exists serial_no text,
  add column if not exists quantity  numeric;

notify pgrst, 'reload schema';
