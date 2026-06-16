-- ============================================================================
-- Migration 0005 — Daily unit log entries
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor.
--
-- Backs src/routes/dashboard/DailyLogPage.tsx — the OCR-assisted daily monitoring
-- log (hourly readings + tank summaries per shift). The page already has a
-- fallback that writes to batch_edit_logs if this table is missing; this makes
-- it a first-class table.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS. No seed.
-- ============================================================================

create table if not exists public.unit_log_entries (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  shift           text,
  unit_name       text,
  operators       jsonb,           -- array of operator names
  helper_name     text,
  readings        jsonb,           -- array of hourly reading objects
  tank_summaries  jsonb,           -- array of tank summary objects
  remarks         text,
  notes           jsonb,           -- { hnpTank, hclTank }
  uploaded_at     timestamptz not null default now(),
  raw_extraction  jsonb,           -- raw OCR payload for audit
  created_at      timestamptz not null default now()
);

create index if not exists unit_log_entries_date_idx on public.unit_log_entries (date desc, shift);
