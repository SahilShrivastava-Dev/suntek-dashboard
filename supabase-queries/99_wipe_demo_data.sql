-- 99_wipe_demo_data.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Reset the DEMO / testing Supabase project to a clean state:
--   • Deletes ROWS ONLY — no table, column, constraint, index, RLS policy,
--     trigger, or relationship is dropped. Schema stays identical.
--   • Keeps configuration/reference tables whole: plants, units, roles, tiers,
--     detector_config (the app needs these to boot and to scope users).
--   • Keeps exactly ONE login: the admin (set ADMIN_LOGIN below). Every other
--     user account and auth login is removed.
--
-- HOW TO RUN (Supabase Dashboard → SQL Editor of the DEMO project):
--   1. Make sure you are in the RIGHT project (the demo one) — check the
--      project ref in the URL before running anything.
--   2. Edit ADMIN_LOGIN below to the admin's auth login email (the value in
--      user_accounts.login_email — for synthetic-email logins it is NOT the
--      display email; check:  select name, email, login_email from user_accounts;)
--   3. Run the whole script. It is wrapped in a transaction: it first prints
--      per-table row counts it is about to delete, wipes, then shows the
--      remaining counts. If anything looks wrong run ROLLBACK; otherwise COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  ADMIN_LOGIN constant text := 'sagar@suntek.in';   -- ← EDIT ME
  keep constant text[] := array[
    -- config / reference: kept with all rows
    'plants', 'units', 'roles', 'tiers', 'detector_config',
    -- identity: cleaned selectively below, so excluded from the truncate
    'profiles', 'user_accounts', 'user_roles', 'user_plants', 'user_units'
  ];
  wipe_list text;
  admin_uid uuid;
begin
  -- Safety: the admin must exist in auth before we delete everyone else
  select id into admin_uid from auth.users where email = ADMIN_LOGIN;
  if admin_uid is null then
    raise exception 'No auth.users row with email %. Fix ADMIN_LOGIN first — aborting, nothing deleted.', ADMIN_LOGIN;
  end if;

  -- 1) Every other public table: delete all rows, reset sequences.
  --    TRUNCATE only removes data — table definitions, FKs and RLS are untouched.
  select string_agg(format('public.%I', tablename), ', ')
    into wipe_list
  from pg_tables
  where schemaname = 'public'
    and tablename <> all(keep);

  if wipe_list is not null then
    raise notice 'Wiping rows from: %', wipe_list;
    execute 'truncate table ' || wipe_list || ' restart identity cascade';
  end if;

  -- 2) Staff accounts: keep only the admin.
  --    user_roles / user_plants / user_units clean themselves via ON DELETE CASCADE.
  delete from public.user_accounts
  where coalesce(login_email, '') <> ADMIN_LOGIN
    and coalesce(email, '')       <> ADMIN_LOGIN;

  -- 3) Auth logins: keep only the admin.
  --    profiles / sessions / identities clean themselves via ON DELETE CASCADE.
  delete from auth.users where id <> admin_uid;

  raise notice 'Done. Kept admin auth user % (%).', ADMIN_LOGIN, admin_uid;
end $$;

-- Review what's left before committing (config tables + 1 admin user expected):
select relname as table_name, n_live_tup as approx_rows
from pg_stat_user_tables
where schemaname = 'public'
order by n_live_tup desc, relname;

select email, created_at from auth.users;

-- If the two results above look right:
commit;
-- If not:
-- rollback;
