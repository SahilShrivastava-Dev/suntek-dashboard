-- ─────────────────────────────────────────────────────────────────────────────
-- 19_plants_public_read.sql
-- Run in the Supabase SQL editor.
--
-- The `plants` table has RLS enabled but NO select policy for the anon role, so
-- the app (which uses the anon key) reads 0 rows — the `plants(name)` join in
-- every Purchase tab silently returns null and plant columns show "—".
-- Every other table the app reads is already anon-readable; this brings plants
-- in line. Plant names + geofence coords are not sensitive.
-- ─────────────────────────────────────────────────────────────────────────────

alter table plants enable row level security;  -- no-op if already enabled

drop policy if exists "anon read plants" on plants;
create policy "anon read plants"
  on plants for select
  to anon, authenticated
  using (true);

-- Verify: this should now return the 9 rows when run, and the app will too.
-- select name from plants;
