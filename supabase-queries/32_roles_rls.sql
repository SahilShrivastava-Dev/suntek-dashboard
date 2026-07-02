-- ═══════════════════════════════════════════════════════════════════════════
-- 32_roles_rls.sql — lock role/level editing to `manage_roles` holders (RLS)
-- ═══════════════════════════════════════════════════════════════════════════
-- Makes "only Admin (or a granted role) can change roles, levels & permissions"
-- REAL at the database, not just a hidden button. Everyone can still READ the
-- roles/tiers catalog (the app needs it for display); only holders of the
-- `manage_roles` capability can write. service_role (edge fns) bypasses RLS.
--
-- Requires 29 (roles.capabilities) + 31 (user_roles). Reversible via
-- 32_rollback_roles_rls.sql. Run once in the SQL editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- Resolve the current auth user's capabilities across ALL their roles (multi-role
-- via user_roles, plus the primary user_accounts.role_id, plus the bootstrap
-- owner via profiles). SECURITY DEFINER so it reads regardless of RLS.
create or replace function public.has_capability(p_cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (
      select 1
        from user_accounts ua
        join user_roles ur on ur.user_account_id = ua.id
        join roles r on r.id = ur.role_id
       where ua.auth_user_id = auth.uid()
         and (r.is_admin or p_cap = any(r.capabilities))
    )
    or exists (
      select 1
        from user_accounts ua
        join roles r on r.id = ua.role_id
       where ua.auth_user_id = auth.uid()
         and (r.is_admin or p_cap = any(r.capabilities))
    );
$$;
grant execute on function public.has_capability(text) to anon, authenticated;

-- ── roles: read open, write requires manage_roles ──────────────────────────
alter table roles enable row level security;
drop policy if exists "anon_all"      on roles;
drop policy if exists "roles_read"    on roles;
drop policy if exists "roles_write"   on roles;
drop policy if exists "roles_update"  on roles;
drop policy if exists "roles_delete"  on roles;
create policy "roles_read"   on roles for select using (true);
create policy "roles_write"  on roles for insert with check (public.has_capability('manage_roles'));
create policy "roles_update" on roles for update using (public.has_capability('manage_roles')) with check (public.has_capability('manage_roles'));
create policy "roles_delete" on roles for delete using (public.has_capability('manage_roles'));

-- ── tiers: same rule (managing levels is a manage_roles power) ──────────────
alter table tiers enable row level security;
drop policy if exists "anon_all"      on tiers;
drop policy if exists "tiers_read"    on tiers;
drop policy if exists "tiers_write"   on tiers;
drop policy if exists "tiers_update"  on tiers;
drop policy if exists "tiers_delete"  on tiers;
create policy "tiers_read"   on tiers for select using (true);
create policy "tiers_write"  on tiers for insert with check (public.has_capability('manage_roles'));
create policy "tiers_update" on tiers for update using (public.has_capability('manage_roles')) with check (public.has_capability('manage_roles'));
create policy "tiers_delete" on tiers for delete using (public.has_capability('manage_roles'));

notify pgrst, 'reload schema';
