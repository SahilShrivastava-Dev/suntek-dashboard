-- ═══════════════════════════════════════════════════════════════════════════
-- 71_import_batch_backfill.sql — make already-imported PM schedules deletable
-- ═══════════════════════════════════════════════════════════════════════════
-- 70 gives every FUTURE upload a batch. This file reaches backwards, for the one
-- module where reaching backwards is both possible and necessary.
--
-- ═══ WHY ONLY PM SCHEDULES ══════════════════════════════════════════════════
--   FAR   — no manifest ever existed, so there is no record of which file any
--           asset came from. Nothing to attribute from.
--   Stock — same problem for the register rows.
--   Both are cleared by 68_reset_far_and_stock_TESTING_ONLY.sql before the
--   client's real files are loaded, so they start clean and fully batch-tracked.
--   Deliberate decision: do NOT invent a synthetic "everything that exists"
--   batch for them. It would be a lie about provenance, and deleting it would
--   sweep up hand-registered assets — precisely what requirement §2 forbids.
--
--   PM schedules are different: 68 explicitly KEEPS them ("What it keeps:
--   … maintenance tickets, schedules and their history"), and pm_schedule_uploads
--   already records each file with its plant, name and timestamp. So there IS
--   something to attribute from.
--
-- ═══ HOW ATTRIBUTION WORKS, AND WHY IT IS CONSERVATIVE ══════════════════════
-- pm_schedule_uploads does not record WHICH schedules a file produced. But
-- PMScheduleImport.tsx inserts the schedules and then writes the manifest in the
-- same handler, so a schedule's created_at sits a few seconds before its
-- manifest's. Matching on (same plant) AND (created_at inside a tight window
-- ending at the manifest timestamp) recovers the link accurately when the
-- timestamps line up.
--
-- Anything that does NOT match stays unattributed — import_batch_id = null,
-- undeletable through the UI. That is the safe direction: a schedule created by
-- hand must never be swept up by a file deletion, and lumping "everything for
-- this plant" into one batch would do exactly that. The report at the bottom
-- shows the matched/unmatched split so the outcome is visible rather than
-- assumed.
--
-- Where two manifests for the same plant overlap in time, the schedule is
-- attributed to the NEAREST preceding manifest — a schedule can only have come
-- from one file, and the closest is the only defensible guess.
--
-- Requires 70. Idempotent — already-attributed rows are left alone, so
-- re-running changes nothing. Reversible via 71_rollback_import_batch_backfill.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.import_batches') is null then
    raise exception '70_import_batches.sql has not been applied.';
  end if;
end $$;

-- How wide a gap between a schedule's insert and its manifest's still counts as
-- "the same upload". A PM workbook import inserts in chunks of 200 and can take
-- a while on a large file; 30 minutes is generous enough to cover a slow import
-- and far tighter than the gap between two separate upload sessions.
-- Widen it only if the report below shows unmatched rows you can account for.
do $$
declare
  v_window  interval := interval '30 minutes';
  v_batch   uuid;
  v_up      record;
  v_n       bigint;
  v_created bigint := 0;
  v_linked  bigint := 0;
begin
  -- ── 1. One batch per historical manifest ──────────────────────────────────
  for v_up in
    select u.id, u.plant_id, u.file_name, u.file_url, u.uploaded_by_name,
           u.schedule_count, u.sheet_count, u.created_at
      from pm_schedule_uploads u
     where u.import_batch_id is null
     order by u.created_at
  loop
    insert into import_batches
      (module, plant_id, file_name, file_url, uploaded_by_name,
       row_count, sheet_count, status, created_at, notes)
    values
      ('pm_schedule', v_up.plant_id, v_up.file_name, v_up.file_url, v_up.uploaded_by_name,
       coalesce(v_up.schedule_count, 0), coalesce(v_up.sheet_count, 0), 'active', v_up.created_at,
       'Backfilled by migration 71 from pm_schedule_uploads. Rows attributed by '
       || 'created_at proximity, not by a recorded link.')
    returning id into v_batch;

    update pm_schedule_uploads set import_batch_id = v_batch where id = v_up.id;
    v_created := v_created + 1;

    -- ── 2. Attribute the schedules ──────────────────────────────────────────
    -- `<=` on the upper bound because the manifest is written after the
    -- schedules; a schedule stamped later than its own manifest cannot have
    -- come from it.
    --
    -- The NOT EXISTS clause is what implements "nearest preceding manifest":
    -- a schedule is skipped if some other already-backfilled manifest for the
    -- same plant sits between it and this one.
    update maintenance_schedules s
       set import_batch_id = v_batch
     where s.import_batch_id is null
       and s.plant_id is not distinct from v_up.plant_id
       and s.created_at is not null
       and s.created_at <= v_up.created_at
       and s.created_at >= v_up.created_at - v_window
       and not exists (
         select 1 from pm_schedule_uploads u2
          where u2.id <> v_up.id
            and u2.plant_id is not distinct from v_up.plant_id
            and u2.created_at >= s.created_at
            and u2.created_at <  v_up.created_at);
    get diagnostics v_n = row_count;
    v_linked := v_linked + v_n;

    -- Keep the manifest's stated count honest about what was actually linked.
    update import_batches set row_count = v_n where id = v_batch;
  end loop;

  raise notice 'Backfill: % batch(es) created, % schedule(s) attributed.', v_created, v_linked;
end $$;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- THE REPORT — a RESULT SET, not RAISE NOTICE
-- ═══════════════════════════════════════════════════════════════════════════
-- The Supabase SQL editor silently swallows notices ("Success. No rows
-- returned"), so a notice-only report tells you nothing. Same lesson as 68.
--
-- Read the `unattributed` row: those schedules are NOT deletable through the
-- Upload History screen. Some will be genuinely hand-created (correct — leave
-- them). If the number is larger than you expect, the created_at window above
-- is probably too tight for a slow historical import.
select 1 as ord,
       'PM batches created'                       as item,
       count(*)::text                             as value
  from import_batches where module = 'pm_schedule'
union all
select 2, 'Schedules attributed to a file', count(*)::text
  from maintenance_schedules where import_batch_id is not null
union all
select 3, 'Schedules unattributed (undeletable — hand-created or unmatched)', count(*)::text
  from maintenance_schedules where import_batch_id is null
union all
select 4, 'Historical manifests still without a batch (expect 0)', count(*)::text
  from pm_schedule_uploads where import_batch_id is null
union all
-- Sanity: no schedule may be attributed to a batch for a different factory.
select 5, 'Cross-factory attributions (MUST be 0)', count(*)::text
  from maintenance_schedules s
  join import_batches b on b.id = s.import_batch_id
 where s.plant_id is distinct from b.plant_id
order by ord;

-- ── Per-file detail, for eyeballing ─────────────────────────────────────────
-- select b.created_at, p.name as plant, b.file_name, b.uploaded_by_name,
--        b.row_count as attributed,
--        (select count(*) from maintenance_schedules s where s.import_batch_id = b.id) as live_rows
--   from import_batches b
--   left join plants p on p.id = b.plant_id
--  where b.module = 'pm_schedule'
--  order by b.created_at desc;
