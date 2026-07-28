-- ═══════════════════════════════════════════════════════════════════════════
-- 61_rollback_issue_store_item.sql — undo 61
-- ═══════════════════════════════════════════════════════════════════════════
-- Drops the atomic issue RPC and returns the store tables, tickets and part
-- requests to the plant-scoped policies from 28_rls_phase2a_operational.sql /
-- 37_store_stock.sql.
--
-- ⚠️ After this runs, stock issuing falls back to the client-side
-- read-modify-write in Maintenance.tsx — which is the lost-update bug this
-- migration existed to fix. Revert the frontend to match, and do not leave a
-- shared store running on the old path: with three factories on one register
-- that race is routine, not theoretical.
--
-- maintenance_store_requests.reserved_qty is NOT dropped — a partially issued
-- request may still be holding a claim, and dropping the column would lose
-- that. It defaults to 0 and is simply ignored once the RPC is gone. Drop it
-- by hand if you are certain nothing is mid-flight.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.issue_store_item(jsonb);

-- ── Store tables → plant-scoped, as 37 left them ────────────────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'store_items', 'store_stock_events', 'store_stock_months', 'store_stock_uploads'
  ] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "scope_all" on %I', tbl);
    execute format(
      'create policy "scope_all" on %I for all '
      'using (public.plant_in_scope(plant_id)) with check (public.plant_in_scope(plant_id))', tbl);
  end loop;
end $$;

-- ── Tickets + part requests → as 28 left them ───────────────────────────────
alter table maintenance_tickets enable row level security;
drop policy if exists "scope_all" on maintenance_tickets;
create policy "scope_all" on maintenance_tickets for all
  using      (public.plant_unit_in_scope(plant_id, unit_id))
  with check (public.plant_unit_in_scope(plant_id, unit_id));

alter table maintenance_store_requests enable row level security;
drop policy if exists "scope_all" on maintenance_store_requests;
create policy "scope_all" on maintenance_store_requests for all
  using      (public.ticket_in_scope(ticket_id))
  with check (public.ticket_in_scope(ticket_id));

notify pgrst, 'reload schema';
