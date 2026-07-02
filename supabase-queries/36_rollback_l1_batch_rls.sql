-- ═══════════════════════════════════════════════════════════════════════════
-- 36_rollback_l1_batch_rls.sql — EMERGENCY REVERT of 36_l1_batch_rls.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores open access to active_batches + batch_readings if batch scoping
-- misbehaves (e.g. operators can't create/see batches). Run in the SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['active_batches', 'batch_readings'] loop
    execute format('drop policy if exists "scope_all" on public.%I', t);
    execute format('drop policy if exists "anon_all"  on public.%I', t);
    execute format('create policy "anon_all" on public.%I for all using (true) with check (true)', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
