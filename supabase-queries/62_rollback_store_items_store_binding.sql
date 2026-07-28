-- ═══════════════════════════════════════════════════════════════════════════
-- 62_rollback_store_items_store_binding.sql — undo 62
-- ═══════════════════════════════════════════════════════════════════════════
-- Removes the trigger and the store_for_plant() helper, and restores the two
-- RPCs to their factory-keyed lookups by re-applying 53 and 56.
--
-- ⚠️ Adopted / merged rows are NOT un-merged. store_item_orphan_pre62_backup
-- holds what each orphan looked like before, but folding a merged row back out
-- would have to guess which subsequent movements belonged to which half. If you
-- genuinely need that, restore from the backup table by hand and reconcile.
--
-- ⚠️ After this runs, newly created stock rows will again have store_id = NULL
-- and reappear as phantom per-factory registers. Only roll back if you are also
-- rolling back 59/60.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists store_items_fill_store_id on store_items;
drop function if exists public.store_items_fill_store_id();

-- Re-apply 53_stock_purchases.sql and 56_defective_part_split.sql AFTER this
-- to restore the original apply_stock_purchase() / apply_repair_return()
-- bodies — 62 patched the installed definitions in place.
do $$
begin
  raise warning
    'Re-run 53_stock_purchases.sql and 56_defective_part_split.sql now to restore '
    'the original factory-keyed lookups in apply_stock_purchase() and apply_repair_return().';
end $$;

drop function if exists public.store_for_plant(uuid);

notify pgrst, 'reload schema';

-- Verify what 62 changed before dropping its backup:
--   select count(*) from store_item_orphan_pre62_backup;
--   drop table if exists store_item_orphan_pre62_backup;
