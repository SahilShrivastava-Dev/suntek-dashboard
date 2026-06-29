-- ─────────────────────────────────────────────────────────────────────────────
-- 22_maintenance_multi_item.sql
-- Multi-item maintenance + Purchase Manager aggregate billing with OCR verify.
--
-- Reality: when machinery breaks, several parts are usually needed at once. The
-- store request table is already a child of the ticket (one row per part), so
-- multi-item entry is supported by inserting many rows. This migration adds:
--   1. An optional defective-item photo captured when the ticket is raised.
--   2. Purchase-Manager AGGREGATE billing on the ticket — the supplier bill (from
--      BUSY, incl. GST) covers all procured items together, so the PM enters a
--      single item count + total amount + bill photo, and OCR cross-checks them.
--
-- Used by: Maintenance page (Raise form, multi-item store request, Purchase
--          Manager stage), extract-supplier-bill edge function.
-- ─────────────────────────────────────────────────────────────────────────────

alter table maintenance_tickets
  -- Optional photo of the broken/defective item(s), attached at raise time.
  add column if not exists defective_raise_photo_url text,
  -- Purchase Manager: what they declare for the whole procured set.
  add column if not exists pm_items_count  integer,
  add column if not exists pm_bill_total   numeric,
  add column if not exists pm_bill_url      text,
  -- OCR read-back of the uploaded bill (best-effort).
  add column if not exists pm_ocr_total     numeric,
  add column if not exists pm_ocr_items     integer,
  -- 'match' | 'mismatch' | 'unread' (OCR couldn't read) | null (not run yet).
  add column if not exists pm_ocr_status    text,
  add column if not exists pm_ocr_raw       jsonb,
  -- True when the declared count/total disagree with OCR beyond tolerance.
  -- This NEVER blocks submission — it flags + escalates (OCR can be wrong).
  add column if not exists pm_mismatch      boolean default false;
