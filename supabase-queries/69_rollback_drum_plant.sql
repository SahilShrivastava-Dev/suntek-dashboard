-- ═══════════════════════════════════════════════════════════════════════════
-- 69_rollback_drum_plant.sql — undo the Drum Plant – SCPL Rehla factory
-- ═══════════════════════════════════════════════════════════════════════════
-- Removes, in dependency order:
--   1. the factory_store_access link
--   2. 'Drum Plant Store'
--   3. 'Drum Plant – SCPL Rehla'
--
-- ═══ IT REFUSES IF THE FACTORY HAS BEEN USED ════════════════════════════════
-- 69 created three empty rows, so undoing it is trivial *while it is still
-- empty*. Once an asset, stock item, ticket, schedule, requisition or user
-- assignment points at it, deleting the row would either fail on a foreign key
-- or silently orphan real work — so this file checks first and reports exactly
-- what is in the way instead of half-deleting.
--
-- If the factory IS in use and you still want it gone from every picker, do
-- what 58 does for the retired plants — RETIRE it, never delete it, so history
-- keeps resolving:
--
--     update plants set is_active = false, is_factory = false
--      where factory_code = 'DRUM_REHLA';
--     update stores set is_active = false where code = 'DRUM_REHLA_STORE';
--
-- (Note that leaving a store with no factory_store_access row while it is still
-- active would trip assertion D4 of the verification sweep — hence retiring
-- the store too, rather than only unlinking it.)
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_plant  uuid;
  v_store  uuid;
  v_blocks text[] := '{}';
  v_n      bigint;
  v_col    record;
begin
  select id into v_plant from plants where factory_code = 'DRUM_REHLA';
  select id into v_store from stores where code = 'DRUM_REHLA_STORE';

  if v_plant is null and v_store is null then
    raise notice '69 has not been applied (no DRUM_REHLA plant, no DRUM_REHLA_STORE). Nothing to undo.';
    return;
  end if;

  -- ── 1. Is anything pointing at it? ────────────────────────────────────────
  -- Swept dynamically over every table carrying plant_id / store_id, so a table
  -- added after this file was written cannot be missed.
  --
  -- Three kinds of hit are NOT live usage and must never block:
  --   • factory_store_access — the one link 69 itself created. Counting it would
  --     make this rollback impossible even on a completely clean install.
  --   • *_backup             — other migrations' rollback snapshots.
  --   • import_batch_deletions — the deletion audit trail, which is deliberately
  --     denormalised and outlives everything it describes (migration 70).
  --
  -- Tables carrying BOTH plant_id and store_id are swept once per column, so the
  -- findings are de-duplicated before being reported.
  for v_col in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type   = 'BASE TABLE'
       and ((c.column_name = 'plant_id' and v_plant is not null)
         or (c.column_name = 'store_id' and v_store is not null))
       and c.table_name not in ('factory_store_access', 'import_batch_deletions')
       and c.table_name not like '%\_backup'
     order by c.table_name, c.column_name
  loop
    execute format('select count(*) from %I where %I = %L',
                   v_col.table_name, v_col.column_name,
                   case when v_col.column_name = 'plant_id' then v_plant else v_store end)
       into v_n;
    if v_n > 0 then
      v_blocks := v_blocks || format('%s.%s: %s row(s)', v_col.table_name, v_col.column_name, v_n);
    end if;
  end loop;

  -- Distinct, so a table hit on both columns reads once per column rather than
  -- appearing twice with the same number.
  select array_agg(distinct b order by b) into v_blocks from unnest(v_blocks) b;

  if cardinality(v_blocks) > 0 then
    raise exception
      'The Drum Plant is in use and will NOT be deleted — %. '
      'Deleting it would orphan real work. Retire it instead (see the header of '
      'this file for the two UPDATE statements).', array_to_string(v_blocks, '; ');
  end if;

  -- ── 2. Empty, so safe to remove ───────────────────────────────────────────
  delete from factory_store_access where plant_id = v_plant or store_id = v_store;
  delete from stores where id = v_store;
  delete from plants where id = v_plant;

  raise notice 'Removed Drum Plant – SCPL Rehla and Drum Plant Store.';

  -- ── 3. The three original Rehla links must be exactly as they were ────────
  select count(*) into v_n
    from factory_store_access fsa
    join stores s on s.id = fsa.store_id
    join plants p on p.id = fsa.plant_id
   where s.code = 'REHLA_COMMON'
     and p.factory_code in ('SCPL_REHLA','SPPL_REHLA','SPPLK_REHLA');
  if v_n <> 3 then
    raise exception
      'REHLA_COMMON serves % of the three original Rehla factories after rollback; '
      'expected 3.', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Verify (optional):
--   select count(*) from plants where factory_code = 'DRUM_REHLA';           -- 0
--   select count(*) from stores where code = 'DRUM_REHLA_STORE';             -- 0
--   -- and the sweep's section A is back to five factories:
--   select count(*) from plants where is_active and is_factory;              -- 5
