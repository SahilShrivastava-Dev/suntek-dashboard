-- ═══════════════════════════════════════════════════════════════════════════
-- 37_store_stock.sql — Store stock ledger (Excel ingestion + living register)
-- ═══════════════════════════════════════════════════════════════════════════
-- The client keeps inventory in a monthly Store Keeping workbook (a Sales + a
-- Purchase sheet per month). We parse it ONCE on upload and keep four tables:
--   • store_stock_uploads — one row per uploaded monthly file (+ Cloudinary URL)
--   • store_stock_months  — parsed per-item snapshot per month (feeds the tally)
--   • store_items         — the CURRENT living register (on-hand per item/plant)
--   • store_stock_events  — audit trail of every in-app change (issue/procure/edit)
-- Plus a `note` column on activity_logs so a manual stock edit carries its
-- justification into the Activity Log for admins.
--
-- Model (per item, per month): closing = opening + purchased − used; each
-- month's closing is the next month's headstart. Current on_hand starts at the
-- latest month's computed closing and is then adjusted live:
--     on_hand = baseline_qty + procured_qty − issued_qty + manual_delta
--
-- Requires 27 (plants) + 28 (plant_in_scope). Idempotent. Does NOT run itself.
-- Reversible via 37_rollback_store_stock.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Upload manifest — one per plant per month (re-upload replaces).
create table if not exists store_stock_uploads (
  id               uuid primary key default gen_random_uuid(),
  plant_id         uuid references plants(id) on delete set null,
  period_month     date not null,             -- first day of the month, e.g. 2026-04-01
  file_name        text,
  file_url         text,                       -- Cloudinary archive of the raw xlsx
  uploaded_by      uuid references user_accounts(id) on delete set null,
  uploaded_by_name text,
  row_count        integer default 0,
  sheet_count      integer default 0,
  notes            text,
  created_at       timestamptz default now(),
  unique (plant_id, period_month)
);

-- 2) Parsed per-item monthly snapshot (immutable record of what the file said).
create table if not exists store_stock_months (
  id                uuid primary key default gen_random_uuid(),
  upload_id         uuid references store_stock_uploads(id) on delete cascade,
  plant_id          uuid references plants(id) on delete set null,
  period_month      date not null,
  item_name         text not null,
  unit              text,
  opening           numeric default 0,         -- Sales sheet "Op Stock"
  purchase_opening  numeric default 0,         -- Purchase sheet "Opening" (intra-month check)
  purchased         numeric default 0,         -- Σ Purchase daily columns
  used              numeric default 0,         -- Σ Sales daily columns
  computed_closing  numeric default 0,         -- opening + purchased − used
  created_at        timestamptz default now()
);
create index if not exists idx_store_stock_months_plant_month on store_stock_months(plant_id, period_month);

-- 3) Living register — one row per item per plant.
create table if not exists store_items (
  id             uuid primary key default gen_random_uuid(),
  plant_id       uuid references plants(id) on delete set null,
  item_name      text not null,
  unit           text,
  equipment      text,                          -- derived from the name prefix
  model          text,                          -- derived from (…) in the name
  baseline_qty   numeric default 0,             -- latest month computed closing (headstart)
  baseline_month date,
  procured_qty   numeric default 0,             -- added by the procurement flow since baseline
  issued_qty     numeric default 0,             -- decremented by handovers since baseline
  manual_delta   numeric default 0,             -- net manual adjustments since baseline
  on_hand        numeric default 0,             -- = baseline + procured − issued + manual_delta
  updated_at     timestamptz default now(),
  created_at     timestamptz default now(),
  unique (plant_id, item_name)
);
create index if not exists idx_store_items_plant on store_items(plant_id);

-- 4) Audit trail of every in-app stock change.
create table if not exists store_stock_events (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid references store_items(id) on delete cascade,
  plant_id      uuid references plants(id) on delete set null,
  event_type    text not null,                 -- baseline | issue | procure | manual_edit | rename
  qty_delta     numeric default 0,
  on_hand_after numeric,
  ref           text,                           -- ticket #, upload id, etc.
  justification text,
  actor         uuid references user_accounts(id) on delete set null,
  actor_name    text,
  created_at    timestamptz default now()
);
create index if not exists idx_store_stock_events_item on store_stock_events(item_id);

-- 5) Manual stock edits need a justification visible in the Activity Log.
alter table activity_logs add column if not exists note text;

-- ── RLS: plant-scope everything (mirror stock_levels in 28) ──────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['store_stock_uploads','store_stock_months','store_items','store_stock_events'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "anon_all"  on %I', tbl);
    execute format('drop policy if exists "scope_all" on %I', tbl);
    execute format('create policy "scope_all" on %I for all using (public.plant_in_scope(plant_id)) with check (public.plant_in_scope(plant_id))', tbl);
  end loop;
end $$;

notify pgrst, 'reload schema';
