-- ─────────────────────────────────────────────────────────────────────────────
-- 13_notifications_cleared.sql — per-person "Clear all" for notifications
--
-- Adds a cleared_by array (mirrors read_by). When a user clicks "Clear all",
-- their profile id is appended to cleared_by on every notification they can see,
-- and the bell hides any notification whose cleared_by contains the viewer's id.
-- This is PER PERSON — clearing for admin does not remove it for unit head.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notifications
  add column if not exists cleared_by text[] not null default '{}';
