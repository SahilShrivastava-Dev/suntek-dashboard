-- ═══════════════════════════════════════════════════════════════════════════
-- 30_management_role.sql — seed the "Management" role (L4)
-- ═══════════════════════════════════════════════════════════════════════════
-- A management tier that sits below Owner/Admin (L5) and above Unit Head (L3).
-- It gets FULL dashboard access (every operational section) but NO privileged
-- capabilities — it cannot manage users, roles or permissions, and it does not
-- reach the User Management area at all (that route is admin-only).
--
-- Editable/manageable like any custom role (is_system=false), so the admin can
-- adjust its sections later, or grant it a special allowance (with password).
--
-- Run once in the Supabase SQL editor. Idempotent. Requires 29_tiers_and_capabilities.
-- ═══════════════════════════════════════════════════════════════════════════

insert into roles (
  id, label, level, description, home_route, allowed_routes,
  standalone_only, is_admin, is_system, capabilities, avatar_from, avatar_to, sort_order
) values (
  'management', 'Management', 'L4',
  'Full dashboard access; cannot manage users, roles or permissions',
  '/dashboard',
  array[
    '/dashboard','/dashboard/batches','/dashboard/stock','/dashboard/night-manager',
    '/dashboard/night-entry','/dashboard/batch-entry','/dashboard/daily-log',
    '/dashboard/warehouse-entry','/dashboard/sales','/dashboard/customers',
    '/dashboard/anomalies','/dashboard/anomaly-center','/dashboard/cost-intelligence',
    '/dashboard/benchmarking','/dashboard/predictive-qc','/dashboard/working-capital',
    '/dashboard/oil-ratio','/dashboard/audit','/dashboard/blacklist',
    '/dashboard/purchase/far','/dashboard/purchase/maint','/dashboard/purchase/activity',
    '/dashboard/purchase/storereq','/dashboard/purchase/purchase',
    '/dashboard/purchase/marine','/dashboard/purchase/labour'
  ],
  false, false, false, '{}'::text[], 'from-amber-300', 'to-amber-500', 15
)
on conflict (id) do update set
  label          = excluded.label,
  level          = excluded.level,
  description    = excluded.description,
  home_route     = excluded.home_route,
  allowed_routes = excluded.allowed_routes,
  capabilities   = excluded.capabilities;

notify pgrst, 'reload schema';
