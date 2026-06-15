-- ─────────────────────────────────────────────────────────────────────────────
-- 02_auth_profiles.sql
-- Auth user metadata — links Supabase auth.users to a role + plant
-- Used by: useAuth hook, NightManagerBoard (join with shift_logs)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists profiles (
  id       uuid primary key references auth.users(id) on delete cascade,
  name     text,
  role     text,          -- e.g. 'admin', 'unit_head', 'night_manager', 'factory_operator'
  phone    text,
  plant_id uuid references plants(id)
);

-- RLS
alter table profiles enable row level security;
create policy "anon_all" on profiles for all using (true) with check (true);
