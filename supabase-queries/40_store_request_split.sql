-- ═══════════════════════════════════════════════════════════════════════════
-- 40_store_request_split.sql — partial fulfilment: two parallel tracks + bulk buy
-- ═══════════════════════════════════════════════════════════════════════════
-- When a request can't be fully covered from store, it splits into two tracks
-- that run in parallel and finish independently:
--   • in-store track (fast)      → the available qty, store→unit-head→handover
--   • procurement track (slow)   → the shortfall, unit-head→purchase→bill→handover
-- `split_group` ties the two rows together so the UI can show them under one part
-- (both rows carry split_group = the original request's id).
--
-- `purchased_qty` lets procurement buy in BULK: if the ticket is short 10 but they
-- buy 100, the 10 go to the technician and the extra 90 are added to the store
-- register on handover.
-- Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

alter table maintenance_store_requests
  add column if not exists split_group   uuid,
  add column if not exists purchased_qty  numeric;

notify pgrst, 'reload schema';
