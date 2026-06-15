-- ─────────────────────────────────────────────────────────────────────────────
-- 03_notifications.sql
-- Cross-profile real-time notification bell
-- Used by: NotificationsContext, TopBar bell icon
-- IMPORTANT: After running, enable Realtime on this table:
--   Dashboard → Database → Replication → Tables → toggle notifications ON
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  target_roles text[]   not null,   -- e.g. ['admin', 'unit_head']
  title        text     not null,
  body         text,
  type         text     default 'info', -- 'info' | 'warning' | 'urgent'
  route        text,                 -- dashboard route to navigate on click
  actor_name   text,
  actor_role   text,
  read_by      text[]   default '{}',  -- array of role IDs who have read this
  created_at   timestamptz default now()
);

-- RLS
alter table notifications enable row level security;
create policy "anon_all" on notifications for all using (true) with check (true);

-- Enable Realtime (run separately in Dashboard → Database → Replication if this errors)
-- alter publication supabase_realtime add table notifications;
