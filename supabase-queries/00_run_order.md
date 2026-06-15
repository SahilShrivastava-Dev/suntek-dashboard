# Supabase Setup — Run Order

Run these scripts IN ORDER in Supabase SQL Editor (Dashboard → SQL Editor → New query).

| # | File | What it creates |
|---|------|-----------------|
| 1 | `01_core_plants.sql` | `plants` table — foundation, referenced by all other tables |
| 2 | `02_auth_profiles.sql` | `profiles` table — auth user metadata, links to plants |
| 3 | `03_notifications.sql` | `notifications` table + Realtime enabled |
| 4 | `04_operations.sql` | `active_batches`, `batch_readings`, `batch_edit_logs`, `shift_logs`, `device_mappings`, `unit_log_entries` |
| 5 | `05_stock.sql` | `stock_levels` |
| 6 | `06_purchase.sql` | `activity_logs`, `fixed_assets`, `store_requisitions`, `oil_contracts`, `marine_insurance`, `labour_costs` |
| 7 | `07_sales.sql` | `customers`, `sales_contracts` |
| 8 | `08_maintenance.sql` | `maintenance_schedules`, `maintenance_tickets`, `maintenance_store_requests` |

**After running all scripts:**
- Enable Realtime on `notifications` table:
  Database → Replication → Tables → toggle `notifications` ON
- All tables have `anon_all` RLS policies (open read/write for anon key — suitable for internal tools)
