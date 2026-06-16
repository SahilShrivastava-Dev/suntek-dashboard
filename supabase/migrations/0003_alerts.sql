-- ============================================================================
-- Migration 0003 — Operational alerts feed
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor.
--
-- Replaces the hardcoded ALERTS array (src/data/mockData.ts) that powered the
-- "Open alerts" panel on the Overview dashboard. Seeded with the same entries.
-- Going forward, background jobs / triggers can insert rows here and the panel
-- shows them live.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + seed guarded by NOT EXISTS.
-- ============================================================================

create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  severity    text not null default 'low' check (severity in ('red','amber','low')),
  text        text not null,
  source      text,                 -- the module that raised it (shown as "who")
  when_label  text,                 -- human label e.g. '2 hr', 'today', 'auto'
  route       text,                 -- dashboard path for click-through
  is_resolved boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists alerts_open_idx on public.alerts (is_resolved, created_at desc);

-- ── Seed (only if empty) ────────────────────────────────────────────────────
insert into public.alerts (severity, text, source, when_label, route)
select * from (values
  ('red',   'Marine ins. balance below threshold (12 Mar)', 'Marine ledger',     'auto',   '/dashboard/purchase/marine'),
  ('red',   'NC Thinner at SHD: 3 units · threshold 5',      'CPM Stock',         '2 hr',   '/dashboard/stock'),
  ('amber', 'Batch 1228 oil-ratio variance +2.4%',           'Batch · Oil Ratio', 'today',  '/dashboard/batches'),
  ('amber', 'Customer Omgee · payment overdue 11 days',       'Sales · Payments',  'today',  '/dashboard/sales'),
  ('amber', 'Manoj (security · Ganjam) out of zone',          'Night Manager',     '42 min', '/dashboard/night-manager'),
  ('low',   '2 maintenance items pending > 7 days',           'Maintenance',       'today',  '/dashboard/purchase/maint'),
  ('low',   'Empty drum returns pending recon',               'CPM Stock',         '2 days', '/dashboard/stock')
) as v(severity, text, source, when_label, route)
where not exists (select 1 from public.alerts);

-- ── Realtime ────────────────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table public.alerts;
exception when duplicate_object then null; end $$;
