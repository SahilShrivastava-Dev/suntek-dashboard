-- ═══════════════════════════════════════════════════════════════════════════
-- 70_rollback_import_batches.sql — remove upload-batch tracking
-- ═══════════════════════════════════════════════════════════════════════════
-- Drops, in dependency order:
--   1. the three RPCs
--   2. the import_batch_id / created_by_batch_id columns (and their indexes)
--   3. import_batches
--   4. the delete_import_batch capability from any role that holds it
--
-- ═══ import_batch_deletions IS KEPT ═════════════════════════════════════════
-- The audit trail is NOT dropped. It records deletions that actually happened
-- and rows that are already gone; discarding it would destroy the only evidence
-- of what was removed and by whom. It is fully self-contained (every field is
-- denormalised text, batch_id is not a foreign key), so it survives this
-- rollback intact and readable.
--
-- To remove it too — only when tearing down a test database:
--     drop table if exists import_batch_deletions;
--
-- ═══ WHAT THIS ROLLBACK DOES NOT UNDO ═══════════════════════════════════════
-- It does not resurrect rows that delete_import_batch() removed. Those
-- deletions were the point of the feature, they were confirmed by an admin, and
-- 70 kept no snapshot of them (a batch can be hundreds of thousands of rows —
-- snapshotting every upload forever is not a sane default). Restore from a
-- database backup if that is what you need; import_batch_deletions tells you
-- which files and how many rows to look for.
--
-- Dropping the columns loses the row→file attribution permanently: re-applying
-- 70 afterwards gives you the tables back, but every existing row reads as
-- "entered manually" and is undeletable via the UI.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. RPCs ─────────────────────────────────────────────────────────────────
drop function if exists public.delete_import_batches(uuid[], boolean, text);
drop function if exists public.delete_import_batch(uuid, boolean, text);
drop function if exists public.preview_import_batch(uuid);

-- ── 2. Columns ──────────────────────────────────────────────────────────────
-- Indexes go with their columns automatically; dropped explicitly first so a
-- partially-applied 70 (columns absent, index somehow present) still cleans up.
drop index if exists fixed_assets_batch_idx;
drop index if exists maintenance_schedules_batch_idx;
drop index if exists store_stock_uploads_batch_idx;
drop index if exists pm_schedule_uploads_batch_idx;
drop index if exists store_items_created_batch_idx;

alter table fixed_assets          drop column if exists import_batch_id;
alter table maintenance_schedules drop column if exists import_batch_id;
alter table store_stock_uploads   drop column if exists import_batch_id;
alter table pm_schedule_uploads   drop column if exists import_batch_id;
alter table store_items           drop column if exists created_by_batch_id;

-- ── 3. The manifest ─────────────────────────────────────────────────────────
-- Safe now: every foreign key into it was dropped above, and
-- import_batch_deletions.batch_id was deliberately never one.
drop table if exists import_batches;

-- ── 4. The capability ───────────────────────────────────────────────────────
-- Removed from any role that was granted it, so the Role editor stops offering
-- a power that no longer exists. Admin roles never held it explicitly (they
-- satisfy has_capability() via is_admin), so nothing is revoked from them.
update roles
   set capabilities = array_remove(capabilities, 'delete_import_batch')
 where 'delete_import_batch' = any(capabilities);

notify pgrst, 'reload schema';

-- Verify (optional):
--   select to_regclass('public.import_batches');            -- null
--   select to_regclass('public.import_batch_deletions');    -- still present (kept)
--   select count(*) from information_schema.columns
--    where table_schema='public' and column_name in ('import_batch_id','created_by_batch_id');  -- 0
