-- ═══════════════════════════════════════════════════════════════════════════
-- 70_import_batches.sql — every bulk upload becomes a deletable batch
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PROBLEM
-- A wrong CSV/Excel import is permanent. There is no way to say "these 500 rows
-- came from THAT file" and remove them, so the only recovery is to hand-delete
-- rows or wipe the whole register (68_reset_far_and_stock_TESTING_ONLY.sql).
--
-- Today's state, per module:
--   FAR          — no manifest at all. fixed_assets rows are inserted bare.
--   Stock        — store_stock_uploads records the FILE, but nothing links the
--                  store_items it seeded back to it.
--   PM schedules — pm_schedule_uploads records the file, written AFTER the
--                  schedules and never linked to them.
--
-- THE MODEL
--   import_batches           — one row per uploaded file (the manifest)
--   <table>.import_batch_id  — every row the file created points back at it
--   import_batch_deletions   — the audit record, which OUTLIVES the batch
--
-- The rule the whole design turns on: **deleting a batch deletes only rows that
-- carry its id.** A row typed in by hand has import_batch_id = null and is
-- untouchable by any deletion; a row from another file carries a different id.
-- That is requirement §2's "must not delete records entered manually or records
-- imported through another file", enforced by a WHERE clause rather than by
-- being careful.
--
-- ═══ WHY on delete set null, NOT cascade ════════════════════════════════════
-- A cascade would make deletion a single DELETE and look simpler. It would also
-- be wrong: it could not COUNT what it was about to remove (needed for the
-- confirmation), could not REFUSE when a stock batch has live movements against
-- it, could not RECOMPUTE the on-hand baseline afterwards, and could not write
-- an audit row naming what went. All deletion goes through delete_import_batch()
-- for those four reasons. set null is the safety net for the path nobody should
-- take: if a batch row is ever removed directly, its data survives as
-- unattributed rather than silently disappearing.
--
-- ═══ WHY THE STOCK MODULE IS THE HARD ONE ═══════════════════════════════════
-- FAR and PM schedules are append-only: the file INSERTS rows, so deleting them
-- is exact. A stock upload is not — it upserts store_items on
-- (store_id, item_name), CREATING some rows and re-baselining others that were
-- already there. So the batch records both facts:
--   store_items.created_by_batch_id — this batch created the row  → delete it
--   store_stock_uploads.import_batch_id — this batch set the baseline
-- and for rows it merely re-baselined, deletion rolls the baseline back to the
-- newest month that SURVIVES, adjusting on_hand by the difference so live
-- movements recorded since the import are preserved rather than discarded.
--
-- store_stock_months needs no new column: it is already
-- `upload_id → store_stock_uploads on delete cascade`, so hanging the batch off
-- the upload row reuses that cascade instead of adding a second one.
--
-- Requires 28 (plant_in_scope), 32 (has_capability), 37 (store_stock_*),
-- 45 (pm_schedule_uploads), 59 (stores). Idempotent.
-- Reversible via 70_rollback_import_batches.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Guards ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.store_stock_uploads') is null then
    raise exception '37_store_stock.sql has not been applied.';
  end if;
  if to_regclass('public.pm_schedule_uploads') is null then
    raise exception '45_pm_far_schedules.sql has not been applied.';
  end if;
  -- to_regprocedure, NOT to_regproc: only the former accepts an argument list.
  -- to_regproc('f(text)') always returns null, so this guard would have refused
  -- to run on a database that DOES have the function.
  if to_regprocedure('public.has_capability(text)') is null then
    raise exception '32_roles_rls.sql has not been applied (no has_capability).';
  end if;
  if to_regprocedure('public.plant_in_scope(uuid)') is null then
    raise exception '28_rls_phase2a_operational.sql has not been applied (no plant_in_scope).';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. THE MANIFEST
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per uploaded file. `module` is constrained rather than free text so a
-- typo cannot create a module the admin screen will never show, and so the
-- deletion RPC can dispatch on it exhaustively.
--
-- Only modules that actually have a CSV/Excel importer are listed. Purchase
-- Orders and Store Requisitions capture one document at a time via OCR and have
-- no bulk import, so they are deliberately absent — adding them here would
-- advertise an Upload History that never has rows. Extend the CHECK (and the
-- dispatch in delete_import_batch) when a real importer is built for them.
create table if not exists import_batches (
  id               uuid primary key default gen_random_uuid(),
  module           text not null check (module in ('far', 'stock', 'pm_schedule')),
  -- Which factory the file belongs to. Always set — it is the primary filter on
  -- the admin screen and what scopes the batch under RLS.
  plant_id         uuid references plants(id) on delete set null,
  -- Which register, for stock. Null for FAR / PM (they are factory-owned).
  store_id         uuid references stores(id) on delete set null,
  file_name        text,
  file_url         text,                    -- Cloudinary archive of the raw file
  -- Stock files are per-month; FAR and PM files are not.
  period_month     date,
  uploaded_by      uuid references user_accounts(id) on delete set null,
  uploaded_by_name text,
  -- What the importer said it wrote. The live count is recomputed at delete
  -- time (rows may have been hand-deleted since), so this is the historical
  -- claim, not the authority.
  row_count        integer default 0,
  sheet_count      integer default 0,
  notes            text,
  status           text not null default 'active' check (status in ('active', 'deleted')),
  created_at       timestamptz default now()
);
create index if not exists import_batches_plant_idx  on import_batches (plant_id, created_at desc);
create index if not exists import_batches_module_idx on import_batches (module, created_at desc);
create index if not exists import_batches_status_idx on import_batches (status);

