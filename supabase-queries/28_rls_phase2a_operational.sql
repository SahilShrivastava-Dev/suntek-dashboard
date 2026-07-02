-- ═══════════════════════════════════════════════════════════════════════════
-- 28_rls_phase2a_operational.sql — Phase 2a: DB-level plant/unit isolation (RLS)
-- ═══════════════════════════════════════════════════════════════════════════
-- Turns the Phase 1 app-layer scoping into a REAL security boundary: the
-- database itself refuses rows outside a user's plant/unit scope, so it can't be
-- bypassed via the API. Keyed to auth.uid() — so it applies to the logged-in
-- DASHBOARD staff (unit head, technician, store manager, warehouse, etc.).
--
-- SCOPE OF THIS FILE (2a): the 8 operational tables accessed ONLY by logged-in
-- staff. NOT included here (by design):
--   • notifications + the L1 shop-floor tables (active_batches, batch_readings,
--     shift_logs, operator_sessions, …) → those apps run anon today; RLS on them
--     is Phase 2b, AFTER the L1 terminals get a login.
--   • sales_contracts / customers / oil_contracts / marine_insurance → Phase 2c,
--     after existing rows are back-tagged with a plant.
--   • Reference/catalog + directory tables (plants, units, roles, user_accounts,
--     user_plants, user_units, profiles, …) stay readable — needed for scope
--     resolution + the @-mention directory.
--
-- SAFETY: service_role (edge functions) BYPASSES RLS, so admin provisioning is
-- unaffected. To revert instantly, run 28_rollback_rls_phase2a.sql.
-- Apply in the Supabase SQL editor. Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Scope helper functions (SECURITY DEFINER so they read the user's own ──
--       membership rows regardless of RLS; STABLE so Postgres caches them). ──

-- Does the current auth user see every plant? (Owner/Admin, or is_global flag.)
create or replace function public.is_global_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_accounts ua
     where ua.auth_user_id = auth.uid()
       and (ua.is_global is true or ua.role_id = 'admin')
  ) or exists (
    -- bootstrap owner: a profiles row with role 'admin' and no user_accounts row
    select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- The plant ids the current user belongs to.
create or replace function public.my_plant_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select up.plant_id
    from user_plants up
    join user_accounts ua on ua.id = up.user_account_id
   where ua.auth_user_id = auth.uid();
$$;

-- The unit ids the current user is RESTRICTED to (empty = all units of plants).
create or replace function public.my_unit_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select uu.unit_id
    from user_units uu
    join user_accounts ua on ua.id = uu.user_account_id
   where ua.auth_user_id = auth.uid();
$$;

-- Does the current user have ANY unit restriction? (false = sees all units.)
create or replace function public.has_unit_restriction()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_units uu
     join user_accounts ua on ua.id = uu.user_account_id
    where ua.auth_user_id = auth.uid()
  );
$$;

-- Row predicate: a plant-only row is in scope.
create or replace function public.plant_in_scope(p_plant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_global_user()
      or (p_plant is not null and p_plant in (select public.my_plant_ids()));
$$;

-- Row predicate: a plant+unit row is in scope. A unit-less (plant-level) row is
-- visible to anyone in the plant; a unit-tagged row needs the user's unit (unless
-- the user has no unit restriction).
create or replace function public.plant_unit_in_scope(p_plant uuid, p_unit uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_global_user()
      or (
        p_plant is not null and p_plant in (select public.my_plant_ids())
        and (
          p_unit is null
          or not public.has_unit_restriction()
          or p_unit in (select public.my_unit_ids())
        )
      );
$$;

-- Row predicate for children of a maintenance ticket (no own plant/unit column).
create or replace function public.ticket_in_scope(p_ticket uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from maintenance_tickets t
     where t.id = p_ticket
       and public.plant_unit_in_scope(t.plant_id, t.unit_id)
  );
$$;

grant execute on function
  public.is_global_user(), public.my_plant_ids(), public.my_unit_ids(),
  public.has_unit_restriction(), public.plant_in_scope(uuid),
  public.plant_unit_in_scope(uuid, uuid), public.ticket_in_scope(uuid)
  to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Policies. `for all` → USING gates SELECT/UPDATE/DELETE, WITH CHECK gates
--    INSERT/UPDATE — so a user can neither read nor write another plant's rows,
--    and can't move a row out of their scope. anon (no login) matches nothing.
--
--    Apply in two groups so you can verify incrementally.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── GROUP 1: the maintenance → store requisition chain (headline flow) ──────

alter table maintenance_tickets enable row level security;
drop policy if exists "anon_all"  on maintenance_tickets;
drop policy if exists "scope_all" on maintenance_tickets;
create policy "scope_all" on maintenance_tickets for all
  using      (public.plant_unit_in_scope(plant_id, unit_id))
  with check (public.plant_unit_in_scope(plant_id, unit_id));

alter table maintenance_store_requests enable row level security;
drop policy if exists "anon_all"  on maintenance_store_requests;
drop policy if exists "scope_all" on maintenance_store_requests;
create policy "scope_all" on maintenance_store_requests for all
  using      (public.ticket_in_scope(ticket_id))
  with check (public.ticket_in_scope(ticket_id));

alter table store_requisitions enable row level security;
drop policy if exists "anon_all"  on store_requisitions;
drop policy if exists "scope_all" on store_requisitions;
create policy "scope_all" on store_requisitions for all
  using      (public.plant_unit_in_scope(plant_id, unit_id))
  with check (public.plant_unit_in_scope(plant_id, unit_id));

-- ── GROUP 2: the remaining plant-scoped operational tables (plant-only) ─────

alter table maintenance_schedules enable row level security;
drop policy if exists "anon_all"  on maintenance_schedules;
drop policy if exists "scope_all" on maintenance_schedules;
create policy "scope_all" on maintenance_schedules for all
  using      (public.plant_in_scope(plant_id))
  with check (public.plant_in_scope(plant_id));

alter table stock_levels enable row level security;
drop policy if exists "anon_all"  on stock_levels;
drop policy if exists "scope_all" on stock_levels;
create policy "scope_all" on stock_levels for all
  using      (public.plant_in_scope(plant_id))
  with check (public.plant_in_scope(plant_id));

alter table activity_logs enable row level security;
drop policy if exists "anon_all"  on activity_logs;
drop policy if exists "scope_all" on activity_logs;
create policy "scope_all" on activity_logs for all
  using      (public.plant_in_scope(plant_id))
  with check (public.plant_in_scope(plant_id));

alter table fixed_assets enable row level security;
drop policy if exists "anon_all"  on fixed_assets;
drop policy if exists "scope_all" on fixed_assets;
create policy "scope_all" on fixed_assets for all
  using      (public.plant_in_scope(plant_id))
  with check (public.plant_in_scope(plant_id));

alter table labour_costs enable row level security;
drop policy if exists "anon_all"  on labour_costs;
drop policy if exists "scope_all" on labour_costs;
create policy "scope_all" on labour_costs for all
  using      (public.plant_in_scope(plant_id))
  with check (public.plant_in_scope(plant_id));

-- ── Reload PostgREST's schema cache so the API picks up the policy changes ──
notify pgrst, 'reload schema';

-- ── Diagnostics (run as needed) ─────────────────────────────────────────────
--   Confirm which tables are now scoped vs still permissive:
--     select tablename, policyname, cmd from pg_policies
--     where schemaname='public' order by tablename;
