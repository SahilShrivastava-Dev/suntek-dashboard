-- ─────────────────────────────────────────────────────────────────────────────
-- 10_blacklist.sql
-- Blacklist registry — admin / unit head managed
-- Types: person | vehicle | vendor | other
-- Severity: low | medium | high | critical
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists blacklist (
  id                uuid        primary key default gen_random_uuid(),
  type              text        not null check (type in ('person', 'vehicle', 'vendor', 'other')),
  name              text        not null,           -- display name / vehicle reg number
  identifier        text,                           -- secondary: employee code, fleet no., PAN, etc.
  reason            text        not null,
  severity          text        not null default 'high'
                                check (severity in ('low', 'medium', 'high', 'critical')),
  notes             text,
  reference_no      text,                           -- incident report #, contract #, etc.
  added_by          text        not null,
  added_by_role     text,
  is_active         boolean     default true,
  resolved_at       timestamptz,
  resolved_by       text,
  resolved_reason   text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- RLS
alter table blacklist enable row level security;
create policy "anon_all" on blacklist for all using (true) with check (true);
