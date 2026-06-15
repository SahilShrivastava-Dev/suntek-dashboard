-- ─────────────────────────────────────────────────────────────────────────────
-- 09_user_accounts.sql
-- Staff user directory — admin creates/manages users here
-- Used by: UserManagement page (/dashboard/users, admin only)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists user_accounts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  mobile       text not null,
  whatsapp     text,
  email        text,
  role_id      text not null,    -- matches MockProfile id: 'admin', 'unit_head', etc.
  role_label   text,
  plant_id     uuid references plants(id),
  plant_name   text,             -- denormalized for quick display
  designation  text,             -- job title e.g. 'Store In-Charge', 'Maintenance Technician'
  access_note  text,
  is_active    boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- RLS
alter table user_accounts enable row level security;
create policy "anon_all" on user_accounts for all using (true) with check (true);
