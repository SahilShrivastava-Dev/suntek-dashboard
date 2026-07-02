-- ═══════════════════════════════════════════════════════════════════════════
-- 32_rollback_roles_rls.sql — EMERGENCY REVERT of 32_roles_rls.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores fully-open access to roles + tiers if the manage_roles lock misbehaves
-- (e.g. an admin can't edit roles). The has_capability() function is left in
-- place (harmless when unused). Run in the SQL editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['roles', 'tiers'] loop
    execute format('drop policy if exists "%s_read"   on public.%I', t, t);
    execute format('drop policy if exists "%s_write"  on public.%I', t, t);
    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete" on public.%I', t, t);
    execute format('drop policy if exists "anon_all"  on public.%I', t);
    execute format('create policy "anon_all" on public.%I for all using (true) with check (true)', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
