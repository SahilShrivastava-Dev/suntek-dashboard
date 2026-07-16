-- ═══════════════════════════════════════════════════════════════════════════
-- 50_todo_route_grant.sql — grant the personal To-Do page to every role
-- ═══════════════════════════════════════════════════════════════════════════
-- The To-Do / Personal Work Queue (/dashboard/todo) is available to EVERY profile
-- — each user sees their own role-relevant pending work. Access is gated by the
-- exact-match profileCanAccess(), so the route must appear in each role's
-- allowed_routes. Admin already holds '*' (all routes) and is skipped.
--
-- The page itself is a live, READ-ONLY aggregation over existing tables
-- (maintenance_tickets, store_requisitions, night_duty, anomaly_flags,
-- notifications) — it adds NO new tables and writes nothing.
--
-- Run once in the Supabase SQL Editor. Idempotent (safe to re-run).
-- ═══════════════════════════════════════════════════════════════════════════

update roles
   set allowed_routes = array_append(allowed_routes, '/dashboard/todo')
 where not ('*' = any(allowed_routes))              -- admin already sees everything
   and not ('/dashboard/todo' = any(allowed_routes)); -- don't add twice

-- Verify (optional):
--   select id, allowed_routes from roles order by sort_order;
