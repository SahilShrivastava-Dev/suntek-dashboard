-- ═══════════════════════════════════════════════════════════════════════════
-- 99_verify_user_identity.sql — READ-ONLY sweep over user identity + deletion
-- ═══════════════════════════════════════════════════════════════════════════
-- Asserts migrations 75 and 76 together. Writes nothing, changes nothing — safe
-- against production, and safe to re-run any time an identifier is reused.
--
-- Scan the status column:
--   PASS  — asserted and correct
--   FAIL  — broken, investigate before letting admins delete users
--   EMPTY — nothing of that kind exists yet; NOT a pass
-- ═══════════════════════════════════════════════════════════════════════════
with checks as (

-- ═══ A. THE COLUMNS AND POLICY (migration 75) ══════════════════════════════
select 'A1' as id, 'Soft-delete columns present' as assertion, '3' as expected,
       count(*)::text as actual,
       case when count(*) = 3 then 'PASS' else 'FAIL' end as status
  from information_schema.columns
 where table_name = 'user_accounts'
   and column_name in ('is_deleted','deleted_at','deleted_by')
union all
select 'A2', 'RLS hides deleted rows from the API', 'predicate mentions is_deleted',
       coalesce((select case when qual like '%is_deleted%' then 'predicate mentions is_deleted'
                             else 'WIDE OPEN — deleted users are visible' end
                   from pg_policies
                  where tablename = 'user_accounts' and policyname = 'anon_all'), 'NO POLICY'),
       case when exists (select 1 from pg_policies
                          where tablename='user_accounts' and policyname='anon_all'
                            and qual like '%is_deleted%')
            then 'PASS' else 'FAIL' end
union all
select 'A3', 'Deletion RPCs exist', '2',
       (select count(*)::text from pg_proc
         where proname in ('soft_delete_user','restore_deleted_user')),
       case when (select count(*) from pg_proc
                   where proname in ('soft_delete_user','restore_deleted_user')) = 2
            then 'PASS' else 'FAIL' end

-- ═══ B. IDENTIFIER REUSE (migration 76) ════════════════════════════════════
union all
select 'B1', 'Mobile index ignores deleted rows', 'is_deleted in predicate',
       coalesce((select case when indexdef like '%is_deleted%' then 'is_deleted in predicate'
                             else 'NOT partial — reuse is blocked' end
                   from pg_indexes where indexname = 'user_accounts_mobile_norm_key'), 'MISSING'),
       case when exists (select 1 from pg_indexes
                          where indexname='user_accounts_mobile_norm_key'
                            and indexdef like '%is_deleted%') then 'PASS' else 'FAIL' end
union all
select 'B2', 'Login-email index ignores deleted rows', 'is_deleted in predicate',
       coalesce((select case when indexdef like '%is_deleted%' then 'is_deleted in predicate'
                             else 'NOT partial — reuse is blocked' end
                   from pg_indexes where indexname = 'user_accounts_login_email_key'), 'MISSING'),
       case when exists (select 1 from pg_indexes
                          where indexname='user_accounts_login_email_key'
                            and indexdef like '%is_deleted%') then 'PASS' else 'FAIL' end

-- ═══ C. THE INVARIANTS THAT ACTUALLY MATTER ════════════════════════════════
-- One live account per identifier. If either of these ever fails, two people can
-- log in as each other.
union all
select 'C1', 'No two LIVE accounts share a mobile number', '0',
       coalesce((select count(*)::text from (
          select mobile_norm from user_accounts
           where mobile_norm is not null and not coalesce(is_deleted,false)
           group by mobile_norm having count(*) > 1) d), '0'),
       case when coalesce((select count(*) from (
          select mobile_norm from user_accounts
           where mobile_norm is not null and not coalesce(is_deleted,false)
           group by mobile_norm having count(*) > 1) d), 0) = 0 then 'PASS' else 'FAIL' end
union all
select 'C2', 'No two LIVE accounts share a login email', '0',
       coalesce((select count(*)::text from (
          select lower(login_email) from user_accounts
           where login_email is not null and not coalesce(is_deleted,false)
           group by lower(login_email) having count(*) > 1) d), '0'),
       case when coalesce((select count(*) from (
          select lower(login_email) from user_accounts
           where login_email is not null and not coalesce(is_deleted,false)
           group by lower(login_email) having count(*) > 1) d), 0) = 0 then 'PASS' else 'FAIL' end
union all
-- Shared DISPLAY emails are legitimate (several staff share one mailbox) — this
-- records the fact so nobody "fixes" it later.
select 'C3', 'Shared display emails exist and are allowed (by design)', 'informational',
       coalesce((select count(*)::text from (
          select lower(email) from user_accounts
           where email is not null and not coalesce(is_deleted,false)
           group by lower(email) having count(*) > 1) d), '0') || ' shared address(es)',
       'PASS'
union all
select 'C4', 'Every deleted account is also inactive', '0 still active',
       (select count(*)::text from user_accounts where coalesce(is_deleted,false) and coalesce(is_active,false)),
       case when (select count(*) from user_accounts where coalesce(is_deleted,false)) = 0 then 'EMPTY'
            when (select count(*) from user_accounts
                   where coalesce(is_deleted,false) and coalesce(is_active,false)) = 0
            then 'PASS' else 'FAIL' end
union all
-- The single most useful row here. soft_delete_user() flags the profile; the
-- admin-users edge function ('delete_identity') is what actually destroys the
-- auth identity and clears login_email. A FAIL means that second step did not
-- complete for someone — so they may STILL BE SIGNED IN until their JWT expires,
-- and their email cannot be reused. Fix by re-running Delete on that profile.
select 'C5', 'Deleted accounts have released their login email (auth identity revoked)', '0 retained',
       (select count(*)::text from user_accounts
         where coalesce(is_deleted,false) and login_email is not null),
       case when (select count(*) from user_accounts where coalesce(is_deleted,false)) = 0 then 'EMPTY'
            when (select count(*) from user_accounts
                   where coalesce(is_deleted,false) and login_email is not null) = 0
            then 'PASS' else 'FAIL' end
union all
select 'C6', 'At least one live administrator remains', '>=1',
       (select count(distinct ua.id)::text from user_accounts ua
          left join user_roles ur on ur.user_account_id = ua.id
          left join roles r1 on r1.id = ur.role_id
          left join roles r2 on r2.id = ua.role_id
         where not coalesce(ua.is_deleted,false) and coalesce(ua.is_active,true)
           and (coalesce(r1.is_admin,false) or coalesce(r2.is_admin,false))),
       case when (select count(distinct ua.id) from user_accounts ua
                    left join user_roles ur on ur.user_account_id = ua.id
                    left join roles r1 on r1.id = ur.role_id
                    left join roles r2 on r2.id = ua.role_id
                   where not coalesce(ua.is_deleted,false) and coalesce(ua.is_active,true)
                     and (coalesce(r1.is_admin,false) or coalesce(r2.is_admin,false))) >= 1
            then 'PASS' else 'FAIL' end
)
select id, assertion, expected, actual, status from checks order by id;

-- ── Reused identifiers, for eyeballing ──────────────────────────────────────
-- select mobile_norm, count(*) as rows,
--        count(*) filter (where not is_deleted) as live,
--        string_agg(name || (case when is_deleted then ' [deleted]' else ' [live]' end), ' / ') as accounts
--   from user_accounts where mobile_norm is not null
--  group by mobile_norm having count(*) > 1;
