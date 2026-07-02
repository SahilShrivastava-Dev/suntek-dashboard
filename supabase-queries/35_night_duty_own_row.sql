-- ═══════════════════════════════════════════════════════════════════════════
-- 35_night_duty_own_row.sql — let a technician always update their OWN duty
-- ═══════════════════════════════════════════════════════════════════════════
-- Hardens 33's night_duty policy: a technician checking in updates their own
-- night_duty row (status → checked_in). Add their own row to WITH CHECK so the
-- check-in never fails on a plant-membership edge case. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "night_duty_scope" on night_duty;
create policy "night_duty_scope" on night_duty for all
  using (
    public.is_global_user()
    or (plant_id is not null and plant_id in (select public.my_plant_ids()))
    or technician_id = (select id from user_accounts where auth_user_id = auth.uid() limit 1)
  )
  with check (
    public.is_global_user()
    or (plant_id is not null and plant_id in (select public.my_plant_ids()))
    or technician_id = (select id from user_accounts where auth_user_id = auth.uid() limit 1)
  );

notify pgrst, 'reload schema';
