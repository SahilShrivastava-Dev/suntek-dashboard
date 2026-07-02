-- ═══════════════════════════════════════════════════════════════════════════
-- 31_user_roles.sql — multi-role assignment (a person can hold several roles)
-- ═══════════════════════════════════════════════════════════════════════════
-- A user's effective access = the UNION of all their roles' routes, the OR of
-- their capabilities, and their most-senior tier. user_accounts.role_id stays as
-- the PRIMARY role (for display + backward compatibility); user_roles holds the
-- full set. Backfilled from the current single role, so nothing changes until an
-- admin assigns additional roles.
--
-- Run once in the Supabase SQL editor. Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists user_roles (
  user_account_id uuid not null references user_accounts(id) on delete cascade,
  role_id         text not null references roles(id) on delete cascade,
  primary key (user_account_id, role_id)
);
create index if not exists user_roles_role_id_idx on user_roles (role_id);

alter table user_roles enable row level security;
drop policy if exists "anon_all" on user_roles;
create policy "anon_all" on user_roles for all using (true) with check (true);

-- Backfill: each user's current single role becomes their first membership.
-- (Only where the role_id actually exists in the roles catalog.)
insert into user_roles (user_account_id, role_id)
select ua.id, ua.role_id
  from user_accounts ua
 where ua.role_id is not null
   and exists (select 1 from roles r where r.id = ua.role_id)
on conflict do nothing;

notify pgrst, 'reload schema';
