-- ═══════════════════════════════════════════════════════════════════════════
-- 79_rollback_remove_stale_urgent_alerts.sql — restore the removed alerts
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_n bigint;
begin
  if to_regclass('public.notifications_pre79_backup') is null then
    raise exception '79 has not been run (no backup) — there is nothing to restore.';
  end if;
  insert into notifications select * from notifications_pre79_backup
    on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'Restored % notification(s).', v_n;
end $$;

select count(*) as restored from notifications
 where type in ('urgent','critical') and title ilike 'Maintenance ticket raised%';
