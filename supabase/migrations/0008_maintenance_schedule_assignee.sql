-- 0008_maintenance_schedule_assignee.sql
-- Lets an admin/unit-head assign a periodic maintenance schedule to a specific
-- person or team. The assignee is copied onto each auto-generated ticket
-- (maintenance_tickets.assigned_to already exists), so the blacklist guard in
-- the Maintenance module can flag a restricted person the moment a ticket lands
-- on them.

alter table public.maintenance_schedules
  add column if not exists assigned_to text;

comment on column public.maintenance_schedules.assigned_to is
  'Name of the person/team this recurring task is assigned to. Copied to maintenance_tickets.assigned_to on generation.';

-- Allow yearly (annual) recurring maintenance in addition to the existing cadences.
alter table public.maintenance_schedules
  drop constraint if exists maintenance_schedules_frequency_check;
alter table public.maintenance_schedules
  add constraint maintenance_schedules_frequency_check
  check (frequency in ('daily','weekly','monthly','quarterly','biannual','triannual','annual'));
