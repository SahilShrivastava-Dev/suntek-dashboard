-- ═══════════════════════════════════════════════════════════════════════════
-- 29_tiers_and_capabilities.sql — admin-managed hierarchy levels + role capabilities
-- ═══════════════════════════════════════════════════════════════════════════
-- Two additions to the RBAC model:
--
-- 1) TIERS — the seniority/level ladder becomes DATA the admin can manage
--    (add/rename/reorder), instead of a hardcoded L1–L4. `rank` (gapped 10/20/…)
--    defines seniority so a new level can be inserted between two others without
--    renumbering. `roles.level` already stores the tier id ('L1'…), so this just
--    adds the ladder + a new top tier L5.
--
-- 2) CAPABILITIES — "special allowances": privileged powers granted PER ROLE
--    (e.g. manage_users, manage_roles). Empty by default; the admin unlocks &
--    grants them in the Role editor behind a password step-up. This lets an admin
--    delegate, e.g., "a unit head who can create users" without full admin.
--
-- Backward-compatible: roles.level is unchanged in meaning; single-role users
-- unaffected. Run once in the Supabase SQL editor. Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tiers ────────────────────────────────────────────────────────────────
create table if not exists tiers (
  id          text primary key,       -- 'L1'…'L5' (and any future admin-made level)
  label       text not null,          -- display name; admin can rename
  rank        int  not null,          -- gapped (10,20,…); higher = more senior
  description text,
  created_at  timestamptz default now()
);

insert into tiers (id, label, rank, description) values
  ('L1', 'L1', 10, 'Operators / shop-floor entry'),
  ('L2', 'L2', 20, 'Supervisors / specialists'),
  ('L3', 'L3', 30, 'Unit heads'),
  ('L4', 'L4', 40, 'Management'),
  ('L5', 'L5', 50, 'Owner / Admin')
on conflict (id) do nothing;

alter table tiers enable row level security;
drop policy if exists "anon_all" on tiers;
create policy "anon_all" on tiers for all using (true) with check (true);

-- ── 2. Capabilities granted to a role (the "special allowances") ────────────
alter table roles
  add column if not exists capabilities text[] not null default '{}';

-- ── 3. Re-tier the Owner/Admin to the new top level (L5) + grant it the ─────
--       privileged capabilities. is_admin already implies full access; this
--       makes the capability model explicit and gives L4 free as "Management".
update roles
   set level = 'L5',
       capabilities = array['manage_users', 'manage_roles']
 where id = 'admin';

-- Reload PostgREST's schema cache so the API sees tiers + roles.capabilities.
notify pgrst, 'reload schema';
