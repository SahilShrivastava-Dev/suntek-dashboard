-- ═══════════════════════════════════════════════════════════════════════════
-- 42_pm_billed_by.sql — record WHO (Purchase Manager) uploaded the procurement bill
-- ═══════════════════════════════════════════════════════════════════════════
-- Needed so the Purchase / Purchase-Mgr stage detail can show the full
-- procurement trail (amount + bill are already stored; this adds the person).
-- Idempotent. Does NOT run itself.
-- ═══════════════════════════════════════════════════════════════════════════

alter table maintenance_tickets
  add column if not exists pm_billed_by text,
  add column if not exists pm_billed_at timestamptz;

notify pgrst, 'reload schema';
