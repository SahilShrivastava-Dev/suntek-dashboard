-- ═══════════════════════════════════════════════════════════════════════════
-- 60_rollback_rehla_common_store.sql — undo the Rehla store merge
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores, in dependency order:
--   1. the collapsed duplicate store_items rows (re-inserted before anything
--      points at them again, so foreign keys resolve)
--   2. every child pointer this migration moved, from its logged old value
--   3. deleted duplicate uploads and monthly snapshots
--   4. store_id / plant_id / quantity columns on every touched table
--   5. factory_store_access and user_stores
--   6. the original unique constraints
--   7. deactivates 'Rehla Common Store'
--
-- Everything is driven from the *_pre60_backup tables that 60 wrote. If they
-- are missing, 60 never ran and there is nothing to undo.
--
-- Rows CREATED after 60 ran (new items, new events) are left alone — they are
-- not in the snapshot and this rollback never deletes what it did not create.
-- Their store_id will still point at the common store; re-point those by hand
-- if you are reverting a system that has been live for a while.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_common uuid;
  v_fk     record;
  v_n      bigint;
begin
  if to_regclass('public.store_items_pre60_backup') is null then
    raise exception 'store_items_pre60_backup is missing — 60 has not been run.';
  end if;

  select id into v_common from stores where code = 'REHLA_COMMON';

  -- ── 1. Bring the collapsed rows back ──────────────────────────────────────
  -- Re-inserted first so the child pointers restored in step 2 have a target.
  insert into store_items
        (id, plant_id, store_id, item_name, unit, equipment, model,
         baseline_qty, baseline_month, procured_qty, issued_qty, manual_delta,
         on_hand, reserved_qty, ticket_procured_qty, repaired_qty,
         updated_at, created_at)
  select b.id, b.plant_id, b.store_id, b.item_name, b.unit, b.equipment, b.model,
         b.baseline_qty, b.baseline_month, b.procured_qty, b.issued_qty, b.manual_delta,
         b.on_hand, b.reserved_qty, b.ticket_procured_qty, b.repaired_qty,
         b.updated_at, b.created_at
    from store_items_pre60_backup b
   where not exists (select 1 from store_items si where si.id = b.id)
  on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'Restored % collapsed register row(s).', v_n;

  -- ── 2. Reverse the child repoints ─────────────────────────────────────────
  if to_regclass('public.store_item_repoint_pre60_backup') is not null then
    for v_fk in
      select distinct child_table, child_column from store_item_repoint_pre60_backup
    loop
      execute format(
        'update %s c set %I = r.old_value
           from store_item_repoint_pre60_backup r
          where r.child_table = %L and r.child_column = %L and c.id = r.child_id',
        v_fk.child_table, v_fk.child_column, v_fk.child_table, v_fk.child_column);
      get diagnostics v_n = row_count;
      if v_n > 0 then
        raise notice '  restored % pointer(s) in %.%', v_n, v_fk.child_table, v_fk.child_column;
      end if;
    end loop;
  end if;

  -- ── 3. Re-insert deleted uploads and monthly snapshots ────────────────────
  insert into store_stock_uploads
        (id, plant_id, store_id, period_month, file_name, file_url, uploaded_by,
         uploaded_by_name, row_count, sheet_count, notes, created_at)
  select b.id, b.plant_id, b.store_id, b.period_month, b.file_name, b.file_url, b.uploaded_by,
         b.uploaded_by_name, b.row_count, b.sheet_count, b.notes, b.created_at
    from store_stock_uploads_pre60_backup b
   where not exists (select 1 from store_stock_uploads u where u.id = b.id)
  on conflict (id) do nothing;

  insert into store_stock_months
        (id, upload_id, plant_id, store_id, period_month, item_name, unit,
         opening, purchase_opening, purchased, used, computed_closing, created_at)
  select b.id, b.upload_id, b.plant_id, b.store_id, b.period_month, b.item_name, b.unit,
         b.opening, b.purchase_opening, b.purchased, b.used, b.computed_closing, b.created_at
    from store_stock_months_pre60_backup b
   where not exists (select 1 from store_stock_months m where m.id = b.id)
  on conflict (id) do nothing;

  -- ── 4. Restore the mutated columns ────────────────────────────────────────
  update store_items si
     set store_id            = b.store_id,
         plant_id            = b.plant_id,
         procured_qty        = b.procured_qty,
         issued_qty          = b.issued_qty,
         manual_delta        = b.manual_delta,
         ticket_procured_qty = b.ticket_procured_qty,
         repaired_qty        = b.repaired_qty,
         on_hand             = b.on_hand
    from store_items_pre60_backup b
   where si.id = b.id;

  update store_stock_events e set store_id = b.store_id
    from store_stock_events_pre60_backup b where e.id = b.id;
  update store_stock_months m set store_id = b.store_id
    from store_stock_months_pre60_backup b where m.id = b.id;
  update store_stock_uploads u set store_id = b.store_id
    from store_stock_uploads_pre60_backup b where u.id = b.id;

  if v_common is not null then
    update stock_purchase_receipts     set store_id = null where store_id = v_common;
    update stock_purchase_lines        set store_id = null where store_id = v_common;
    update repair_return_receipts      set store_id = null where store_id = v_common;
    update maintenance_store_requests  set source_store_id = null where source_store_id = v_common;
  end if;

  -- ── 5. Restore access mappings ────────────────────────────────────────────
  delete from factory_store_access where store_id = v_common;
  insert into factory_store_access (plant_id, store_id, created_at)
    select plant_id, store_id, created_at from factory_store_access_pre60_backup
    on conflict do nothing;

  delete from user_stores where store_id = v_common;
  insert into user_stores (user_account_id, store_id, created_at)
    select user_account_id, store_id, created_at from user_stores_pre60_backup
    on conflict do nothing;

  -- Re-activate the per-factory Rehla stores.
  update stores s set is_active = true
    from factory_store_access_pre60_backup b where s.id = b.store_id;

  if v_common is not null then
    update stores set is_active = false where id = v_common;
  end if;
end $$;

-- ── 6. Restore the original uniqueness ──────────────────────────────────────
drop index if exists store_items_store_item_key;
drop index if exists store_stock_uploads_store_month_key;

alter table store_items
  add constraint store_items_plant_id_item_name_key unique (plant_id, item_name);
alter table store_stock_uploads
  add constraint store_stock_uploads_plant_id_period_month_key unique (plant_id, period_month);

notify pgrst, 'reload schema';

-- Verify BEFORE dropping the snapshots:
--   select (select count(*) from store_items_pre60_backup) as expected,
--          (select count(*) from store_items)              as actual;
--   select (select count(*) from store_stock_events_pre60_backup) as expected,
--          (select count(*) from store_stock_events)              as actual;
--
-- Then:
--   drop table if exists store_items_pre60_backup, store_stock_events_pre60_backup,
--                        store_stock_months_pre60_backup, store_stock_uploads_pre60_backup,
--                        factory_store_access_pre60_backup, user_stores_pre60_backup,
--                        store_item_merge_pre60_backup, store_item_repoint_pre60_backup;
