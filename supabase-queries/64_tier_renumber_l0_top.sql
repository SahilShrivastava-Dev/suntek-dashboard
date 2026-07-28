-- ═══════════════════════════════════════════════════════════════════════════
-- 64_tier_renumber_l0_top.sql — hierarchy renumbered so the top is L0
-- ═══════════════════════════════════════════════════════════════════════════
-- The client reads the ladder top-down, so the most senior level should be L0
-- and the numbers should grow as you go down:
--
--     L0  Admin          (was L5)
--     L1  Management     (was L4)
--     L2  Unit Head      (was L3)
--     L3  Managers       (was L2)   store / purchase / warehouse / accounts
--     L4  Entry          (was L1)   technicians, operators, shop floor
--
-- ═══ `rank` KEEPS ITS MEANING: HIGHER = MORE SENIOR ═════════════════════════
-- So L0 carries the HIGHEST rank (50) and L4 the lowest (10). That reads
-- backwards at a glance, and it is deliberate: every seniority comparison in
-- the app is written as `rank < myRank` ("beneath me"). Flipping the rank
-- ordering would silently invert who can schedule, approve and manage whom
-- across the whole codebase. The ID is what people read; `rank` is what the
-- code compares. Renaming one must not change the other.
--
-- ═══ WHY THE SWAP NEEDS TWO PHASES ══════════════════════════════════════════
-- The mapping swaps ids pairwise (L1↔L4, L2↔L3), and `tiers.id` is the primary
-- key — renaming L1→L4 while L4 still exists collides. Everything is moved to a
-- temporary id first, then into its final one.
--
-- `roles.level` stores the tier id as plain text with NO foreign key, so it is
-- updated in lockstep here. Nothing else in the database references a tier id.
--
-- ⚠️ Deploy the matching frontend with this. Several screens carry hard-coded
-- tier ids (User Management's level picker and colour map, the login demo
-- chips, the no-access fallback). Applied on its own, those will show stale or
-- missing levels.
--
-- Requires 29 (tiers). Idempotent — a re-run detects L0 and stops.
-- Reversible via 64_rollback_tier_renumber.sql.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_pair   record;
  v_moved  bigint;
  v_roles  bigint := 0;
begin
  if exists (select 1 from tiers where id = 'L0') then
    raise notice 'Tiers already renumbered (L0 present) — nothing to do.';
    return;
  end if;

  if not exists (select 1 from tiers where id = 'L5') then
    raise exception
      'Expected the old L1–L5 ladder but found no L5. Apply 29_tiers_and_capabilities.sql first.';
  end if;

  -- ── Phase 1: park every tier under a temporary id ─────────────────────────
  for v_pair in
    select * from (values
      ('L5', 'L0'), ('L4', 'L1'), ('L3', 'L2'), ('L2', 'L3'), ('L1', 'L4')
    ) as m(old_id, new_id)
  loop
    update tiers set id = '__tmp_' || v_pair.new_id where id = v_pair.old_id;
    update roles set level = '__tmp_' || v_pair.new_id where level = v_pair.old_id;
    get diagnostics v_moved = row_count;
    v_roles := v_roles + v_moved;
  end loop;

  -- ── Phase 2: land them on their final ids ─────────────────────────────────
  update tiers set id = replace(id, '__tmp_', '') where id like '__tmp_%';
  update roles set level = replace(level, '__tmp_', '') where level like '__tmp_%';

  raise notice 'Renumbered 5 tier(s) and re-levelled % role(s).', v_roles;
end $$;

-- ── Labels + descriptions the client asked for ──────────────────────────────
-- The ID is the display string in the UI badges, so the label is what shows in
-- the level picker and the role editor.
update tiers t
   set label       = v.label,
       description = v.descr
  from (values
    ('L0', 'Admin',      50, 'Owner / Admin — full access'),
    ('L1', 'Management', 40, 'Management'),
    ('L2', 'Unit Head',  30, 'Unit heads — review & approval'),
    ('L3', 'Managers',   20, 'Store / purchase / warehouse / accounts'),
    ('L4', 'Entry',      10, 'Entry level — technicians, operators, shop floor')
  ) as v(id, label, rank, descr)
 where t.id = v.id
   and (t.label is distinct from v.label or t.description is distinct from v.descr);

-- Re-assert the seniority scores. Gapped by 10 so a new level can be inserted
-- between two others without renumbering anything.
update tiers t
   set rank = v.rank
  from (values ('L0', 50), ('L1', 40), ('L2', 30), ('L3', 20), ('L4', 10))
    as v(id, rank)
 where t.id = v.id and t.rank is distinct from v.rank;

comment on column tiers.rank is
  'Seniority score — HIGHER = MORE SENIOR. Note this runs opposite to the id: L0 (top) has rank 50, L4 (entry) has rank 10. Code compares rank, people read the id.';

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   The ladder, top first:
--     select id, label, rank, description from tiers order by rank desc;
--
--   Every role sits on a real tier (expect zero orphans):
--     select r.id, r.label, r.level from roles r
--      where not exists (select 1 from tiers t where t.id = r.level);
--
--   Who is where:
--     select t.id, t.label, count(r.*) as roles
--       from tiers t left join roles r on r.level = t.id
--      group by t.id, t.label, t.rank order by t.rank desc;
