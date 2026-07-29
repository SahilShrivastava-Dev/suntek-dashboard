-- ═══════════════════════════════════════════════════════════════════════════
-- 66_retire_unit_store_manager_roles.sql — one store manager, not three
-- ═══════════════════════════════════════════════════════════════════════════
-- `store_manager_chlorides` and `store_manager_plasticiser` existed because
-- Rehla used to be ONE plant with Chlorides and Plasticiser as units inside it,
-- so a part request had to reach the right unit's keeper.
--
-- That distinction no longer exists:
--   • SCPL – Rehla IS chlorides, SPPL – Rehla IS plasticiser — the FACTORY
--     carries the meaning the unit used to
--   • all three Rehla factories draw on ONE register (Rehla Common Store), so
--     there is only ever one store keeper to notify
--   • the unit selector is gone, so `maintenance_tickets.unit` is null on
--     everything new — the routing branch that used these roles is already
--     unreachable
--
-- The routing also depended on substring-matching a plant NAME for
-- "chlorid"/"plastic", which is precisely the name-as-logic this restructure
-- set out to remove.
--
-- `store_manager_maint` remains as THE store-manager role. Assign it plus a
-- factory and the right register follows automatically.
--
-- SAFE TO RUN: both roles are seeded with is_system = false and, at the time of
-- writing, hold ZERO users. This migration REFUSES to run if anyone has since
-- been assigned one, rather than silently stripping somebody's access.
--
-- Historical `maintenance_tickets.unit` / `unit_id` values are deliberately NOT
-- cleared — old tickets legitimately record which unit they were routed to and
-- rewriting that would falsify the audit trail.
--
-- Requires 25 (roles seed). Idempotent.
-- Reversible via 66_rollback_unit_store_manager_roles.sql.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_ids  constant text[] := array['store_manager_chlorides', 'store_manager_plasticiser'];
  v_held bigint;
  v_acct bigint;
begin
  if not exists (select 1 from roles where id = any(v_ids)) then
    raise notice 'Unit store-manager roles already retired — nothing to do.';
    return;
  end if;

  -- Refuse rather than revoke: if somebody now holds one of these, an admin
  -- must move them to store_manager_maint first.
  select count(*) into v_held from user_roles    where role_id = any(v_ids);
  select count(*) into v_acct from user_accounts where role_id = any(v_ids);

  if v_held > 0 or v_acct > 0 then
    raise exception
      'Cannot retire the unit store-manager roles: % user_roles row(s) and % user_account(s) still hold them. '
      'Reassign those users to store_manager_maint, then re-run.', v_held, v_acct;
  end if;

  -- Keep a copy so the rollback can restore them exactly.
  create table if not exists roles_pre66_backup as
    select *, now() as snapshot_at from roles where false;
  insert into roles_pre66_backup select r.*, now() from roles r where r.id = any(v_ids);

  delete from roles where id = any(v_ids);
  raise notice 'Retired % unit store-manager role(s).', array_length(v_ids, 1);
end $$;

-- ── Capability grants that named the retired roles ──────────────────────────
-- 53 / 54 / 55 granted their stock capabilities to the unit-flavoured store
-- managers as well. Strip the dead ids so the grant lists reflect reality.
-- Uses the roles table itself as the source of truth: a capability may only be
-- held by a role that exists.
do $$
declare v_n bigint;
begin
  if to_regclass('public.role_capabilities') is not null then
    execute 'delete from role_capabilities where role_id not in (select id from roles)';
    get diagnostics v_n = row_count;
    raise notice 'Removed % orphaned capability grant(s).', v_n;
  else
    -- Capabilities live on roles.capabilities (text[]); deleting the role rows
    -- above already removed their grants. Nothing further to clean.
    raise notice 'Capabilities are stored on roles.capabilities — removed with the role rows.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   One store-manager role remains:
--     select id, label, level from roles where id like 'store_manager%';
--
--   Nobody lost access (expect zero):
--     select count(*) from user_roles
--      where role_id not in (select id from roles);
--
--   Historical tickets keep their unit for the audit trail (informational):
--     select unit, count(*) from maintenance_tickets
--      where unit is not null group by unit;
