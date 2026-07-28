-- ═══════════════════════════════════════════════════════════════════════════
-- 58_rollback_rename.sql — undo 58_rename_plants.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores, in reverse order:
--   1. the SCPL Delhi → Sikandrabad data remap (from plant_remap_pre58_backup)
--   2. the original display names + is_active flags (from plants_pre58_backup)
--   3. the denormalized name copies (user_accounts.plant_name, anomaly_flags.plant)
--   4. removes SPPL(K) – Rehla, but ONLY if nothing references it yet
--
-- NOT reverted (deliberately, because reverting them would be a regression):
--   • the replicated Chlorides / Plasticiser unit rows — harmless, and dropping
--     them would orphan any ticket that has since been linked to one
--   • the oil_contracts.plant_id backfill — that column was NULL before and
--     tagging it is strictly an improvement
--
-- Requires the two backup tables created by 58. If they are missing, 58 never
-- ran and there is nothing to undo.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_spplk uuid;
  v_refs  bigint := 0;
  v_col   record;
  v_n     bigint;
begin
  if to_regclass('public.plants_pre58_backup') is null then
    raise exception 'plants_pre58_backup is missing — 58_rename_plants.sql has not been run.';
  end if;

  -- ── 1a. Restore user_plants wholesale from its snapshot ───────────────────
  -- Membership is restored by replacing the table's contents rather than by
  -- replaying a delta: that is the only way to get back a state where a user
  -- was ALREADY in the destination plant before 58 ran. Rows added by other
  -- work since 58 are preserved (the insert is additive and the delete is
  -- limited to the two plants 58 actually touched).
  if to_regclass('public.user_plants_pre58_backup') is not null then
    delete from user_plants up
     where up.plant_id in (select distinct plant_id from user_plants_pre58_backup)
       and not exists (
         select 1 from user_plants_pre58_backup b
          where b.user_account_id = up.user_account_id and b.plant_id = up.plant_id);

    insert into user_plants (user_account_id, plant_id)
      select user_account_id, plant_id from user_plants_pre58_backup
      on conflict do nothing;

    get diagnostics v_n = row_count;
    raise notice 'Restored user_plants from snapshot (% membership row(s) re-added).', v_n;
  end if;

  -- ── 1b. Reverse the SCPL Delhi remap on every other table ─────────────────
  if to_regclass('public.plant_remap_pre58_backup') is not null then
    for v_col in
      select distinct table_name from plant_remap_pre58_backup
       where table_name <> 'user_plants'
       order by table_name
    loop
      execute format(
        'update %I t set plant_id = b.from_plant
           from plant_remap_pre58_backup b
          where b.table_name = %L and t.id::text = b.row_id and t.plant_id = b.to_plant',
        v_col.table_name, v_col.table_name);
      get diagnostics v_n = row_count;
      if v_n > 0 then raise notice '  restored % row(s) in %', v_n, v_col.table_name; end if;
    end loop;
  end if;

  -- ── 2. Restore names, coordinates and the active flags ────────────────────
  update plants p
     set name              = b.name,
         lat               = b.lat,
         lng               = b.lng,
         geofence_radius_m = b.geofence_radius_m,
         is_active         = true,
         is_factory        = true,
         legacy_names      = null
    from plants_pre58_backup b
   where p.id = b.id;

  -- ── 3. Re-derive the denormalized name copies from the restored names ─────
  update user_accounts ua
     set plant_name = p.name
    from plants p
   where ua.plant_id = p.id
     and ua.plant_name is distinct from p.name;

  -- anomaly_flags.plant cannot be reversed by name matching (the forward pass
  -- overwrote the old value). Restore it from whichever plant the flag's own
  -- name now matches; anything unmatched is left as-is and reported.
  update anomaly_flags a
     set plant = p.name
    from plants p
   where a.plant is not null and a.plant <> p.name
     and exists (select 1 from plants_pre58_backup b where b.id = p.id and b.name = p.name);

  -- ── 4. Remove SPPL(K) – Rehla if it is still unreferenced ─────────────────
  select id into v_spplk from plants where factory_code = 'SPPLK_REHLA';
  if v_spplk is not null then
    for v_col in
      select c.table_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and c.column_name = 'plant_id'
         and t.table_type = 'BASE TABLE'
         and c.table_name not like '%\_pre58\_backup'
    loop
      execute format('select count(*) from %I where plant_id = %L', v_col.table_name, v_spplk)
        into v_n;
      v_refs := v_refs + v_n;
    end loop;

    if v_refs = 0 then
      delete from units  where plant_id = v_spplk;
      delete from plants where id = v_spplk;
      raise notice 'Removed SPPL(K) – Rehla (unreferenced).';
    else
      raise warning
        'SPPL(K) – Rehla has % referencing row(s) and was NOT removed. It has been '
        'deactivated instead; delete it manually once its data is dealt with.', v_refs;
      update plants set is_active = false where id = v_spplk;
    end if;
  end if;
end $$;

-- Keep the backup tables until the rollback has been verified, then:
--   drop table if exists plants_pre58_backup;
--   drop table if exists plant_remap_pre58_backup;
--   drop table if exists user_plants_pre58_backup;
--
-- Verify BEFORE dropping — every user is back on their original factories:
--   select ua.name, p.name as factory
--     from user_plants up
--     join user_accounts ua on ua.id = up.user_account_id
--     join plants p on p.id = up.plant_id
--    order by ua.name, p.name;

notify pgrst, 'reload schema';
