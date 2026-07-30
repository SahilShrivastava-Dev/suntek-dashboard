-- ═══════════════════════════════════════════════════════════════════════════
-- 73_backfill_existing_batches.sql — make data loaded BEFORE batch tracking
--                                    deletable, without wiping anything
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PROBLEM
-- 70 gives every FUTURE upload a batch, and 71 reached back for PM schedules
-- (which had a manifest to work from). FAR and the stock register did not:
-- the plan was to clear them with 68 and start clean. On the client's
-- production database that is not acceptable — those are live registers:
--     fixed_assets        210   (all on Madan Chemical – Sikandrabad)
--     store_items         516   (Rehla Common Store)
--     store_stock_months 1791
-- With no import_batch_id they are invisible in Upload History and can never be
-- removed, which is exactly the problem the feature was built to solve. This
-- file gives them batches so they can be deleted and re-uploaded — the outcome
-- 68 achieved by destruction, reached without destroying anything.
--
-- ═══ THIS FILE DELETES NOTHING ══════════════════════════════════════════════
-- Every statement is either an INSERT into import_batches or an UPDATE that
-- fills a column which is currently NULL. No row is removed, no existing value
-- is overwritten, and every UPDATE is guarded by `... is null` so re-running
-- cannot re-point a row that already belongs to a batch.
--
-- ═══ STOCK — REAL PROVENANCE ════════════════════════════════════════════════
-- store_stock_uploads holds a genuine manifest per (store, month): filename,
-- period, uploader, timestamp. Each becomes a batch, exactly as 71 did for PM.
-- store_stock_months needs no column — it already cascades from the upload.
-- store_items.created_by_batch_id is set only for items the manifest's own
-- month snapshots actually name, so an item added later by a purchase or by
-- hand is never claimed by an upload that did not create it.
--
-- ═══ FAR — SYNTHETIC, BUT CLUSTERED RATHER THAN LUMPED ══════════════════════
-- No manifest was ever written for the FAR, so there is nothing to attribute
-- from. Rather than sweeping all 210 assets into one batch — which would mean
-- deleting it also deletes anything registered by hand — assets are grouped by
-- INSERTION TIME: a bulk import writes its rows within seconds, so each burst
-- becomes its own batch, and an asset registered by hand on a different
-- occasion forms a separate one-row batch the admin can see and leave alone.
--
-- ⚠️ An asset hand-registered WITHIN the same 30-minute window as an import is
--    indistinguishable from it and will share its batch. The deletion dialog
--    always shows the exact row count first, and each batch is labelled with
--    its date and asset count, so this is visible rather than silent.
--
-- Requires 70 (import_batches). Idempotent. Reversible via
-- 73_rollback_backfill_existing_batches.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.import_batches') is null then
    raise exception '70_import_batches.sql has not been applied.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'store_items' and column_name = 'created_by_batch_id') then
    raise exception '70_import_batches.sql is incomplete (store_items.created_by_batch_id missing).';
  end if;
end $$;

-- How far apart two asset inserts can be and still count as the same import.
-- A 210-row FAR import writes in one burst; 30 minutes is far wider than that
-- and far narrower than the gap between two separate sessions.
do $$
declare
  v_batch   uuid;
  v_up      record;
  v_grp     record;
  v_n       bigint;
  v_stock   bigint := 0;
  v_items   bigint := 0;
  v_far     bigint := 0;
  v_assets  bigint := 0;
