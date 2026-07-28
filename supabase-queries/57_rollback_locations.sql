-- ═══════════════════════════════════════════════════════════════════════════
-- 57_rollback_locations.sql — undo 57_locations.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 57 is purely additive (one new table + seven nullable columns on `plants`),
-- so this reverts cleanly with no data loss: every pre-existing plants column,
-- and every id, is untouched by both the migration and this rollback.
--
-- ⚠️ Do NOT run this after 58_rename_plants.sql unless 58 has been rolled back
-- first — 58 stores the pre-rename display names in `plants.legacy_names`, and
-- dropping that column discards the only record of what each factory used to
-- be called. Run 58_rollback_rename.sql first, then this.
--
-- The coordinate corrections applied by 57 §4 are NOT reverted — the previous
-- values were placeholders (SPPL in Ahmedabad, Madan in Gurgaon) and restoring
-- them would be a regression. Adjust manually if you genuinely need them back.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'plants' and column_name = 'legacy_names')
     and exists (select 1 from plants where legacy_names is not null and cardinality(legacy_names) > 0)
  then
    raise exception
      'plants.legacy_names is populated — 58_rename_plants.sql appears to have run. '
      'Run 58_rollback_rename.sql FIRST, or this rollback will discard the original names.';
  end if;
end $$;

drop index if exists plants_active_factory_idx;
drop index if exists plants_location_id_idx;
drop index if exists plants_factory_code_key;

alter table plants
  drop column if exists location_id,
  drop column if exists company_name,
  drop column if exists entity_name,
  drop column if exists factory_code,
  drop column if exists legacy_names,
  drop column if exists is_factory,
  drop column if exists is_active;

drop table if exists locations;

notify pgrst, 'reload schema';
