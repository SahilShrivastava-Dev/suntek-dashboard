-- ─────────────────────────────────────────────────────────────────────────────
-- 10_mentions.sql — @-mention tagging, CC / watchers, and per-entity notes
--
-- Adds two generic tables that can attach to ANY record in the app
-- (a maintenance ticket, an anomaly flag, a batch, a purchase order, …)
-- keyed by (entity_type, entity_id). Notifications themselves reuse the
-- existing `notifications` table (see 03_notifications.sql) — a tagged person
-- is simply their profile id pushed into notifications.target_roles, so the
-- TopBar bell + realtime already light up with no further wiring.
--
-- Run this once in the Supabase SQL editor, then enable Realtime on both tables
-- (Database → Replication → supabase_realtime) if you want live note threads.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Per-entity notes / comments (free text + @mentions) ──────────────────────
create table if not exists public.entity_notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text        not null,           -- e.g. 'anomaly', 'active_batch', 'maintenance_ticket'
  entity_id   text        not null,           -- the record id (text so any id type fits)
  author_id   text        not null,           -- profile id of the author
  author_name text        not null,
  author_role text,
  body        text        not null,
  mentions    text[]      not null default '{}',  -- profile ids tagged via @
  created_at  timestamptz not null default now()
);

create index if not exists entity_notes_entity_idx
  on public.entity_notes (entity_type, entity_id, created_at);

-- ── CC / watchers (people who follow an entity's changes) ────────────────────
create table if not exists public.entity_watchers (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text        not null,
  entity_id    text        not null,
  profile_id   text        not null,          -- the watched person's profile id
  profile_name text        not null,
  kind         text        not null default 'cc',  -- 'cc' | 'mention' | 'author'
  added_by     text,
  created_at   timestamptz not null default now(),
  unique (entity_type, entity_id, profile_id)
);

create index if not exists entity_watchers_entity_idx
  on public.entity_watchers (entity_type, entity_id);

-- ── RLS (permissive, matching the rest of this internal app) ─────────────────
alter table public.entity_notes    enable row level security;
alter table public.entity_watchers enable row level security;

drop policy if exists anon_all on public.entity_notes;
create policy anon_all on public.entity_notes
  for all using (true) with check (true);

drop policy if exists anon_all on public.entity_watchers;
create policy anon_all on public.entity_watchers
  for all using (true) with check (true);

-- Optional: enable realtime so open note threads update live.
-- alter publication supabase_realtime add table public.entity_notes;
-- alter publication supabase_realtime add table public.entity_watchers;
