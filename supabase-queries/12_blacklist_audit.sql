-- ─────────────────────────────────────────────────────────────────────────────
-- 12_blacklist_audit.sql — blacklist audit trail
--
-- Every blacklist interaction is logged here so the Blacklist module can produce
-- a fully auditable report: when an entity was blacklisted, by whom, how it was
-- introduced, and — crucially — every later time someone ENTERED or OCR'd a value
-- that matched a blacklisted entity (with the similarity score, workflow, the
-- person who did it, and any image involved).
--
-- Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.blacklist_events (
  id            uuid primary key default gen_random_uuid(),
  blacklist_id  uuid,                                  -- the affected blacklist entry (nullable)
  event_type    text not null,                         -- 'added' | 'resolved' | 're_added' | 'match_detected'
  entity_name   text not null,
  entity_type   text,                                  -- person | vehicle | vendor | other
  matched_value text,                                  -- what the user entered / OCR extracted
  similarity    numeric,                               -- 0..1 fuzzy score for match_detected
  workflow      text,                                  -- e.g. 'Purchase Orders', 'Daily Log OCR'
  source        text,                                  -- 'entry' | 'ocr' | 'image' | 'lifecycle'
  actor_id      text,
  actor_name    text,
  actor_role    text,
  image_url     text,
  details       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists blacklist_events_blacklist_idx on public.blacklist_events (blacklist_id, created_at);
create index if not exists blacklist_events_type_idx       on public.blacklist_events (event_type, created_at);

alter table public.blacklist_events enable row level security;
drop policy if exists anon_all on public.blacklist_events;
create policy anon_all on public.blacklist_events for all using (true) with check (true);

-- Optional: live audit feed
-- alter publication supabase_realtime add table public.blacklist_events;
