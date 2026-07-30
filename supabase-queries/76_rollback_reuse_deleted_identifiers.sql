-- ═══════════════════════════════════════════════════════════════════════════
-- 76_rollback_reuse_deleted_identifiers.sql — identifiers unique across ALL rows
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ REVERTING RE-INTRODUCES THE BUG 76 FIXED: a deleted user's mobile number or
-- login email is blocked again, and creating a replacement fails with "A user
-- with this mobile number already exists".
--
-- ⚠️ IT CAN ALSO FAIL OUTRIGHT, and that is the point of the report below. Once
-- an identifier has been REUSED after a delete, the table holds two rows sharing
-- it — one deleted, one live. The old unindexed-by-deletion constraint cannot be
-- rebuilt over that. The conflicts are listed first; resolve them (usually by
-- clearing the identifier on the DELETED row, which is historical anyway) and
-- re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- What stands in the way, if anything.
select 'mobile shared between a deleted and a live account' as conflict,
       mobile_norm as identifier, string_agg(name || (case when is_deleted then ' [deleted]' else ' [live]' end), ' / ') as accounts
  from user_accounts where mobile_norm is not null
 group by mobile_norm having count(*) > 1
union all
select 'login email shared between a deleted and a live account',
       lower(login_email), string_agg(name || (case when is_deleted then ' [deleted]' else ' [live]' end), ' / ')
  from user_accounts where login_email is not null
 group by lower(login_email) having count(*) > 1;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from (
    select 1 from user_accounts where mobile_norm is not null
     group by mobile_norm having count(*) > 1
    union all
    select 1 from user_accounts where login_email is not null
     group by lower(login_email) having count(*) > 1) d;

  if v_n > 0 then
    raise exception
      '% identifier(s) are shared between a deleted and a live account, so the '
      'original constraints cannot be restored. See the report above. The usual '
      'fix is to clear the identifier on the DELETED row — it is historical and '
      'nothing authenticates against it: '
      'update user_accounts set mobile = null, login_email = null where is_deleted and id = ''…'';', v_n;
  end if;

  drop index if exists user_accounts_deleted_mobile_idx;
  drop index if exists user_accounts_deleted_login_email_idx;

  drop index if exists user_accounts_mobile_norm_key;
  create unique index user_accounts_mobile_norm_key
    on user_accounts (mobile_norm) where mobile_norm is not null;

  drop index if exists user_accounts_login_email_key;
  create unique index user_accounts_login_email_key
    on user_accounts (lower(login_email)) where login_email is not null;

  raise notice 'Restored the original indexes — identifiers are unique across deleted rows again.';
end $$;

notify pgrst, 'reload schema';

-- Verify — both predicates should no longer mention is_deleted:
--   select indexname, indexdef from pg_indexes
--    where tablename = 'user_accounts'
--      and indexname in ('user_accounts_mobile_norm_key','user_accounts_login_email_key');
