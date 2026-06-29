-- ─────────────────────────────────────────────────────────────────────────────
-- 24_notification_scope.sql — personal vs broadcast notifications
--
-- WHY: a notification's target_roles array conflates two different intents:
--   • a PERSONAL @-mention / CC addressed to specific people
--   • a ROLE BROADCAST addressed to everyone holding a role
-- They were indistinguishable, so a personal tag to the mock archetype "Anooj
-- Kumar" (whose person-id IS the role id `technician_shd`) leaked to every real
-- technician. Real provisioned users never collide (each has a unique
-- `db_<uuid>` person id), but to make the current mixed mock+real data behave
-- exactly like a pure-real-data production — and to keep personal mentions
-- strictly private in production — we tag each notification with its scope:
--   • 'personal'  → matched ONLY by the recipient's personal id
--   • 'broadcast' → matched by the recipient's role id(s)  [DEFAULT]
--
-- Existing rows default to 'broadcast'; the per-user account-creation floor
-- (see RoleContext / NotificationsContext) hides pre-account history, so a new
-- user no longer inherits the backlog.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notifications
  add column if not exists scope text not null default 'broadcast';

create index if not exists notifications_scope_idx on public.notifications (scope);