begin
  -- ═══ 1. STOCK — one batch per existing manifest ═══════════════════════════
  for v_up in
    select u.id, u.plant_id, u.store_id, u.period_month, u.file_name, u.file_url,
           u.uploaded_by, u.uploaded_by_name, u.row_count, u.sheet_count, u.created_at
      from store_stock_uploads u
     where u.import_batch_id is null
     order by u.created_at
  loop
    insert into import_batches
      (module, plant_id, store_id, file_name, file_url, period_month,
       uploaded_by, uploaded_by_name, row_count, sheet_count, status, created_at, notes)
    values
      ('stock', v_up.plant_id, v_up.store_id, v_up.file_name, v_up.file_url, v_up.period_month,
       v_up.uploaded_by, v_up.uploaded_by_name, coalesce(v_up.row_count, 0),
       coalesce(v_up.sheet_count, 0), 'active', v_up.created_at,
       'Backfilled by migration 73 from the existing store_stock_uploads manifest. '
       || 'Provenance is the recorded upload, not a guess.')
    returning id into v_batch;

    update store_stock_uploads set import_batch_id = v_batch where id = v_up.id;
    v_stock := v_stock + 1;

    -- Claim ONLY the register rows this manifest's own snapshots name. An item
    -- the file never mentioned was created by something else and must not be
    -- deleted when this batch is.
    update store_items si
       set created_by_batch_id = v_batch
     where si.created_by_batch_id is null
       and si.store_id is not distinct from v_up.store_id
       and exists (
         select 1 from store_stock_months m
          where m.upload_id = v_up.id
            and m.store_id is not distinct from si.store_id
            and lower(btrim(m.item_name)) = lower(btrim(si.item_name)));
    get diagnostics v_n = row_count;
    v_items := v_items + v_n;

    -- Keep the manifest's claimed count honest about what was actually linked.
    update import_batches set row_count = v_n where id = v_batch;
  end loop;

  -- ═══ 2. FAR — one batch per burst of inserts, per factory ═════════════════
  -- Gap-based clustering: a new group starts whenever the gap since the
  -- previous asset at the same factory exceeds the window.
  for v_grp in
    with a as (
      select id, plant_id, created_at,
             lag(created_at) over (partition by plant_id order by created_at, id) as prev_at
        from fixed_assets
       where import_batch_id is null
    ),
    marked as (
      select id, plant_id, created_at,
             case when prev_at is null or created_at - prev_at > interval '30 minutes'
                  then 1 else 0 end as new_grp
        from a
    ),
    grouped as (
      select id, plant_id, created_at,
             sum(new_grp) over (partition by plant_id order by created_at, id
                                rows between unbounded preceding and current row) as grp
        from marked
    )
    select plant_id, grp, min(created_at) as started_at, count(*) as n,
           array_agg(id) as ids
      from grouped
     group by plant_id, grp
     order by min(created_at)
  loop
    insert into import_batches
      (module, plant_id, file_name, row_count, status, created_at, notes)
    values
      ('far', v_grp.plant_id,
       format('Pre-batch import · %s asset(s) · %s',
              v_grp.n, to_char(v_grp.started_at, 'DD Mon YYYY')),
       v_grp.n, 'active', v_grp.started_at,
       'Backfilled by migration 73. No upload manifest existed for these assets, '
       || 'so they were grouped by insertion time. Anything registered by hand within '
       || 'the same 30-minute window shares this batch — check the count before deleting.')
    returning id into v_batch;

    update fixed_assets set import_batch_id = v_batch where id = any(v_grp.ids);
    v_far    := v_far + 1;
    v_assets := v_assets + v_grp.n;
  end loop;

  raise notice 'Backfill: % stock batch(es) claiming % item(s); % FAR batch(es) claiming % asset(s).',
               v_stock, v_items, v_far, v_assets;
end $$;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- THE REPORT — a RESULT SET, because the Supabase editor swallows notices
-- ═══════════════════════════════════════════════════════════════════════════
-- Read rows 5 and 6: anything still unattributed stays undeletable through the
-- UI. That is correct for rows created by a purchase or by hand, and expected
-- to be 0 for data that came from a file.
select 1 as ord, 'Stock batches created'                            as item,
       (select count(*)::text from import_batches
         where module='stock' and notes like 'Backfilled by migration 73%')      as value
union all
select 2, 'Store items now deletable',
       (select count(*)::text from store_items where created_by_batch_id is not null)
union all
select 3, 'FAR batches created',
       (select count(*)::text from import_batches
         where module='far' and notes like 'Backfilled by migration 73%')
union all
select 4, 'Assets now deletable',
       (select count(*)::text from fixed_assets where import_batch_id is not null)
union all
select 5, 'Store items still unattributed (purchases / manual — expected)',
       (select count(*)::text from store_items where created_by_batch_id is null)
union all
select 6, 'Assets still unattributed (expect 0)',
       (select count(*)::text from fixed_assets where import_batch_id is null)
union all
select 7, 'Stock manifests still without a batch (expect 0)',
       (select count(*)::text from store_stock_uploads where import_batch_id is null)
union all
-- Safety assertions. Both MUST be 0 — a batch must never claim rows belonging
-- to a different factory or a different store than the one it describes.
select 8, 'Assets attributed across factories (MUST be 0)',
       (select count(*)::text from fixed_assets fa
          join import_batches b on b.id = fa.import_batch_id
         where fa.plant_id is distinct from b.plant_id)
union all
select 9, 'Store items attributed across stores (MUST be 0)',
       (select count(*)::text from store_items si
          join import_batches b on b.id = si.created_by_batch_id
         where b.module = 'stock' and si.store_id is distinct from b.store_id)
order by ord;

-- ── Per-batch detail, for eyeballing before anyone deletes anything ─────────
-- select b.module, coalesce(p.name,'—') as plant, coalesce(s.name,'—') as store,
--        b.file_name, b.period_month, b.row_count, b.created_at
--   from import_batches b
--   left join plants p on p.id = b.plant_id
--   left join stores s on s.id = b.store_id
--  where b.notes like 'Backfilled by migration 73%'
--  order by b.module, b.created_at;
--
-- ── What WOULD a given batch delete? (read-only) ────────────────────────────
-- select jsonb_pretty(public.preview_import_batch('<batch-uuid>'));
