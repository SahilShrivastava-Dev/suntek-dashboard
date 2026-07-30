-- ═══════════════════════════════════════════════════════════════════════════
-- 74_pm_schedule_delete_fk.sql — deleting a PM schedule batch no longer fails
--                                on a ticket generated from it
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BUG (client-reported)
-- Deleting a Maintenance Schedules upload from Upload History failed with:
--     update or delete on table "maintenance_schedules" violates foreign key
--     constraint "maintenance_tickets_schedule_id_fkey" on table
--     "maintenance_tickets"
-- …and the confirmation dialog had promised "247 records, no blockers" first.
--
-- Two separate defects:
--
--   1. THE CONSTRAINT. maintenance_tickets.schedule_id was declared as a plain
--      `references maintenance_schedules(id)` with NO on-delete action, so it
--      defaults to NO ACTION and blocks the delete outright. Compare
--      maintenance_tickets.far_asset_id, which IS `on delete set null` — that
--      is why deleting a FAR batch works and unlinks its tickets cleanly.
--      PM schedules simply never got the same treatment.
--
--   2. THE PREVIEW. preview_import_batch() counted the schedules and nothing
--      else for this module, so it reported no blockers and the admin got a
--      raw Postgres error instead of being told what stood in the way.
--
-- ═══ WHY SET NULL AND NOT CASCADE ═══════════════════════════════════════════
-- A maintenance ticket records work that actually happened — an engineer
-- attended a machine on a date. Deleting the TEMPLATE that generated it must
-- never delete that record. The ticket survives and loses only its link back to
-- the schedule, exactly as it already does when a FAR asset is removed.
--
-- The link cannot be restored by re-uploading the workbook: new schedules get
-- new ids. That is why the preview reports it as a blocker requiring a
-- deliberate override rather than doing it silently.
--
-- Requires 70 (import_batches, preview_import_batch). Idempotent.
-- Reversible via 74_rollback_pm_schedule_delete_fk.sql.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.preview_import_batch(uuid)') is null then
    raise exception '70_import_batches.sql has not been applied.';
  end if;
end $$;

-- ── 1. Let a ticket outlive the schedule that generated it ──────────────────
-- The constraint is found by its columns rather than by name, so a database
-- where it was created under a different name is still corrected.
do $$
declare v_con text;
begin
  select con.conname into v_con
    from pg_constraint con
    join pg_attribute a
      on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
   where con.conrelid = 'maintenance_tickets'::regclass
     and con.contype  = 'f'
     and con.confrelid = 'maintenance_schedules'::regclass
     and a.attname = 'schedule_id'
   limit 1;

  if v_con is null then
    raise notice 'No FK from maintenance_tickets.schedule_id found — nothing to change.';
    return;
  end if;

  -- confdeltype: 'a' = NO ACTION, 'r' = RESTRICT, 'n' = SET NULL, 'c' = CASCADE
  if exists (select 1 from pg_constraint
              where conname = v_con and conrelid = 'maintenance_tickets'::regclass
                and confdeltype = 'n') then
    raise notice 'FK % is already ON DELETE SET NULL.', v_con;
    return;
  end if;

  execute format('alter table maintenance_tickets drop constraint %I', v_con);
  alter table maintenance_tickets
    add constraint maintenance_tickets_schedule_id_fkey
    foreign key (schedule_id) references maintenance_schedules(id) on delete set null;
  raise notice 'FK % is now ON DELETE SET NULL.', v_con;
end $$;

-- ── 2. Tell the admin BEFORE they confirm ───────────────────────────────────
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

    -- Recurring tickets generated FROM these schedules. Previously unchecked,
    -- so the dialog promised "no blockers" and the delete then failed on
    -- maintenance_tickets_schedule_id_fkey with a raw Postgres message. The
    -- tickets themselves are records of work that happened and must survive;
    -- they lose only their link to the template (74 makes that FK ON DELETE
    -- SET NULL, mirroring how far_asset_id already behaves). Reported as a
    -- blocker for the same reason the FAR one is: the association cannot be
    -- restored by re-uploading, because new schedules get new ids.
    select count(*) into v_n
      from maintenance_tickets t
      join maintenance_schedules s on s.id = t.schedule_id
     where s.import_batch_id = p_batch_id;
    if v_n > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'kind', 'schedule_tickets', 'count', v_n,
        'detail', format('%s maintenance ticket(s) were generated from these schedules and will lose that link (the tickets themselves are kept)', v_n));
    end if;

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

grant execute on function public.preview_import_batch(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   The FK is now SET NULL (expect confdeltype = 'n'):
--     select conname, confdeltype from pg_constraint
--      where conrelid = 'maintenance_tickets'::regclass
--        and confrelid = 'maintenance_schedules'::regclass;
--
--   What a PM batch deletion would remove and unlink (read-only):
--     select jsonb_pretty(public.preview_import_batch('<batch-uuid>'));
--
--   Tickets that have already lost their schedule link:
--     select count(*) from maintenance_tickets
--      where schedule_id is null and type = 'periodic';
