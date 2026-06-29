-- ─────────────────────────────────────────────────────────────────────────────
-- 20_user_login_provisioning.sql
-- Links the staff directory (user_accounts) to real Supabase auth logins.
--
-- Productionization step: an admin creates a directory row in UserManagement and
-- can optionally provision a real login (email + admin-set password) for it. The
-- actual auth.users + profiles creation happens in the `admin-users` edge
-- function (service_role) — this migration just adds the columns that link a
-- directory row to its auth user, and documents the role contract.
--
-- Used by: UserManagement page, admin-users edge function, RoleContext (lock-to-role)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Link a directory row to its auth user + track whether login is enabled.
alter table user_accounts
  add column if not exists auth_user_id  uuid references auth.users(id) on delete set null,
  add column if not exists login_enabled boolean default false;

create index if not exists user_accounts_auth_user_id_idx on user_accounts (auth_user_id);

-- 2) profiles.role contract.
--    profiles.role stores the ROLE_ID (the MockProfile id: 'admin', 'unit_head',
--    'warehouse_manager', 'accountant_delhi', …) — NOT the L1–L4 level. RoleContext
--    matches this string against MOCK_PROFILES[].id to resolve the user's access.
--    The column already exists (see 02_auth_profiles.sql).
--
--    A stale CHECK constraint on the live DB (profiles_role_check) restricted role
--    to the old L1–L4 levels and rejects role_id values like 'admin'. The level
--    can't identify WHICH role's route-set to grant (many roles are L2), so role_id
--    is the correct key. Drop the legacy constraint. Validation happens in the app:
--    RoleContext fails closed (no access) for any role that isn't a known role_id.
alter table profiles drop constraint if exists profiles_role_check;

-- 3) Admin bootstrap (ONE-TIME, run manually after creating the first owner login).
--    The edge function only lets an admin provision other users, so the very first
--    admin login must be seeded by hand. Create the auth user in the Supabase
--    dashboard (Authentication → Users → Add user, email_confirm = true), then:
--
--    insert into profiles (id, name, role, plant_id)
--    values ('<that-auth-user-uuid>', 'Sagar Nenwani', 'admin', null)
--    on conflict (id) do update set role = 'admin', name = excluded.name;
--
--    After that, the admin can provision everyone else from UserManagement.

-- RLS note: profiles + user_accounts already have permissive anon policies from
-- earlier migrations. Privileged writes (auth user create, password set) go
-- through the service_role edge function, never the anon client.
