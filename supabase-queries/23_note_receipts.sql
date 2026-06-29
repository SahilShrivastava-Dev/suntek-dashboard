-- ─────────────────────────────────────────────────────────────────────────────
-- 23_note_receipts.sql — WhatsApp-style delivery / read receipts on @-mentions
--
-- One row per (note, tagged person). Two timestamps drive the UI:
--   • delivered_at — set when the mention notification row was created OK
--                    (verifies the notification pipeline; null = it errored).
--   • seen_at      — set when that person actually scrolled the comment into view.
--
-- The comment's tick (next to the author) aggregates over everyone you tagged:
--   single grey  ✓   = sent      (posted; not yet delivered to all → pipeline issue)
--   double grey  ✓✓  = delivered (notification created for every tagged person)
--   double blue  ✓✓  = seen      (every tagged person has viewed the comment)
--
-- Each @Name chip is colored per-person: indigo until THAT person's seen_at is
-- set, then green — independently of the other people tagged in the same note.
--
-- Depends on entity_notes (10_mentions.sql). Run that first.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.entity_note_receipts (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid        not null references public.entity_notes(id) on delete cascade,
  entity_type  text        not null,           -- denormalized for cheap realtime filtering
  entity_id    text        not null,
  profile_id   text        not null,           -- the tagged person this receipt is for
  delivered_at timestamptz,                     -- notification row created OK
  seen_at      timestamptz,                     -- comment scrolled into view by this person
  created_at   timestamptz not null default now(),
  unique (note_id, profile_id)
);

create index if not exists entity_note_receipts_note_idx
  on public.entity_note_receipts (note_id);
create index if not exists entity_note_receipts_entity_idx
  on public.entity_note_receipts (entity_type, entity_id);

-- ── RLS (permissive, matching the rest of this internal app) ─────────────────
alter table public.entity_note_receipts enable row level security;

drop policy if exists anon_all on public.entity_note_receipts;
create policy anon_all on public.entity_note_receipts
  for all using (true) with check (true);

-- ── Realtime — required for live tick / green-chip updates ───────────────────
-- Idempotent: re-running this file (or having already added the table) is safe.
do $$
begin
  alter publication supabase_realtime add table public.entity_note_receipts;
exception when duplicate_object then null;
end $$;

-- The note thread itself must also stream so receipts have notes to attach to.
do $$
begin
  alter publication supabase_realtime add table public.entity_notes;
exception when duplicate_object then null;
end $$;
