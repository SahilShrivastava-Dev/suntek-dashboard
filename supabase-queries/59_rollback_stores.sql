-- ═══════════════════════════════════════════════════════════════════════════
-- 59_rollback_stores.sql — undo 59_stores.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 59 is additive and behaviour-neutral: it adds three tables, a set of
-- nullable store_id columns, reserved_qty, and three scope functions. Because
-- `plant_id` was retained on every table it touched, dropping the store
-- columns returns the schema to exactly where it was.
--
-- ⚠️ Do NOT run this after 60_rehla_common_store.sql without rolling 60 back
-- first. 60 deletes the duplicate half of the Rehla register and makes store_id
-- the authoritative key; dropping store_id at that point would leave one merged
-- register with an ambiguous plant_id and no way to tell which factory's rows
-- were removed. The guard below refuses to run in that state.
--
-- ⚠️ Also roll back 61 first if it has been applied — its RLS policies and the
-- issue RPC both reference store_in_scope() and store_id.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.store_items_pre60_backup') is not null then
    raise exception
      '60_rehla_common_store.sql appears to have run (store_items_pre60_backup exists). '
      'Run 60_rollback_rehla_common_store.sql FIRST.';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and qual like '%store_in_scope%')
  then
    raise exception
      '61 RLS policies still reference store_in_scope(). '
      'Run 61_rollback_issue_store_item.sql FIRST.';
  end if;
end $$;

drop function if exists public.store_in_plant_scope(uuid);
drop function if exists public.store_in_scope(uuid);
drop function if exists public.my_store_ids();

alter table store_items drop constraint if exists store_items_reserved_sane;

drop index if exists store_items_store_idx;
drop index if exists store_items_store_name_idx;
drop index if exists store_stock_events_store_idx;
drop index if exists store_stock_events_req_plant_idx;
drop index if exists store_stock_months_store_idx;
drop index if exists msr_source_store_idx;

alter table store_items              drop column if exists store_id,
                                     drop column if exists reserved_qty;
alter table store_stock_events       drop column if exists store_id,
                                     drop column if exists requesting_plant_id;
alter table maintenance_store_requests drop column if exists source_store_id;
alter table store_stock_uploads      drop column if exists store_id;
alter table store_stock_months       drop column if exists store_id;
alter table stock_purchase_receipts  drop column if exists store_id;
alter table stock_purchase_lines     drop column if exists store_id;
alter table repair_return_receipts   drop column if exists store_id;

drop table if exists user_stores;
drop table if exists factory_store_access;
drop table if exists stores;

notify pgrst, 'reload schema';
