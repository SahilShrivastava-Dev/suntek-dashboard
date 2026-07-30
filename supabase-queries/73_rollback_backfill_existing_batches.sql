-- ═══════════════════════════════════════════════════════════════════════════
-- 73_rollback_backfill_existing_batches.sql — un-attribute the backfilled data
-- ═══════════════════════════════════════════════════════════════════════════
-- Undoes only what 73 did: the batches it created (identified by the note it
-- stamped) and the links it wrote. Batches created by real uploads through the
-- app are left completely alone.
--
-- ═══ THIS FILE ALSO DELETES NO REGISTER DATA ════════════════════════════════
-- It clears import_batch_id / created_by_batch_id back to NULL and removes the
-- synthetic manifest rows. Every asset, item and month snapshot survives — they
-- simply become undeletable-through-the-UI again, which is the state they were
-- in before 73 ran.
--
-- ⚠️ If someone has ALREADY DELETED one of these batches through Upload
--    History, that deletion was real and this file cannot bring the rows back.
--    Those batches are `status = 'deleted'` and are reported below rather than
--    silently skipped. Restore from a database backup if you need them; the
--    import_batch_deletions audit row records what went and how many.
-- ═══════════════════════════════════════════════════════════════════════════

-- What has already been acted on and cannot be undone here.
select 'backfilled batches ALREADY DELETED through the UI (not recoverable here)' as warning,
       count(*) as batches,
       coalesce(sum(row_count), 0) as rows_affected
  from import_batches
 where notes like 'Backfilled by migration 73%' and status = 'deleted';

do $$
declare
  v_ids uuid[];
  v_n   bigint;
begin
  if to_regclass('public.import_batches') is null then
    raise notice '70 has not been applied (no import_batches). Nothing to undo.';
    return;
  end if;

  select array_agg(id) into v_ids
    from import_batches where notes like 'Backfilled by migration 73%';

  if v_ids is null or cardinality(v_ids) = 0 then
    raise notice '73 has not been applied (no backfilled batches). Nothing to undo.';
    return;
  end if;

  -- 1. Clear the links FIRST, so the `on delete set null` foreign keys never
  --    fire and nothing is touched that this file did not intend to touch.
  update fixed_assets        set import_batch_id     = null where import_batch_id     = any(v_ids);
  get diagnostics v_n = row_count;
  raise notice 'Un-attributed % asset(s).', v_n;

  update store_items         set created_by_batch_id = null where created_by_batch_id = any(v_ids);
  get diagnostics v_n = row_count;
  raise notice 'Un-attributed % store item(s).', v_n;

  update store_stock_uploads set import_batch_id     = null where import_batch_id     = any(v_ids);

  -- 2. Refuse to remove a batch that still has rows pointing at it.
  if exists (select 1 from fixed_assets        where import_batch_id     = any(v_ids))
     or exists (select 1 from store_items      where created_by_batch_id = any(v_ids))
     or exists (select 1 from store_stock_uploads where import_batch_id  = any(v_ids)) then
    raise exception
      'Rows still point at a backfilled batch after unlinking. Investigate before '
      'removing them — this rollback will not orphan live data.';
  end if;

  -- 3. Remove the synthetic manifests. Deletion audit rows survive:
  --    import_batch_deletions.batch_id is deliberately not a foreign key.
  delete from import_batches where id = any(v_ids);
  get diagnostics v_n = row_count;
  raise notice 'Removed % backfilled batch(es).', v_n;
end $$;

notify pgrst, 'reload schema';

-- Verify — the registers must be intact, only the attribution gone.
select 'batches left'   as item, count(*)::text as value
  from import_batches where notes like 'Backfilled by migration 73%'
union all select 'fixed_assets (unchanged)',  (select count(*)::text from fixed_assets)
union all select 'store_items (unchanged)',   (select count(*)::text from store_items)
union all select 'store_stock_months (unchanged)', (select count(*)::text from store_stock_months);
