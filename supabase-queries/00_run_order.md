# Supabase Setup — Run Order

## ✅ Fresh project? Run ONE file.

Paste **`00_full_setup.sql`** into the Supabase SQL Editor and run it. That single
file is the reconciled, idempotent reproduction of the entire database (38 tables,
FKs, RLS, indexes, realtime, seed data) for a brand-new project.

Then follow **`../DEPLOYMENT.md`** for edge functions, secrets, realtime verify,
the first-admin bootstrap, and env-var swaps.

> Do **not** also run the individual numbered files below on a fresh project —
> `00_full_setup.sql` already contains all of them.

---

## The numbered files (01–24) — history / per-feature reference

These are the original per-feature scripts, kept for provenance and for applying a
single change to an existing DB. They were run in numeric order in the editor over
the life of the project. `00_full_setup.sql` is their consolidation.

| # | File | Creates |
|---|------|---------|
| 1 | `01_core_plants.sql` | `plants` ⚠️ *outdated — missing lat/lng/geofence; see 18 + full_setup* |
| 2 | `02_auth_profiles.sql` | `profiles` |
| 3 | `03_notifications.sql` | `notifications` + realtime |
| 4 | `04_operations.sql` | `active_batches`, `batch_readings`, `batch_edit_logs`, `shift_logs`, `device_mappings`, `unit_log_entries` |
| 4 | `04_anomalies.sql` | `anomaly_log`, `anomaly_watches`, `customer_outstanding_log`, `item_master`, `detector_config` + notifications cols |
| 5 | `05_stock.sql` | `stock_levels` |
| 6 | `06_purchase.sql` | `activity_logs`, `fixed_assets`, `store_requisitions`, `oil_contracts`, `marine_insurance`, `labour_costs` |
| 7 | `07_sales.sql` | `customers`, `sales_contracts` |
| 8 | `08_maintenance.sql` (+`08b`) | `maintenance_schedules`, `maintenance_tickets`, `maintenance_store_requests` |
| 9 | `09_user_accounts.sql` | `user_accounts` |
| 10 | `10_blacklist.sql` / `10_mentions.sql` | `blacklist` / `entity_notes`, `entity_watchers` |
| 11–24 | various | RLS fixes, audit trails, column adds, scopes (see each file header) |
| 25–56 | various | roles/tiers/capabilities, night duty, store stock ledger, FAR + PM, stock RPCs (see each file header) |
| 57–61 | **location / factory / shared-store restructure** | see the run order below |

## 🏭 57–61 — location, factory rename, shared store

Run **in order**, and mind the two gates. Each has a paired `*_rollback_*.sql`.

| # | File | Does | Risk |
|---|------|------|------|
| 57 | `57_locations.sql` | `locations` table + descriptive/lifecycle columns on `plants`. Purely additive — no rename, no behaviour change | 🟢 |
| — | **deploy the frontend first** | Several screens hold hard-coded plant-name arrays or match plants by name (`PurchaseOrders.tsx`, `CheckIn.tsx`, `NightManagerBoard.tsx`, `Maintenance.tsx`). Ship those fixes **before** 58 or they will show stale names | 🚦 **gate** |
| 58 | `58_rename_plants.sql` | 9 plant rows → 5 named factories; creates `SPPL(K) – Rehla`; folds `SCPL Delhi` into Sikandarabad; retires the rest (flag only, never `DELETE`) | 🟡 |
| 59 | `59_stores.sql` | `stores`, `factory_store_access`, `user_stores`, `store_id` columns, `store_in_scope()`. Identity mapping (one store per factory) ⇒ **behaviour unchanged** | 🟢 |
| 60 | `60_rehla_common_store.sql` | **The only migration that changes what people see.** Merges the duplicated Rehla register into one shared store; makes `store_id` authoritative | 🔴 **snapshot** |
| 61 | `61_issue_store_item.sql` | Atomic issue/reserve/release RPC (fixes the lost-update race) + store-scoped RLS. **`fixed_assets` stays factory-scoped** | 🟡 |

**Why renaming is safe:** access is keyed on `plants.id` (uuid) — `user_plants`, RLS
`my_plant_ids()`, `profiles.plant_id`. The auth JWT carries only `{name, role_id}`.
No assignment changes, nothing is granted or revoked, and nobody re-logs in.

**The rule the store model turns on:** `store_id` = *where the stock is*;
`plant_id` / `requesting_plant_id` = *who owns the asset and who pays*. One
`factory_store_access` row per factory reproduces today's behaviour exactly,
which is why Sikandrabad and Ganjam are untouched.

## ⚠️ Tables that are NOT in the numbered files

These live only in `../supabase/migrations/` but the app actively uses them. They
**are** included in `00_full_setup.sql`. If you ever rebuild from the numbered
files alone, you must also apply these or Overview / CPM Stock / Audit Log /
BatchLogger / Anomaly Operations Center break:

- `tanks`, `cpm_drum_stock` (`0002_cpm_stock.sql`)
- `alerts` (`0003_alerts.sql`)
- `operator_sessions` (`0004_operator_sessions.sql`)
- `anomaly_flags` (`0007_anomaly_flags.sql`)
