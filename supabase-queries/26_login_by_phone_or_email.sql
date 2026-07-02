-- ═══════════════════════════════════════════════════════════════════════════
-- 26_login_by_phone_or_email.sql — let users log in with phone OR email
-- ═══════════════════════════════════════════════════════════════════════════
-- Business need: a user must have AT LEAST ONE of email / phone, and can log in
-- with either (whichever they have) + password. Several workers may share one
-- email (e.g. factory1@suntek.com), so the SHARED email cannot be the login key —
-- their UNIQUE phone number is. Supabase Auth requires a globally-unique email on
-- each auth.users row, so we can't put a shared email there. Instead:
--
--   • The real email + phone live on user_accounts (a directory row).
--   • Each login-enabled account has a `login_email` = the exact (possibly
--     synthetic) email registered in auth.users. When the real email is unique it
--     IS the auth email; when it's shared / absent, a synthetic unique address
--     (u-<id>@login.suntek.local) is used. See the admin-users edge function.
--   • At login the client resolves the typed identifier → the account's
--     login_email, then calls signInWithPassword({ email: login_email, ... }).
--
-- Run once in the (client) Supabase SQL Editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Phone is no longer mandatory — email alone is enough (and vice-versa).
alter table user_accounts alter column mobile drop not null;

-- 2) The exact email registered in auth.users for this account's login.
--    NULL until a login is provisioned. Written by the admin-users edge function.
alter table user_accounts
  add column if not exists login_email text;

-- 3) Normalized phone (last 10 digits, punctuation stripped) — used as the login
--    key so formatting differences (+91, spaces, dashes) never break matching.
alter table user_accounts
  add column if not exists mobile_norm text
    generated always as (nullif(right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10), '')) stored;

-- 4) A user must have at least one contact/login identifier.
--    (NOT VALID so it can't fail on any legacy row; new/edited rows are checked.)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_accounts_contact_present'
  ) then
    alter table user_accounts
      add constraint user_accounts_contact_present
      check (email is not null or mobile is not null) not valid;
  end if;
end $$;

-- 5) Phone must be unique across all accounts, so it reliably identifies ONE
--    person at login. Compared on the normalized form.
--    NOTE: if this errors, you have existing accounts sharing a phone — dedupe
--    them first (see the SELECT below), then re-run.
create unique index if not exists user_accounts_mobile_norm_key
  on user_accounts (mobile_norm) where mobile_norm is not null;

-- Diagnostic — find duplicate phones before enforcing uniqueness:
--   select mobile_norm, count(*), array_agg(name)
--   from user_accounts where mobile_norm is not null
--   group by mobile_norm having count(*) > 1;

-- 6) login_email mirrors the (unique) auth.users email — keep it unique too.
create unique index if not exists user_accounts_login_email_key
  on user_accounts (lower(login_email)) where login_email is not null;

create index if not exists user_accounts_email_lower_idx
  on user_accounts (lower(email)) where email is not null;
