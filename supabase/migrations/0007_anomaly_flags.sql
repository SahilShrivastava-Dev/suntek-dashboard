-- ============================================================================
-- Migration 0007 — Anomaly flags (Phase 2: Anomaly Operations Center, doc §3.1)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor.
--
-- The single feed every anomaly application writes into. The Anomaly Operations
-- Center aggregates these into one severity-ranked, filterable workspace, and
-- the resolve/dismiss-with-reason captured here is the feedback signal (§5.4)
-- that tunes the detectors over time.
--
-- Seeded with a few representative flags so the Center is non-empty before the
-- analytics service is live. Idempotent.
-- ============================================================================

create table if not exists public.anomaly_flags (
  id                  uuid primary key default gen_random_uuid(),
  severity            text not null default 'watch'
                        check (severity in ('critical','warning','watch')),
  source_app          text not null,          -- predictive_qc | material_recon | predictive_maint | throughput | demand | margin | receivables
  plant               text,
  entity_type         text,                   -- batch | sku | dispatch | asset | customer
  entity_id           text,
  entity_label        text,
  title               text not null,
  evidence            text,                   -- the data behind the flag
  recommended_action  text,
  value_at_stake      numeric,                -- ₹ / MT / reactor-hours at risk
  value_unit          text,                   -- 'INR' | 'MT' | 'hours'
  confidence          numeric,                -- 0..1
  status              text not null default 'open'
                        check (status in ('open','acknowledged','resolved','dismissed')),
  assigned_to         text,
  resolution_reason   text,                   -- feedback signal (§5.4)
  route               text,                   -- click-through to the source record
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  resolved_at         timestamptz
);

create index if not exists anomaly_flags_open_idx on public.anomaly_flags (status, severity, created_at desc);
create index if not exists anomaly_flags_source_idx on public.anomaly_flags (source_app);
create index if not exists anomaly_flags_plant_idx on public.anomaly_flags (plant);

-- ── Seed (only if empty) ────────────────────────────────────────────────────
insert into public.anomaly_flags
  (severity, source_app, plant, entity_type, entity_id, entity_label, title, evidence, recommended_action, value_at_stake, value_unit, confidence, route)
select * from (values
  ('critical','predictive_qc','Rehla','batch','1228','Batch #1228',
   'Mid-batch gravity drifting off the golden curve',
   'At hour 2, projected final gravity 1462 vs target 1400 (±3% band). Confidence band excludes target.',
   'Alert operator now; reduce Cl2 feed and re-check in 30 min before more NP is committed.',
   180000,'INR',0.86,'/dashboard/batches'),
  ('warning','material_recon','SHD','batch','1225','Shift B · SHD',
   'Issued NP exceeds yield-implied consumption',
   'Yield-implied NP 4.10 MT vs issued 4.55 MT (+11%) — beyond 4% process-loss noise. Pattern repeats on Shift B.',
   'Reconcile Shift B metering; check for spillage or mis-logged issues.',
   95000,'INR',0.78,'/dashboard/stock'),
  ('warning','receivables','Delhi','customer',null,'Omgee Chemicals',
   'Overdue balance past credit terms',
   'Outstanding ₹6.2L, 11 days past 30-day terms; DSO trending up 3 days WoW.',
   'Warn at next dispatch; auto-nudge the account.',
   620000,'INR',0.92,'/dashboard/customers'),
  ('watch','throughput','Ganjam','asset',null,'Reactor R-1',
   'Cycle time above plant baseline',
   'Last 3 batches averaged 2.4σ above the Ganjam cycle-time baseline.',
   'Monitor; flag for maintenance review if it persists.',
   null,null,0.64,'/dashboard/batches'),
  ('watch','predictive_maint','SHD','asset',null,'Cooling tower pump',
   'Runtime hours approaching MTBF',
   '1,180 runtime hours since last service vs 1,250-hour mean-time-between-failure.',
   'Schedule service in the next low-demand window.',
   null,'hours',0.7,'/dashboard/purchase/maint')
) as v(severity, source_app, plant, entity_type, entity_id, entity_label, title, evidence, recommended_action, value_at_stake, value_unit, confidence, route)
where not exists (select 1 from public.anomaly_flags);

-- ── Realtime ────────────────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table public.anomaly_flags;
exception when duplicate_object then null; end $$;
