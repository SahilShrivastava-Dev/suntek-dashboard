-- ═══════════════════════════════════════════════════════════════════════════
-- 80_rollback_store_grant_is_real.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores the policies exactly as 53, 54, 55, 70 and 72 left them.
--
-- This NARROWS access: anyone who reaches a store only through `user_stores` —
-- a shared-store keeper — goes back to seeing an empty purchase ledger, repair
-- history and upload history. Nothing is deleted. The store_id column added to
-- import_batch_deletions is KEPT (dropping it would lose audit provenance
-- already backfilled); it simply stops being consulted.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- 53: purchase ledger
do $$
declare tbl text;
begin
  foreach tbl in array array['stock_purchase_receipts','stock_purchase_lines'] loop
    execute format('drop policy if exists "scope_read" on %I', tbl);
    execute format('create policy "scope_read" on %I for select using (public.plant_in_scope(plant_id))', tbl);
  end loop;
end $$;

-- 54 + 72: anomaly review trail. The events table returns to plant scope; the
-- anomaly table returns to 72's direct-grant-only store scope.
drop policy if exists "scope_read" on store_stock_anomaly_events;
create policy "scope_read" on store_stock_anomaly_events for select
  using (public.plant_in_scope(plant_id));

drop policy if exists "store_all" on store_stock_anomalies;
create policy "store_all" on store_stock_anomalies for all
  using      (store_id is null or public.store_in_scope(store_id))
  with check (store_id is null or public.store_in_scope(store_id));

-- 55: repair returns
drop policy if exists "scope_read" on repair_return_receipts;
create policy "scope_read" on repair_return_receipts for select
  using (public.plant_in_scope(plant_id));

drop policy if exists "scope_read" on repair_return_allocations;
create policy "scope_read" on repair_return_allocations for select
  using (public.plant_in_scope(plant_id));

-- 70: upload history
drop policy if exists "scope_all" on import_batches;
create policy "scope_all" on import_batches for all
  using      (public.plant_in_scope(plant_id))
  with check (public.plant_in_scope(plant_id));

drop policy if exists "scope_read" on import_batch_deletions;
create policy "scope_read" on import_batch_deletions for select
  using (public.plant_in_scope(plant_id));

drop trigger if exists import_batch_deletions_store_trg on import_batch_deletions;
drop function if exists public.import_batch_deletion_store();

-- Dropped last: the policies above no longer reference it.
drop function if exists public.store_row_in_scope(uuid, uuid);

notify pgrst, 'reload schema';
