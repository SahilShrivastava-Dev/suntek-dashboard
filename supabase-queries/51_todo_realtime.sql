-- ═══════════════════════════════════════════════════════════════════════════
-- 51_todo_realtime.sql — (OPTIONAL) live updates for the To-Do work queue
-- ═══════════════════════════════════════════════════════════════════════════
-- The To-Do page already refreshes on open + on tab focus, so acting on a ticket
-- elsewhere is always reflected when you return. This migration is only needed if
-- you also want the queue to update WHILE you are staring at it in another tab —
-- it adds the remaining source tables to the realtime publication so inserts/
-- updates stream in live. (maintenance_tickets is already published.)
--
-- Run once in the Supabase SQL Editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin alter publication supabase_realtime add table public.store_requisitions;
exception when duplicate_object then null; end $$;

do $$ begin alter publication supabase_realtime add table public.night_duty;
exception when duplicate_object then null; end $$;

-- anomaly_flags is already published (0007_anomaly_flags.sql); maintenance_tickets
-- is already published (0001_maintenance.sql). Nothing else to do.