-- A batch is a factory-scoped record, so it follows the same policy as the data
-- it describes. Note this means a non-admin with factory access can SEE their
-- own upload history — that is intentional and useful ("did my file land?").
-- DELETING is gated separately, by capability, inside the RPC.
alter table import_batches enable row level security;
drop policy if exists "anon_all"   on import_batches;
drop policy if exists "scope_all"  on import_batches;
create policy "scope_all" on import_batches for all
  using (public.plant_in_scope(plant_id)) with check (public.plant_in_scope(plant_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE AUDIT RECORD
-- ═══════════════════════════════════════════════════════════════════════════
-- Requirement §2: "An audit record should be retained containing deleted batch
-- ID, filename, plant, module, deleted by, deletion date and time, number of
-- deleted records."
--
-- `batch_id` is a plain uuid and NOT a foreign key, on purpose: the audit row
-- has to survive the batch it describes. Every human-readable field is
-- DENORMALISED for the same reason — if the plant or store row is later retired
-- or renamed, the audit must still say what was deleted at the time. An audit
-- trail that can be broken by a later rename is not an audit trail.
create table if not exists import_batch_deletions (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null,
  module              text not null,
  plant_id            uuid,
  plant_name          text,
  store_name          text,
  file_name           text,
  period_month        date,
  uploaded_by_name    text,
  uploaded_at         timestamptz,
  -- Total rows removed, and the per-table breakdown behind it.
  deleted_count       integer not null default 0,
  deleted_counts      jsonb,
  -- Was this pushed through over a blocker, and if so what were the blockers?
  forced              boolean not null default false,
  blockers            jsonb,
  reason              text,
  deleted_by          uuid references user_accounts(id) on delete set null,
  deleted_by_name     text,
  deleted_at          timestamptz not null default now()
);
create index if not exists import_batch_deletions_at_idx    on import_batch_deletions (deleted_at desc);
create index if not exists import_batch_deletions_batch_idx on import_batch_deletions (batch_id);

alter table import_batch_deletions enable row level security;
drop policy if exists "anon_all"   on import_batch_deletions;
drop policy if exists "scope_all"  on import_batch_deletions;
-- Dropped before being created, like every other policy here — otherwise
-- re-running this migration fails on "policy already exists" and it stops being
-- idempotent, which every other file in this set relies on.
drop policy if exists "scope_read" on import_batch_deletions;
-- Readable within scope; written only by the SECURITY DEFINER RPC. No client
-- INSERT/UPDATE/DELETE policy exists, so the audit trail cannot be edited or
-- erased through the API — which is the whole point of keeping one.
create policy "scope_read" on import_batch_deletions for select
  using (public.plant_in_scope(plant_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LINK EVERY IMPORTED ROW BACK TO ITS FILE
-- ═══════════════════════════════════════════════════════════════════════════
alter table fixed_assets          add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table maintenance_schedules add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table store_stock_uploads   add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table pm_schedule_uploads   add column if not exists import_batch_id uuid references import_batches(id) on delete set null;

-- Which batch CREATED this register row (as opposed to re-baselining one that
-- already existed). Only a creating batch may delete the row.
alter table store_items add column if not exists created_by_batch_id uuid references import_batches(id) on delete set null;

create index if not exists fixed_assets_batch_idx          on fixed_assets (import_batch_id) where import_batch_id is not null;
create index if not exists maintenance_schedules_batch_idx on maintenance_schedules (import_batch_id) where import_batch_id is not null;
create index if not exists store_stock_uploads_batch_idx   on store_stock_uploads (import_batch_id) where import_batch_id is not null;
create index if not exists pm_schedule_uploads_batch_idx   on pm_schedule_uploads (import_batch_id) where import_batch_id is not null;
create index if not exists store_items_created_batch_idx   on store_items (created_by_batch_id) where created_by_batch_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. WHAT WOULD THIS DELETION TOUCH?
-- ═══════════════════════════════════════════════════════════════════════════
-- Shared by the confirmation dialog and by the deletion itself, so the number
-- the admin is shown and the number that is actually deleted come from the SAME
-- expression. Two functions that agree by coincidence would eventually stop.
--
-- Returns { counts: {table: n, …}, total: n, blockers: [ {kind, detail, count} ] }
--
-- BLOCKERS are activity recorded AFTER the import, against rows the import
-- created. Removing the baseline underneath live movements does not corrupt the
-- audit trail (the events survive) but it does change stock figures people have
-- acted on, so it needs a deliberate decision rather than a silent recompute.
create or replace function public.preview_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_b        import_batches%rowtype;
  v_counts   jsonb := '{}'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_total    integer := 0;
  v_n        integer;
begin
  select * into v_b from import_batches where id = p_batch_id;
  if not found then
    raise exception 'unknown_batch: %', p_batch_id;
  end if;
  if not public.plant_in_scope(v_b.plant_id) then
    raise exception 'forbidden: plant out of scope';
  end if;

  if v_b.module = 'far' then
    select count(*) into v_n from fixed_assets where import_batch_id = p_batch_id;
    v_counts := v_counts || jsonb_build_object('fixed_assets', v_n);
    v_total  := v_total + v_n;

    -- A ticket or PM schedule pointing at one of these assets loses its link
    -- (both are ON DELETE SET NULL). The ticket survives; the association does
    -- not, and re-importing will NOT restore it because new rows get new ids —
    -- the same caveat 68 documents. Worth a confirmation, not a refusal.
    select count(*) into v_n
      from maintenance_tickets t
      join fixed_assets fa on fa.id = t.far_asset_id
     where fa.import_batch_id = p_batch_id;
    if v_n > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'kind', 'ticket_links', 'count', v_n,
        'detail', format('%s maintenance ticket(s) are linked to assets from this file and will lose that link', v_n));
    end if;

    select count(*) into v_n
      from maintenance_schedules s
      join fixed_assets fa on fa.id = s.far_asset_id
     where fa.import_batch_id = p_batch_id;
    if v_n > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'kind', 'schedule_links', 'count', v_n,
        'detail', format('%s preventive-maintenance schedule(s) are linked to assets from this file and will lose that link', v_n));
    end if;

  elsif v_b.module = 'pm_schedule' then
    select count(*) into v_n from maintenance_schedules where import_batch_id = p_batch_id;
    v_counts := v_counts || jsonb_build_object('maintenance_schedules', v_n);
    v_total  := v_total + v_n;

  elsif v_b.module = 'stock' then
    -- The month snapshots, which cascade from the upload manifest.
    select count(*) into v_n
      from store_stock_months m
      join store_stock_uploads u on u.id = m.upload_id
     where u.import_batch_id = p_batch_id;
    v_counts := v_counts || jsonb_build_object('store_stock_months', v_n);
    v_total  := v_total + v_n;

    select count(*) into v_n from store_stock_uploads where import_batch_id = p_batch_id;
    v_counts := v_counts || jsonb_build_object('store_stock_uploads', v_n);
    v_total  := v_total + v_n;

    -- Register rows this file created (deleted) vs re-baselined (rolled back).
    select count(*) into v_n from store_items where created_by_batch_id = p_batch_id;
    v_counts := v_counts || jsonb_build_object('store_items_deleted', v_n);
    v_total  := v_total + v_n;

    -- Restricted to items the FILE actually named. Joining store_items to the
    -- upload on store_id alone would match every row in the register, including
    -- items this file never mentioned and therefore never re-baselined.
    select count(*) into v_n
      from store_items si
     where si.created_by_batch_id is distinct from p_batch_id
       and exists (
         select 1
           from store_stock_months m
           join store_stock_uploads u on u.id = m.upload_id
          where u.import_batch_id = p_batch_id
            and m.store_id = si.store_id
            and lower(btrim(m.item_name)) = lower(btrim(si.item_name)));
    v_counts := v_counts || jsonb_build_object('store_items_rebaselined', v_n);

    -- Movements against rows this file created. Deleting the row takes its
    -- event history with it (store_stock_events.item_id is ON DELETE CASCADE),
    -- so this is the blocker that matters most.
    select count(*) into v_n
      from store_stock_events e
      join store_items si on si.id = e.item_id
     where si.created_by_batch_id = p_batch_id;
    if v_n > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'kind', 'stock_events', 'count', v_n,
        'detail', format('%s stock movement(s) (issues, purchases, corrections) have been recorded against items created by this file', v_n));
    end if;

    -- Parts already taken out of, or added into, this register since the import
    -- — counted only for the items this file actually touched.
    select count(*) into v_n
      from store_items si
     where (coalesce(si.issued_qty,0) > 0
         or coalesce(si.procured_qty,0) > 0
         or coalesce(si.ticket_procured_qty,0) > 0
         or coalesce(si.repaired_qty,0) > 0
         or coalesce(si.manual_delta,0) <> 0)
       and (si.created_by_batch_id = p_batch_id
         or exists (
           select 1
             from store_stock_months m
             join store_stock_uploads u on u.id = m.upload_id
            where u.import_batch_id = p_batch_id
              and m.store_id = si.store_id
              and lower(btrim(m.item_name)) = lower(btrim(si.item_name))));
    if v_n > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'kind', 'adjusted_items', 'count', v_n,
        'detail', format('%s item(s) in this register have been issued, procured or corrected since the upload', v_n));
    end if;

    -- Anomalies someone has already reviewed for these months. The review is a
    -- human judgement about numbers that are about to change.
    -- store_stock_anomalies is keyed on (plant_id, period_month, item, type) —
    -- it predates the store split — so it is matched on the batch's factory and
    -- the month(s) the file covered.
    select count(*) into v_n
      from store_stock_anomalies a
     where a.status <> 'open'
       and a.plant_id = v_b.plant_id
       and a.period_month in (
         select u.period_month from store_stock_uploads u
          where u.import_batch_id = p_batch_id and u.period_month is not null);
    if v_n > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'kind', 'reviewed_anomalies', 'count', v_n,
        'detail', format('%s stock anomaly review(s) exist for the month(s) in this file', v_n));
    end if;
  end if;

  return jsonb_build_object(
    'batch_id',   p_batch_id,
    'module',     v_b.module,
    'file_name',  v_b.file_name,
    'status',     v_b.status,
    'counts',     v_counts,
    'total',      v_total,
    'blockers',   v_blockers,
    'can_delete', v_b.status = 'active');
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. DELETE ONE BATCH
-- ═══════════════════════════════════════════════════════════════════════════
-- Admin-only, atomic, audited, and refuses by default when there is downstream
-- activity. p_force is the deliberate override; p_reason is mandatory when
-- forcing, because "why did you overrule the block" is the one thing the audit
-- row cannot reconstruct on its own.
create or replace function public.delete_import_batch(
  p_batch_id uuid,
  p_force    boolean default false,
  p_reason   text    default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_b          import_batches%rowtype;
  v_prev       jsonb;
  v_blockers   jsonb;
  v_counts     jsonb;
  v_total      integer;
  v_actor      uuid;
  v_actor_name text;
  v_plant_name text;
  v_store_name text;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_n          integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- Requirement §2: "The deletion option must be restricted to authorised
  -- administrator accounts." has_capability() is true for admin roles
  -- implicitly, so this grants nothing to anyone else by default.
  if not public.has_capability('delete_import_batch') then
    raise exception 'forbidden: missing capability delete_import_batch';
  end if;

  -- Lock the manifest for the whole transaction. Two admins hitting delete on
  -- the same batch would otherwise both pass the status check and both write an
  -- audit row claiming to have deleted the same rows.
  select * into v_b from import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'unknown_batch: %', p_batch_id;
  end if;
  if not public.plant_in_scope(v_b.plant_id) then
    raise exception 'forbidden: plant out of scope';
  end if;
  if v_b.status = 'deleted' then
    raise exception 'already_deleted: this upload has already been deleted';
  end if;

  v_prev     := public.preview_import_batch(p_batch_id);
  v_blockers := coalesce(v_prev->'blockers', '[]'::jsonb);
  v_counts   := coalesce(v_prev->'counts',   '{}'::jsonb);
  v_total    := coalesce((v_prev->>'total')::integer, 0);

  if jsonb_array_length(v_blockers) > 0 and not p_force then
    raise exception 'blocked: %', v_blockers::text;
  end if;
  if p_force and jsonb_array_length(v_blockers) > 0 and v_reason = '' then
    raise exception 'reason_required: forcing a blocked deletion requires a reason';
  end if;

  select ua.id, ua.name into v_actor, v_actor_name
    from user_accounts ua where ua.auth_user_id = auth.uid() limit 1;
  select p.name into v_plant_name from plants p where p.id = v_b.plant_id;
  select s.name into v_store_name from stores s where s.id = v_b.store_id;

  -- ── The deletion itself, per module ───────────────────────────────────────
  if v_b.module = 'far' then
    -- Append-only module: the file inserted these rows, so removing them is
    -- exact. Tickets/schedules pointing at them are ON DELETE SET NULL — they
    -- survive, unlinked (reported as a blocker above).
    delete from fixed_assets where import_batch_id = p_batch_id;

  elsif v_b.module = 'pm_schedule' then
    delete from maintenance_schedules where import_batch_id = p_batch_id;

  elsif v_b.module = 'stock' then
    -- ── 1. Roll the baseline back on rows this file only RE-baselined ───────
    -- Must happen BEFORE the month snapshots are deleted, since the surviving
    -- baseline is read from them.
    --
    -- on_hand is maintained incrementally elsewhere (issue/purchase RPCs do
    -- `on_hand = on_hand ± qty`), so it already contains every movement since
    -- the import. Recomputing it from the formula would therefore be wrong —
    -- it would discard those movements. Instead the DIFFERENCE between the old
    -- and the surviving baseline is applied, which removes this file's
    -- contribution and leaves everything else intact.
    with target as (
      -- Only the items this FILE named. Matching on store_id alone would
      -- re-baseline every row in the register, including items the file never
      -- mentioned — zeroing stock the upload never touched.
      select si.id, si.store_id, si.item_name, si.baseline_qty
        from store_items si
       where si.created_by_batch_id is distinct from p_batch_id
         and exists (
           select 1
             from store_stock_months m
             join store_stock_uploads u on u.id = m.upload_id
            where u.import_batch_id = p_batch_id
              and m.store_id = si.store_id
              and lower(btrim(m.item_name)) = lower(btrim(si.item_name)))
    ),
    -- The newest month for this item that does NOT belong to the batch being
    -- deleted. That snapshot becomes the new baseline.
    --
    -- Read as ONE lateral row, not two correlated subqueries: the quantity and
    -- the month it came from must describe the SAME snapshot. Two independently
    -- ordered `limit 1` reads could pick different rows on a period_month tie and
    -- pair a quantity with someone else's month.
    --
    -- LEFT JOIN to the upload, not INNER: a snapshot whose upload_id is null
    -- (imported before the manifest existed) is still real history and must be
    -- allowed to provide a baseline. An inner join would discard it and wrongly
    -- zero the item.
    surviving as (
      select t.id,
             s.computed_closing as new_baseline,
             s.period_month     as new_month,
             t.baseline_qty     as old_baseline
        from target t
        left join lateral (
          select m.computed_closing, m.period_month
            from store_stock_months m
            left join store_stock_uploads u2 on u2.id = m.upload_id
           where m.store_id = t.store_id
             and lower(btrim(m.item_name)) = lower(btrim(t.item_name))
             and coalesce(u2.import_batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                 <> p_batch_id
           order by m.period_month desc, m.created_at desc
           limit 1
        ) s on true
    )
    update store_items si
       -- No surviving snapshot ⇒ this file was the only source of a baseline
       -- for the item, so the baseline goes to zero. The row itself stays: it
       -- existed before this batch and may carry live movements.
       set baseline_qty   = greatest(0, coalesce(s.new_baseline, 0)),
           baseline_month = s.new_month,
           on_hand        = greatest(0, si.on_hand
                                        - greatest(0, coalesce(s.old_baseline, 0))
                                        + greatest(0, coalesce(s.new_baseline, 0))),
           updated_at     = now()
      from surviving s
     where si.id = s.id;

    -- ── 2. Rows this file CREATED ──────────────────────────────────────────
    -- store_stock_events.item_id is ON DELETE CASCADE, so any movement history
    -- on these rows goes with them. That is exactly what the 'stock_events'
    -- blocker warns about, and why forcing needs a reason.
    delete from store_items where created_by_batch_id = p_batch_id;

    -- ── 3. Anomaly reviews for the months that are going ───────────────────
    -- Left in place deliberately. They are keyed on (plant, month, item, type)
    -- and carry a human judgement plus mandatory comment; a corrected re-upload
    -- of the same month re-derives the same anomalies and rejoins them
    -- (anomalyKeys.ts). Deleting them would throw away the review and silently
    -- reopen work someone already did.

    -- ── 4. The manifest + its month snapshots (cascade) ────────────────────
    delete from store_stock_uploads where import_batch_id = p_batch_id;
  end if;

  -- ── Mark the batch, keep the row ──────────────────────────────────────────
  -- Retained rather than deleted for the same reason retired plants are: the
  -- audit row references it, and any row whose import_batch_id survived (a
  -- future module, a partial hand-delete) still resolves to a real manifest.
  update import_batches
     set status = 'deleted',
         notes  = trim(both ' ' from coalesce(notes, '') || format(
                    E'\ndeleted %s by %s%s',
                    to_char(now(), 'YYYY-MM-DD HH24:MI'),
                    coalesce(v_actor_name, 'unknown'),
                    case when v_reason <> '' then ' — ' || v_reason else '' end))
   where id = p_batch_id;

  -- ── The audit record (requirement §2) ─────────────────────────────────────
  insert into import_batch_deletions
    (batch_id, module, plant_id, plant_name, store_name, file_name, period_month,
     uploaded_by_name, uploaded_at, deleted_count, deleted_counts,
     forced, blockers, reason, deleted_by, deleted_by_name)
  values
    (p_batch_id, v_b.module, v_b.plant_id, v_plant_name, v_store_name, v_b.file_name,
     v_b.period_month, v_b.uploaded_by_name, v_b.created_at, v_total, v_counts,
     coalesce(p_force, false) and jsonb_array_length(v_blockers) > 0,
     v_blockers, nullif(v_reason, ''), v_actor, v_actor_name);

  -- Also surfaced in the Activity Log, where admins already look for "who
  -- changed what".
  insert into activity_logs (plant_id, type, date, done_by, equipment, note)
  values (v_b.plant_id, 'import_deleted', current_date, coalesce(v_actor_name, 'unknown'),
          format('Upload deleted · %s', coalesce(v_b.file_name, v_b.module)),
          format('%s · %s row(s) removed%s%s',
                 v_b.module, v_total,
                 case when jsonb_array_length(v_blockers) > 0 then ' · FORCED' else '' end,
                 case when v_reason <> '' then ' · ' || v_reason else '' end));

  return jsonb_build_object(
    'ok', true, 'batch_id', p_batch_id, 'module', v_b.module,
    'deleted_count', v_total, 'deleted_counts', v_counts,
    'forced', coalesce(p_force, false) and jsonb_array_length(v_blockers) > 0);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. DELETE SEVERAL BATCHES
-- ═══════════════════════════════════════════════════════════════════════════
-- Requirement §2: delete a single upload, delete multiple selected uploads, or
-- delete all uploads under the applied filters. All three are the same
-- operation on a different-length list, so the UI resolves its filters to ids
-- and calls this once.
--
-- ONE TRANSACTION, ALL OR NOTHING. Deleting three files and failing on the
-- fourth would leave the admin with no idea which of them went — worse than
-- failing cleanly and letting them retry.
create or replace function public.delete_import_batches(
  p_ids    uuid[],
  p_force  boolean default false,
  p_reason text    default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id      uuid;
  v_res     jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_total   integer := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'invalid: no batch ids given';
  end if;
  -- A guard against a mis-built "delete all under filter" call, not a real
  -- limit — no legitimate screen selects more than a few dozen files.
  if cardinality(p_ids) > 500 then
    raise exception 'invalid: refusing to delete more than 500 uploads in one call';
  end if;

  foreach v_id in array p_ids loop
    v_res   := public.delete_import_batch(v_id, p_force, p_reason);
    v_total := v_total + coalesce((v_res->>'deleted_count')::integer, 0);
    v_out   := v_out || v_res;
  end loop;

  return jsonb_build_object(
    'ok', true, 'batches', cardinality(p_ids),
    'deleted_count', v_total, 'results', v_out);
end $$;

grant execute on function
  public.preview_import_batch(uuid),
  public.delete_import_batch(uuid, boolean, text),
  public.delete_import_batches(uuid[], boolean, text)
  to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. WHO MAY DELETE, AND WHERE THE SCREEN LIVES
-- ═══════════════════════════════════════════════════════════════════════════
-- No role is granted the capability. Admin roles satisfy has_capability()
-- implicitly (32: `r.is_admin or p_cap = any(r.capabilities)`), which is exactly
-- the "authorised administrator accounts" the requirement asks for. An admin can
-- grant it to another role from the Role editor, behind a password step-up.

-- The route is admin-only, so no allowed_routes are appended — admin already
-- holds '*'. Recorded here so the intent is explicit rather than an omission:
--   /dashboard/admin/uploads → admin only, via the '*' wildcard.

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   Upload history, newest first:
--     select b.created_at, b.module, p.name as plant, s.name as store,
--            b.file_name, b.row_count, b.uploaded_by_name, b.status
--       from import_batches b
--       left join plants p on p.id = b.plant_id
--       left join stores s on s.id = b.store_id
--      order by b.created_at desc;
--
--   What a specific deletion WOULD remove (writes nothing):
--     select jsonb_pretty(public.preview_import_batch('<batch-uuid>'));
--
--   Rows that predate batch tracking (undeletable via the UI, by design):
--     select 'fixed_assets' as t, count(*) from fixed_assets where import_batch_id is null
--     union all select 'maintenance_schedules', count(*) from maintenance_schedules where import_batch_id is null
--     union all select 'store_items', count(*) from store_items where created_by_batch_id is null;
--
--   The deletion audit trail:
--     select deleted_at, module, plant_name, file_name, deleted_count, forced,
--            deleted_by_name, reason
--       from import_batch_deletions order by deleted_at desc;
