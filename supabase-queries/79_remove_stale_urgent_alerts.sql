-- ═══════════════════════════════════════════════════════════════════════════
-- 79_remove_stale_urgent_alerts.sql   ⚠️ DESTRUCTIVE — DRY RUN BY DEFAULT
-- ═══════════════════════════════════════════════════════════════════════════
-- Removes the two "Maintenance ticket raised: …" urgent alerts still sitting in
-- To-Do. They are `notifications` rows — NOT anomaly_flags (migration 78 cleared
-- those, and these survived, which is how we know) and NOT maintenance tickets.
--
-- To-Do's Urgent alerts section is built from the in-memory notifications feed
-- (`sections.tsx:168`), filtered to type 'urgent' | 'critical' and not completed.
-- So the only way to clear one permanently is to remove the row.
--
-- ═══ SCOPE ══════════════════════════════════════════════════════════════════
-- Deliberately narrow: only urgent/critical notifications ABOUT A MAINTENANCE
-- TICKET, older than 3 days. Not "all urgent notifications" — a genuine alert
-- raised an hour ago must survive this, or the next real emergency is deleted
-- by a cleanup nobody remembers running.
--
-- The underlying maintenance tickets are NOT touched. graphite block and GLC are
-- real tickets that appear in the FAR maintenance cost register; only the
-- notification about them goes.
--
-- ═══ HOW TO USE ═════════════════════════════════════════════════════════════
--   1. Run AS-IS. Deletes nothing; prints exactly what would go.
--   2. If the list is right, change the marked line to := true and run again.
--   3. The same report prints after — 0 to go means it worked.
--
-- Backed up to notifications_pre79_backup. Reversible via the paired rollback.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  -- ┌──────────────────────────────────────────────────────────────────────┐
  -- │  CHANGE false TO true TO ACTUALLY DELETE.  Leave false to dry-run.   │
  v_i_understand boolean := false;
  -- └──────────────────────────────────────────────────────────────────────┘
  v_n bigint;
begin
  if not v_i_understand then
    return;
  end if;

  if to_regclass('public.notifications_pre79_backup') is null then
    create table notifications_pre79_backup as
      select * from notifications
       where type in ('urgent','critical')
         and title ilike 'Maintenance ticket raised%'
         and created_at < now() - interval '3 days';
  end if;

  delete from notifications
   where type in ('urgent','critical')
     and title ilike 'Maintenance ticket raised%'
     and created_at < now() - interval '3 days';
  get diagnostics v_n = row_count;
  raise notice 'Removed % stale urgent alert(s).', v_n;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE REPORT — runs either way.
-- ═══════════════════════════════════════════════════════════════════════════
select 1 as ord, 'will be removed' as disposition, title, actor_name, created_at
  from notifications
 where type in ('urgent','critical')
   and title ilike 'Maintenance ticket raised%'
   and created_at < now() - interval '3 days'
union all
select 2, 'KEPT: recent urgent alert (under 3 days)', title, actor_name, created_at
  from notifications
 where type in ('urgent','critical')
   and created_at >= now() - interval '3 days'
union all
select 3, 'KEPT: non-urgent notification', title, actor_name, created_at
  from notifications
 where type not in ('urgent','critical')
 order by ord, created_at desc
 limit 40;

-- ── Drop the backup when satisfied ──────────────────────────────────────────
--   drop table if exists notifications_pre79_backup;
