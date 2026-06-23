-- ============================================================================
-- Migration 0006 — User accounts + Blacklist registry
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor.
--
-- Formalises the two tables the app already reads/writes (with graceful
-- degradation if missing):
--   • user_accounts — directory of real users for the role/profile switcher and
--     the User Management screen.
--   • blacklist — restricted persons/vehicles/vendors registry, with a
--     resolve workflow.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS. No seed (data is operator-entered).
-- If these tables already exist with data, this is a no-op.
-- ============================================================================

create table if not exists public.user_accounts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  mobile       text,
  email        text,
  whatsapp     text,
  role_id      text,
  role_label   text,
  plant_id     uuid references public.plants (id) on delete set null,
  plant_name   text,
  designation  text,
  access_note  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists user_accounts_active_idx on public.user_accounts (is_active, created_at desc);

create table if not exists public.blacklist (
  id               uuid primary key default gen_random_uuid(),
  type             text not null check (type in ('person','vehicle','vendor','other')),
  name             text not null,
  identifier       text,
  reason           text not null,
  severity         text not null default 'medium' check (severity in ('low','medium','high','critical')),
  notes            text,
  reference_no     text,
  added_by         text,
  added_by_role    text,
  is_active        boolean not null default true,
  resolved_at      timestamptz,
  resolved_by      text,
  resolved_reason  text,
  created_at       timestamptz not null default now()
);

create index if not exists blacklist_active_idx on public.blacklist (is_active, created_at desc);

-- ── Realtime ────────────────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table public.user_accounts;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.blacklist;
exception when duplicate_object then null; end $$;
