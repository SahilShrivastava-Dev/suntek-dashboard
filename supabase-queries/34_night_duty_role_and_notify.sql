-- ═══════════════════════════════════════════════════════════════════════════
-- 34_night_duty_role_and_notify.sql — retire night_manager role + notify photos
-- ═══════════════════════════════════════════════════════════════════════════
-- Night duty is now a technician job, so the standalone `night_manager` role is
-- retired: its people become technicians, and technicians gain access to the
-- Night Manager tab (to see + check into their assigned night duty). Also lets
-- notifications carry a photo (the check-in proof, shown via a camera icon).
--
-- Requires 25 (roles) + 33 (night_duty). Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Technicians can open the Night Manager tab (for their duty + check-in).
update roles
   set allowed_routes = allowed_routes || array['/dashboard/night-manager']
 where id = 'technician_shd'
   and not ('/dashboard/night-manager' = any(allowed_routes));

-- 2) Move any night_manager people to technician.
update user_accounts set role_id = 'technician_shd', role_label = 'Technician' where role_id = 'night_manager';
update profiles      set role = 'technician_shd' where role = 'night_manager';
insert into user_roles (user_account_id, role_id)
  select user_account_id, 'technician_shd' from user_roles where role_id = 'night_manager'
  on conflict do nothing;
delete from user_roles where role_id = 'night_manager';

-- 3) Retire the role.
delete from roles where id = 'night_manager';

-- 4) Notifications can carry a photo (night-duty check-in proof).
alter table notifications add column if not exists photo_url text;

notify pgrst, 'reload schema';
