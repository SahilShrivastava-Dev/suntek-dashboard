-- ─────────────────────────────────────────────────────────────────────────────
-- 04_anomalies.sql
-- Anomaly Detection engine — persistence, throttling, history, lag-effect watches.
-- Used by: AnomalyContext, CautionButton, AnomalyDashboard, anomaly-scan engine.
--
-- NOTE: The MVP detection engine computes findings in the Express server over the
-- real BUSY/MSSQL data and serves them via /api/anomaly/scan. These tables are the
-- PRODUCTION persistence path: the scan writes findings here so the caution-bell can
-- update in realtime and so history/throttling survive restarts. The frontend
-- degrades gracefully if these tables do not exist yet (same pattern as notifications).
--
-- IMPORTANT: After running, enable Realtime on anomaly_log:
--   Dashboard → Database → Replication → Tables → toggle anomaly_log ON
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. anomaly_log — every fired finding + throttling + history + LLM narrative
create table if not exists anomaly_log (
  id              uuid primary key default gen_random_uuid(),
  anomaly_type    text not null,                 -- 'A14_vendor_switch' | 'MARGIN_COMPRESSION' ...
  tier            smallint not null default 1,   -- 1 rule · 2 statistical · 3 ML/compound
  layer           text not null default 'rule',  -- 'rule' | 'stat' | 'ml' | 'llm'
  severity        text not null default 'info',  -- 'info' | 'warning' | 'urgent'
  entity_id       text,                          -- 'vendor:VK Enterprises' | 'customer:Madan ...'
  entity_type     text,                          -- 'vendor'|'customer'|'equipment'|'batch'|'plant'|'kpi'
  kpi_key         text,                          -- which dashboard KPI this flags (problem-KPI grid)
  score           numeric,                       -- 0..1 normalized anomaly score
  metric_value    numeric,
  baseline_value  numeric,
  detail          jsonb default '{}',            -- evidence + detail.llm = AI narrative
  title           text not null,
  body            text,
  route           text,                          -- deep-link, e.g. '/dashboard/anomalies?a=<id>'
  status          text default 'open',           -- 'open'|'acknowledged'|'resolved'|'muted'
  recurrence      int  default 1,                -- bumped instead of re-notifying within cooldown
  fired_at        timestamptz default now(),
  cooldown_until  timestamptz,
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  auto_resolved   boolean default false,
  is_synthetic    boolean default false          -- seeded demo data flag (one-toggle cleanup)
);
create index if not exists idx_anomaly_open   on anomaly_log (status, severity, fired_at desc);
create index if not exists idx_anomaly_dedupe on anomaly_log (anomaly_type, entity_id, cooldown_until);

-- 2. anomaly_watches — lag-effect watch windows (A15 vendor switch → quality drop)
create table if not exists anomaly_watches (
  id               uuid primary key default gen_random_uuid(),
  trigger_type     text not null,                -- 'A14_vendor_switch'
  trigger_ref      text,                         -- originating contract / finding id
  plant_id         text,
  oil_type         text,
  metric_to_watch  text not null,                -- 'avg_cp_gravity' | 'gross_margin_pct'
  baseline_value   numeric,                      -- pre-switch baseline
  recipe_group     text,                         -- density bucket (respects A1 recipe-change flag)
  watch_from       timestamptz default now(),
  watch_until      timestamptz not null,         -- now() + 14 days
  min_post_batches smallint default 5,
  status           text default 'active',        -- 'active'|'fired'|'expired'|'cleared'
  created_at       timestamptz default now()
);
create index if not exists idx_watches_active on anomaly_watches (status, watch_until);

-- 3. customer_outstanding_log — daily snapshots (solves A8/A31 "outstanding is not a time-series")
create table if not exists customer_outstanding_log (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        text not null,
  customer_name      text,
  outstanding        numeric not null,
  dispatched_qty_mtd numeric,
  snapshot_date      date not null default current_date,
  is_synthetic       boolean default false,
  unique (customer_id, snapshot_date)
);

-- 4. item_master — canonical names + aliases (solves A12/A13/A32 free-text matching)
create table if not exists item_master (
  id        uuid primary key default gen_random_uuid(),
  canonical text not null,                        -- 'Liquid Paraffin IP'
  aliases   text[] default '{}',                  -- ['Liquid paraffin','LP','Liq Paraffin']
  category  text                                  -- 'oil'|'cp'|'chemical'
);

-- 5. detector_config — per-detector thresholds/guards (solves A2/A3/A17 "needs config")
create table if not exists detector_config (
  anomaly_type    text primary key,
  label           text,
  enabled         boolean default true,
  tier            smallint default 1,
  min_data_points int default 0,
  ml_min_points   int,
  cooldown_hours  int default 24,
  thresholds      jsonb default '{}',             -- {temp_low:15, temp_high:55, drop_pct:0.08} ...
  target_roles    text[] default '{admin}'
);

-- 6. notifications column extensions (anomaly alerts piggyback on the existing bell)
alter table notifications add column if not exists anomaly_type   text;
alter table notifications add column if not exists anomaly_log_id uuid;
alter table notifications add column if not exists entity_id      text;
alter table notifications add column if not exists entity_type    text;
alter table notifications add column if not exists cooldown_until timestamptz;
alter table notifications add column if not exists auto_resolved  boolean default false;

-- RLS — match the project convention (anon_all)
alter table anomaly_log               enable row level security;
alter table anomaly_watches           enable row level security;
alter table customer_outstanding_log  enable row level security;
alter table item_master               enable row level security;
alter table detector_config           enable row level security;
create policy "anon_all" on anomaly_log              for all using (true) with check (true);
create policy "anon_all" on anomaly_watches          for all using (true) with check (true);
create policy "anon_all" on customer_outstanding_log for all using (true) with check (true);
create policy "anon_all" on item_master              for all using (true) with check (true);
create policy "anon_all" on detector_config          for all using (true) with check (true);

-- Seed detector configuration (thresholds are admin-editable later)
insert into detector_config (anomaly_type, label, tier, min_data_points, cooldown_hours, thresholds, target_roles) values
  ('MARGIN_COMPRESSION', 'Gross margin compression', 2, 2, 24, '{"drop_pct":0.05}',           '{admin,unit_head}'),
  ('A14_vendor_switch',  'Vendor switch + cost jump', 1, 0, 24, '{"price_jump_pct":0.10}',     '{admin,unit_head}'),
  ('A6_revenue_pace',    'MTD revenue pace drop',     2, 1, 24, '{"drop_pct":0.20}',           '{admin}'),
  ('A7_customer_silent', 'Top customer going silent', 2, 1, 48, '{"silent_days":30}',          '{admin}'),
  ('A8_credit_risk',     'Outstanding + active dispatch', 2, 1, 24, '{"outstanding_min":500000}', '{admin}'),
  ('A21_recurring_breakdown', 'Recurring equipment breakdown', 1, 0, 12, '{"window_days":30,"min_count":3}', '{admin,unit_head}'),
  ('A27_offsite_checkin', 'Off-site GPS check-in',    1, 0, 6,  '{}',                          '{admin,unit_head}')
on conflict (anomaly_type) do nothing;

-- Enable Realtime (run separately in Dashboard → Database → Replication if this errors)
-- alter publication supabase_realtime add table anomaly_log;
