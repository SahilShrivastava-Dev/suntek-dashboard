-- ─────────────────────────────────────────────────────────────────────────────
-- 16_maintenance_unit.sql — route maintenance store requests by Jharkhand unit
--
-- Jharkhand (Rehla) has two procurement warehouses: Suntek Chlorides and Suntek
-- Plasticiser. A ticket raised by someone from the Chlorides unit should go to
-- the Chlorides store manager (and vice-versa). We tag the ticket with its unit.
-- Unit head can override/reroute. Purchase manager + unit head are unit-agnostic.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.maintenance_tickets
  add column if not exists unit text;   -- 'chlorides' | 'plasticiser' | null
