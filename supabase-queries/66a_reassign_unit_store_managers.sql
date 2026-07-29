-- ═══════════════════════════════════════════════════════════════════════════
-- 66a_reassign_unit_store_managers.sql — move real users off the retired roles
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this ONLY if 66 refused with:
--   "Cannot retire the unit store-manager roles: N user_roles row(s) and
--    M user_account(s) still hold them."
--
-- That refusal is the guard working: somebody genuinely holds
-- store_manager_chlorides or store_manager_plasticiser, and a migration must
-- not quietly strip a person's access. This file makes the move explicit.
--
-- WHAT IT DOES
--   Every holder of either retired role becomes a `store_manager_maint`.
--   Nobody loses access — store_manager_maint has the same routes
--   (/dashboard/purchase/maint + /storereq) and the same tier (L3). What they
--   lose is the unit FLAVOUR, which no longer means anything: which register a
--   store manager serves is now decided by the ticket's FACTORY, and all three
--   Rehla factories share one store.
--
--   • user_roles  — insert the replacement, then drop the old row. Its primary
--     key is (user_account_id, role_id), so a straight UPDATE would collide for
--     anyone who already holds store_manager_maint.
--   • user_accounts.role_id — the primary/display role, repointed in place.
--
-- WHO IT TOUCHED is printed as a NOTICE and kept in a backup table, so the
-- change is auditable and reversible.
--
-- REVIEW FIRST. Run the diagnostic at the bottom, confirm the names are who you
-- expect, then run this, then re-run 66.
--
-- Idempotent. Reversible via 66a_rollback_reassign_unit_store_managers.sql.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists user_role_pre66a_backup (
  user_account_id uuid not null,
  user_name       text,
  old_role_id     text not null,
  source          text not null,          -- 'user_roles' | 'user_accounts.role_id'
  snapshot_at     timestamptz default now(),
  primary key (user_account_id, old_role_id, source)
);

do $$
declare
  v_old  constant text[] := array['store_manager_chlorides', 'store_manager_plasticiser'];
  v_new  constant text   := 'store_manager_maint';
  v_row  record;
  v_a    bigint := 0;
  v_b    bigint := 0;
begin
  if not exists (select 1 from roles where id = v_new) then
    raise exception 'Target role % does not exist — cannot reassign.', v_new;
  end if;

  -- ── Report exactly who is being moved, by name ────────────────────────────
  for v_row in
    select distinct ua.id, ua.name, ua.role_id as primary_role
      from user_accounts ua
      left join user_roles ur on ur.user_account_id = ua.id
     where ua.role_id = any(v_old) or ur.role_id = any(v_old)
  loop
    raise notice 'Reassigning % (primary role: %) → %', v_row.name, v_row.primary_role, v_new;
  end loop;

  -- ── Snapshot before touching anything ─────────────────────────────────────
  insert into user_role_pre66a_backup (user_account_id, user_name, old_role_id, source)
    select ur.user_account_id, ua.name, ur.role_id, 'user_roles'
      from user_roles ur join user_accounts ua on ua.id = ur.user_account_id
     where ur.role_id = any(v_old)
  on conflict do nothing;

  insert into user_role_pre66a_backup (user_account_id, user_name, old_role_id, source)
    select ua.id, ua.name, ua.role_id, 'user_accounts.role_id'
      from user_accounts ua
     where ua.role_id = any(v_old)
  on conflict do nothing;

  -- Record who ALREADY held the target role. Without this the rollback cannot
  -- tell "store_manager_maint was added by 66a" from "they had it all along",
  -- and would strip a role the person legitimately owned. Vijay Kumar Niral is
  -- exactly this case: he holds all three today.
  insert into user_role_pre66a_backup (user_account_id, user_name, old_role_id, source)
    select ur.user_account_id, ua.name, v_new, 'pre_existing_target'
      from user_roles ur join user_accounts ua on ua.id = ur.user_account_id
     where ur.role_id = v_new
       and ur.user_account_id in (select user_account_id from user_roles where role_id = any(v_old))
  on conflict do nothing;

  -- ── user_roles: insert the replacement, then drop the retired rows ────────
  insert into user_roles (user_account_id, role_id)
    select distinct ur.user_account_id, v_new from user_roles ur where ur.role_id = any(v_old)
  on conflict do nothing;

  delete from user_roles where role_id = any(v_old);
  get diagnostics v_a = row_count;

  -- ── user_accounts: the primary/display role ───────────────────────────────
  update user_accounts
     set role_id    = v_new,
         role_label = coalesce((select label from roles where id = v_new), role_label),
         updated_at = now()
   where role_id = any(v_old);
  get diagnostics v_b = row_count;

  raise notice 'Moved % user_roles row(s) and % primary role(s) to %.', v_a, v_b, v_new;
  raise notice 'Now re-run 66_retire_unit_store_manager_roles.sql.';
end $$;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   BEFORE running — who holds a retired role:
--     select ua.id, ua.name, ua.mobile, ua.role_id as primary_role,
--            array_agg(ur.role_id) filter (where ur.role_id is not null) as all_roles
--       from user_accounts ua
--       left join user_roles ur on ur.user_account_id = ua.id
--      where ua.role_id in ('store_manager_chlorides','store_manager_plasticiser')
--         or ur.role_id in ('store_manager_chlorides','store_manager_plasticiser')
--      group by ua.id, ua.name, ua.mobile, ua.role_id;
--
--   AFTER — nobody holds one (expect zero), and everyone kept a role:
--     select count(*) from user_roles
--      where role_id in ('store_manager_chlorides','store_manager_plasticiser');
--     select ua.name, ua.role_id from user_role_pre66a_backup b
--       join user_accounts ua on ua.id = b.user_account_id;
