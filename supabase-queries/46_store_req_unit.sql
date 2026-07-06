-- ═══════════════════════════════════════════════════════════════════════════
-- 46_store_req_unit.sql — measurement unit on maintenance store requests
-- ═══════════════════════════════════════════════════════════════════════════
-- A requested part's quantity can be a count, a weight (mg/g/kg) or a volume
-- (mL/L) depending on the material. Record the unit alongside the quantity so
-- it's unambiguous end to end (technician → store → procurement). Additive,
-- idempotent, does not self-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table maintenance_store_requests
  add column if not exists unit text default 'Units';

notify pgrst, 'reload schema';
