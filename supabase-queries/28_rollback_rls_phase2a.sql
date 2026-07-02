-- ═══════════════════════════════════════════════════════════════════════════
-- 28_rollback_rls_phase2a.sql — EMERGENCY REVERT of 28_rls_phase2a_operational
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores the permissive anon_all policy on the 8 operational tables, undoing
-- Phase 2a RLS. Run this in the Supabase SQL editor if scoped access misbehaves
-- and you need the app back to fully-open immediately. The scope helper
-- functions are left in place (harmless when unused). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'maintenance_tickets', 'maintenance_store_requests', 'store_requisitions',
    'maintenance_schedules', 'stock_levels', 'activity_logs',
    'fixed_assets', 'labour_costs'
  ]
  loop
    execute format('drop policy if exists "scope_all" on public.%I', t);
    execute format('drop policy if exists "anon_all"  on public.%I', t);
    execute format('create policy "anon_all" on public.%I for all using (true) with check (true)', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
