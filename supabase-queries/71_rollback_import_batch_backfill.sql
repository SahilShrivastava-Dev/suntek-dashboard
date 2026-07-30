-- ═══════════════════════════════════════════════════════════════════════════
-- 71_rollback_import_batch_backfill.sql — un-attribute the historical PM imports
-- ═══════════════════════════════════════════════════════════════════════════
-- Undoes only what 71 did: the batches it CREATED (identifiable by their
-- backfill note) and the links it wrote.
--
-- Batches created by the app after 70 shipped are left completely alone. They
-- describe real uploads with a genuine recorded link, and their rows must keep
-- pointing at them — this file must not turn a live, deletable upload into an
-- unattributed orphan.
--
-- Deletion is safe rather than cascading: the links are cleared FIRST, so the
-- `on delete set null` foreign keys never fire and no row is touched that this
-- file did not intend to touch.
--
-- Run this before 70_rollback_import_batches.sql if you are unwinding both.
-- (Not required — 70's rollback drops the columns and the table anyway — but it
-- leaves the intermediate state clean and inspectable.)
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_ids  uuid[];
  v_n    bigint;
begin
  if to_regclass('public.import_batches') is null then
    raise notice '70 has not been applied (no import_batches). Nothing to undo.';
    return;
  end if;

  -- The batches 71 created, identified by the note it stamped on them.
  select array_agg(id) into v_ids
    from import_batches
   where module = 'pm_schedule'
     and notes like 'Backfilled by migration 71%';

  if v_ids is null or cardinality(v_ids) = 0 then
    raise notice '71 has not been applied (no backfilled batches). Nothing to undo.';
    return;
  end if;

  -- 1. Clear the links before removing their targets.
  update maintenance_schedules set import_batch_id = null where import_batch_id = any(v_ids);
  get diagnostics v_n = row_count;
  raise notice 'Un-attributed % schedule(s).', v_n;

  update pm_schedule_uploads set import_batch_id = null where import_batch_id = any(v_ids);

  -- 2. Refuse to remove a batch that has since been used for something else —
  --    a real upload should never have been given a backfill note, but if it
  --    was, deleting it here would orphan live rows.
  if exists (select 1 from maintenance_schedules where import_batch_id = any(v_ids))
     or exists (select 1 from fixed_assets where import_batch_id = any(v_ids))
     or exists (select 1 from store_stock_uploads where import_batch_id = any(v_ids)) then
    raise exception
      'One or more backfilled batches still have rows pointing at them. '
      'Investigate before removing them — this rollback will not orphan live data.';
  end if;

  -- 3. Remove them. Any deletion audit rows survive: import_batch_deletions
  --    .batch_id is deliberately not a foreign key.
  delete from import_batches where id = any(v_ids);
  get diagnostics v_n = row_count;
  raise notice 'Removed % backfilled batch(es).', v_n;
end $$;

notify pgrst, 'reload schema';

-- Verify (optional):
--   select count(*) from import_batches
--    where module='pm_schedule' and notes like 'Backfilled by migration 71%';   -- 0
--   select count(*) from pm_schedule_uploads where import_batch_id is not null; -- 0
