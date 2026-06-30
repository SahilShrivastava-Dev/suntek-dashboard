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

## ⚠️ Tables that are NOT in the numbered files

These live only in `../supabase/migrations/` but the app actively uses them. They
**are** included in `00_full_setup.sql`. If you ever rebuild from the numbered
files alone, you must also apply these or Overview / CPM Stock / Audit Log /
BatchLogger / Anomaly Operations Center break:

- `tanks`, `cpm_drum_stock` (`0002_cpm_stock.sql`)
- `alerts` (`0003_alerts.sql`)
- `operator_sessions` (`0004_operator_sessions.sql`)
- `anomaly_flags` (`0007_anomaly_flags.sql`)
