-- ═══════════════════════════════════════════════════════════════════════════
-- 36_l1_batch_rls.sql — Phase 2b: plant-scope the batch data (L1 shop floor)
-- ═══════════════════════════════════════════════════════════════════════════
-- Now that the Batch Logger runs behind a login (RequireLogin) and stamps the
-- operator's plant on new batches, lock the batch tables so an operator only
-- sees/writes their own plant's batches. active_batches carries plant_id;
-- batch_readings scope via their parent batch.
--
-- PREREQUISITES (or scoped operators will see nothing / can't create):
--   • Batch Logger operators must have a plant assigned (user_plants).
--   • Legacy batches with plant_id = NULL are visible to GLOBAL users only until
--     back-tagged (like the financial tables).
--
-- Requires 28 (plant_in_scope). Reversible via 36_rollback_l1_batch_rls.sql.
-- Run + TEST carefully in the SQL editor. Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- A batch is in scope if its plant is.
create or replace function public.batch_in_scope(p_batch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from active_batches b where b.id = p_batch and public.plant_in_scope(b.plant_id)
  );
$$;
grant execute on function public.batch_in_scope(uuid) to anon, authenticated;

alter table active_batches enable row level security;
drop policy if exists "anon_all"  on active_batches;
drop policy if exists "scope_all" on active_batches;
create policy "scope_all" on active_batches for all
  using      (public.plant_in_scope(plant_id))
  with check (public.plant_in_scope(plant_id));

alter table batch_readings enable row level security;
drop policy if exists "anon_all"  on batch_readings;
drop policy if exists "scope_all" on batch_readings;
create policy "scope_all" on batch_readings for all
  using      (public.batch_in_scope(batch_id))
  with check (public.batch_in_scope(batch_id));

notify pgrst, 'reload schema';
