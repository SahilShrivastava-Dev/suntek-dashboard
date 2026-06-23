-- ============================================================================
-- Migration 0004 — Operator session cache + batch edit audit log
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor.
--
-- Backs src/routes/operator/BatchLogger.tsx:
--   • operator_sessions — per-device (IP) draft cache so an operator's in-progress
--     reading/batch form survives a refresh (30-min TTL, also mirrored to
--     localStorage).
--   • batch_edit_logs — append-only audit trail of operator actions (reading
--     logged, batch created) with IP + timestamp.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS. No seed.
-- ============================================================================

create table if not exists public.operator_sessions (
  ip_address           text primary key,
  selected_batch       text,
  temp_input           text,
  cp_gravity_input     text,
  cl2_press_input      text,
  active_tab           text,
  new_batch_no_input   text,
  new_recipe_input     text,
  new_target_qty_input text,
  last_active          timestamptz not null default now()
);

create table if not exists public.batch_edit_logs (
  id          uuid primary key default gen_random_uuid(),
  ip_address  text,
  batch_no    text,
  action_type text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists batch_edit_logs_batch_idx on public.batch_edit_logs (batch_no, created_at desc);
