-- ─────────────────────────────────────────────────────────────────────────────
-- 21_user_account_events.sql
-- Self-service profile settings + an audit history of who changed what.
--
-- - preferred_language: a stored per-user preference (no UI translation yet).
-- - user_account_events: every change to a profile (self-service settings edit or
--   an admin overwrite) is logged here. The admin's User Management table shows
--   this via a "History" button per row.
--
-- Used by: SettingsModal (self edits), UserManagement (admin edits + History panel)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Preferred language — stored on both the login (profiles) and the directory
--    row (user_accounts) so it survives whichever side sets it.
alter table profiles      add column if not exists preferred_language text default 'en';
alter table user_accounts add column if not exists preferred_language text default 'en';

-- 2) Per-profile action history.
create table if not exists user_account_events (
  id              uuid primary key default gen_random_uuid(),
  user_account_id uuid references user_accounts(id) on delete set null,
  target_name     text,        -- profile affected (denormalized for display)
  target_email    text,
  action          text not null, -- 'created' | 'self_update' | 'admin_update' | 'password_reset' | 'login_enabled' | 'login_disabled'
  details         text,        -- human-readable summary of what changed
  actor_name      text,        -- who performed it
  actor_role      text,
  created_at      timestamptz default now()
);

create index if not exists user_account_events_acct_idx on user_account_events (user_account_id, created_at desc);

alter table user_account_events enable row level security;
create policy "anon_all" on user_account_events for all using (true) with check (true);
