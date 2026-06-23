-- ─────────────────────────────────────────────────────────────────────────────
-- 11_activity_logs_rls.sql — fix "new row violates row-level security policy"
--
-- The Activity Log save fails because `activity_logs` has RLS enabled but no
-- policy that lets the app's anon key insert. This adds the same permissive
-- policy the rest of this internal app uses (see notifications / mentions).
--
-- If you hit the SAME error on another table (store_requisitions, marine_insurance,
-- labour_costs, blacklist, …) re-run this with the table name swapped in.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.activity_logs enable row level security;

drop policy if exists anon_all on public.activity_logs;
create policy anon_all on public.activity_logs
  for all using (true) with check (true);
