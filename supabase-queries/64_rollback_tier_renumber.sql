-- ═══════════════════════════════════════════════════════════════════════════
-- 64_rollback_tier_renumber.sql — back to the L1(entry)…L5(admin) ladder
-- ═══════════════════════════════════════════════════════════════════════════
-- Exact inverse of 64: L0→L5, L1→L4, L2→L3, L3→L2, L4→L1, with the same
-- two-phase swap (the mapping is pairwise, so direct renames would collide on
-- the primary key). Labels and descriptions are restored to the 29 seed.
--
-- ⚠️ Revert the frontend alongside this, or the level picker and colour map
-- will be looking for L0–L4 while the database is back on L1–L5.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_pair record;
begin
  if not exists (select 1 from tiers where id = 'L0') then
    raise notice 'Tiers are not renumbered (no L0) — nothing to undo.';
    return;
  end if;

  for v_pair in
    select * from (values
      ('L0', 'L5'), ('L1', 'L4'), ('L2', 'L3'), ('L3', 'L2'), ('L4', 'L1')
    ) as m(old_id, new_id)
  loop
    update tiers set id = '__tmp_' || v_pair.new_id where id = v_pair.old_id;
    update roles set level = '__tmp_' || v_pair.new_id where level = v_pair.old_id;
  end loop;

  update tiers set id = replace(id, '__tmp_', '') where id like '__tmp_%';
  update roles set level = replace(level, '__tmp_', '') where level like '__tmp_%';

  raise notice 'Restored the L1–L5 ladder.';
end $$;

-- Labels/ranks as 29_tiers_and_capabilities.sql seeded them.
update tiers t
   set label = v.label, rank = v.rank, description = v.descr
  from (values
    ('L1', 'L1', 10, 'Operators / shop-floor entry'),
    ('L2', 'L2', 20, 'Supervisors / specialists'),
    ('L3', 'L3', 30, 'Unit heads'),
    ('L4', 'L4', 40, 'Management'),
    ('L5', 'L5', 50, 'Owner / Admin')
  ) as v(id, label, rank, descr)
 where t.id = v.id;

comment on column tiers.rank is 'Seniority score — higher = more senior.';

notify pgrst, 'reload schema';
