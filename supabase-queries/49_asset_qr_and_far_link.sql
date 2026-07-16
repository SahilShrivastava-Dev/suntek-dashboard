-- ═══════════════════════════════════════════════════════════════════════════
-- 49_asset_qr_and_far_link.sql — QR codes per fixed asset + reliable ticket link
-- ═══════════════════════════════════════════════════════════════════════════
-- Two related additions for the QR Asset Management feature:
--
--  1. Opt-in QR code per asset. A `qr_token` is created only when a user hits
--     "Generate QR" for that asset (not pre-generated for all 662). It is
--     persisted and permanent until the user regenerates, which rotates the
--     token so the old printed code stops resolving. `qr_token` is NULL until
--     generated; unique when present.
--
--  2. A real FK from maintenance_tickets to the asset. Today emergency tickets
--     link to an asset only by free-text `equipment`, so an asset's history is
--     fuzzy. Adding `far_asset_id` (wired from the raise form, which already
--     captures it, and copied from the schedule on periodic spawn) makes new
--     tickets reliably attributable; legacy tickets fall back to mark matching.
--
-- Additive + idempotent. Does not self-run — apply once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fixed_assets
  add column if not exists qr_token        text,
  add column if not exists qr_generated_at timestamptz,
  add column if not exists qr_generated_by text;

-- One asset per token; NULL tokens (ungenerated) are exempt from the constraint.
create unique index if not exists fixed_assets_qr_token_key
  on public.fixed_assets (qr_token)
  where qr_token is not null;

alter table public.maintenance_tickets
  add column if not exists far_asset_id uuid references public.fixed_assets(id) on delete set null;

create index if not exists maintenance_tickets_far_asset_id_idx
  on public.maintenance_tickets (far_asset_id);
