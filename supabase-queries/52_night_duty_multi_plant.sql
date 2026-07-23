-- 52 · Night duty: one duty per technician per date PER PLANT
--
-- Before: unique (technician_id, duty_date) — a technician could hold only one
-- duty on a date, so re-assigning them (e.g. at a second plant, or again after
-- a check-in) was silently skipped by the scheduler's ignoreDuplicates upsert.
--
-- After: unique (technician_id, duty_date, plant_id) — a technician who works
-- across plants can be scheduled at each plant on the same night. The exact
-- (tech, date, plant) pair still can't be double-booked.
--
-- NULLS NOT DISTINCT (PG15+) makes two null-plant rows for the same tech+date
-- count as duplicates too, keeping the no-plant path idempotent.
--
-- Run in the Supabase SQL editor. The app falls back to the old conflict key
-- automatically until this has been run.

alter table night_duty
  drop constraint if exists night_duty_technician_id_duty_date_key;

alter table night_duty
  add constraint night_duty_tech_date_plant_key
  unique nulls not distinct (technician_id, duty_date, plant_id);
