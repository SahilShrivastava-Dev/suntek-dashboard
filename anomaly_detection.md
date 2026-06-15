# Anomaly Detection — CaratSense / Suntek Group

**Status:** Ideation document — not yet implemented  
**Scope:** What anomalies are detectable from current data, how to detect them, how to flag them  
**Tables referenced:** All Supabase tables as of 2026-06-10

---

## Quick read — what's feasible vs. what's hard

| Tier | Description | Examples |
|---|---|---|
| **Tier 1 — Easy** | Single-table, insert-triggered, rule-based threshold | Temperature spike, off-site GPS, recurring breakdown |
| **Tier 2 — Medium** | Rolling window query, needs 30+ days of baseline data | Batch yield drift, labour cost per output, customer going quiet |
| **Tier 3 — Hard** | Cross-table correlation with lag effects | Vendor switch → quality/revenue drop, high production + falling sales |

Tier 1 anomalies can be implemented immediately via Supabase Edge Functions triggered on row insert.  
Tier 2 needs a scheduled scan (pg_cron) and a minimum data volume before they're meaningful.  
Tier 3 is the highest business value but requires architectural decisions (see Tricky Flags section).

---

## Anomaly Catalog

### 1. Production

---

**A1 — Batch gravity / yield drop**  
*Table:* `batch_readings`, `active_batches`  
*Signal:* `final_gravity` or average `cp_gravity` for a closing batch is more than 8% below the trailing 10-batch average for the same plant  
*Why it matters:* Product quality degradation — could be raw material issue, process drift, or operator error  
*Notification:* Warning → admin, unit_head  
*Suggested action:* "Review last 3 batches for plant [X]. Check raw material batch from vendor [Y] received on [date]."  
*Tier:* 2 — needs batch history to establish baseline  
*Tricky flag:* Grade/recipe changes (e.g. switching from 1400 to 1500 density batches) will legitimately change gravity. The detector needs to group by recipe/density, not just plant.

---

**A2 — Batch temperature excursion**  
*Table:* `batch_readings`  
*Signal:* Any single `temp` reading exceeds plant-defined safe range (e.g. < 15°C or > 55°C)  
*Why it matters:* Process safety — abnormal temps can indicate equipment failure or measurement error  
*Notification:* Urgent → admin, unit_head, technician  
*Suggested action:* "Temp reading of [X]°C logged at [time] for batch [B]. Check sensor and equipment immediately."  
*Tier:* 1 — pure insert-triggered, no history needed  
*Tricky flag:* Needs plant-specific thresholds defined (not a global constant). If thresholds aren't configured, this misfires or can't fire.

---

**A3 — Hourly reading gap in daily log**  
*Table:* `unit_log_entries`  
*Signal:* On OCR upload, parse `readings` JSONB and find hours missing during the expected shift window  
*Why it matters:* Missing data could mean equipment downtime that wasn't logged, or the operator skipped recording  
*Notification:* Warning → admin, unit_head  
*Suggested action:* "Daily log for [unit] on [date] is missing hours [X]–[Y]. Verify shift recording."  
*Tier:* 1 — can run on insert, single table  
*Tricky flag:* You need to know what the "expected shift hours" are for each plant/unit. If shift schedules aren't stored, this is guesswork.

---

**A4 — Abnormal HCl consumption**  
*Table:* `active_batches`  
*Signal:* `hcl_quantity / target_qty` ratio for a closed batch exceeds 1.3x the plant average for same recipe  
*Why it matters:* Excess HCl use = cost overrun + possible process issue  
*Notification:* Warning → unit_head, admin  
*Tier:* 2 — needs baseline  
*Tricky flag:* hcl_quantity is stored at batch level, not as a time-series. A single anomalous batch could be a one-off. Better to flag on 2+ consecutive batches rather than a single occurrence.

---

**A5 — Batch cadence drop**  
*Table:* `active_batches`  
*Signal:* Rolling 7-day batch count per plant falls below 60% of the trailing 4-week average  
*Why it matters:* Fewer batches = lower output, could indicate unplanned downtime, labour shortage, or raw material shortage  
*Notification:* Warning → admin, unit_head  
*Tier:* 2 — needs 4+ weeks of batch history  

---

### 2. Sales & Revenue

---

**A6 — MTD revenue pace drop**  
*Table:* `sales_contracts`  
*Signal:* By day-of-month N, the cumulative (dispatched_qty × locked_price) is more than 20% below where the same metric was on day N last month  
*Why it matters:* Revenue shortfall — early warning before month-end miss  
*Notification:* Warning → admin  
*Suggested action:* "MTD revenue is tracking 22% below last month's pace. Review dispatch pipeline."  
*Tier:* 2 — needs prior month data  
*Tricky flag:* Month has different working days. Day-25 of Feb is not the same as day-25 of March. A working-day-adjusted pace is more accurate but harder to compute without a holiday calendar.

---

**A7 — Top customer going silent**  
*Table:* `sales_contracts`, `customers`  
*Signal:* A customer who placed orders in each of the last 3 months has no new contract or dispatch activity in 30 days  
*Why it matters:* At-risk customer — could be buying from a competitor, dispute, or financial trouble  
*Notification:* Warning → admin  
*Suggested action:* "No activity from [Customer X] in 30 days. Last order: [date]. Outstanding: ₹[Y]."  
*Tier:* 2 — needs order frequency history  
*Tricky flag:* Seasonal buyers (e.g. monsoon shutdowns) will false-positive. Need a "seasonal flag" on the customer record to suppress.

---

**A8 — Outstanding growing while dispatching**  
*Table:* `customers`, `sales_contracts`  
*Signal:* Customer `outstanding` grew by more than 30% MoM while `dispatched_qty` also increased  
*Why it matters:* Goods are being delivered but not paid for — credit risk accumulating  
*Notification:* Urgent → admin  
*Suggested action:* "Customer [X] has ₹[Y] outstanding (+38% MoM) but received [Z MT] this month. Consider holding next dispatch."  
*Tier:* 2  
*Tricky flag:* Outstanding is a snapshot field, not a time-series. To detect growth, you'd need to snapshot it periodically (a daily/weekly outstanding log table). Currently the table only stores the current value.

---

**A9 — Locked price significantly below recent average**  
*Table:* `sales_contracts`  
*Signal:* A new contract's `locked_price` is more than 12% below the average of the last 5 contracts for the same `density`  
*Why it matters:* Price undercutting — could be a mistake, a concession, or market signal  
*Notification:* Warning → admin  
*Suggested action:* "New contract for [Customer X] at ₹[P]/MT for density [D] — 14% below recent avg. Confirm pricing was intentional."  
*Tier:* 1 — insert-triggered, pure pricing comparison  

---

**A10 — Large open booking with zero dispatch**  
*Table:* `sales_contracts`  
*Signal:* Contract with `status='open'` and `booked_qty > threshold` has `dispatched_qty = 0` after 15 days  
*Why it matters:* Committed quantity not being dispatched — could be logistics, stock, or customer-side issue  
*Notification:* Warning → admin, unit_head  
*Tier:* 1 (if triggered on a daily scan) / Tier 2 (if requires history)  

---

### 3. Inventory / Stock

---

**A11 — Rapid stock depletion**  
*Table:* `stock_levels`  
*Signal:* Net `out` movement in last 7 days > 150% of average weekly outflow over prior 4 weeks, without matching production or approved sales dispatch  
*Why it matters:* Unexplained inventory drain — possible discrepancy, pilferage, or data error  
*Notification:* Urgent → admin, unit_head  
*Tier:* 2 — needs outflow history  

---

**A12 — Zero/near-zero stock with open sales**  
*Table:* `stock_levels`, `sales_contracts`  
*Signal:* Net stock for a product type approaches zero while there are open, undispatched sales contracts for that grade  
*Why it matters:* Dispatch failure risk — committed orders can't be fulfilled  
*Notification:* Urgent → admin, unit_head  
*Suggested action:* "CPM stock for [item] is critically low. [N] open contracts totalling [X MT] are at risk."  
*Tier:* 1 — can trigger on stock-out insert, cross-check sales table  
*Tricky flag:* `stock_levels` table stores individual movements, not a running balance. A current balance requires aggregating all 'in' minus all 'out' per item. This query needs to be efficient or pre-aggregated.

---

**A13 — Stock received without a PO**  
*Table:* `stock_levels`, `oil_contracts`  
*Signal:* Large stock-in movement for an oil type with no matching open `oil_contract` for that type in the same period  
*Why it matters:* Unauthorized procurement or recording error  
*Notification:* Warning → admin  
*Tier:* 1 — insert-triggered, cross-table check  
*Tricky flag:* The item naming between `stock_levels.item` and `oil_contracts.oil_type` needs to match exactly (or via a mapping table) for this check to work. Currently these are free text fields.

---

### 4. Procurement & Purchase

---

**A14 — Vendor switch with price jump** *(the user's example)*  
*Tables:* `oil_contracts`  
*Signal:* A new `oil_contract` row has a different `company` from the previous contract for the same `oil_type` AND the `price` is more than 10% higher  
*Why it matters:* Vendor switch is a business decision, but an unnoticed price increase at the switch is a cost leak  
*Notification:* Warning → admin, unit_head  
*Suggested action:* "Vendor for [oil_type] changed from [A] to [B]. Price went from ₹[X] to ₹[Y]/MT (+[Z]%). Review if this was approved."  
*Tier:* 1 — pure insert-triggered rule  

---

**A15 — Vendor switch followed by quality drop** *(the user's example, deeper version)*  
*Tables:* `oil_contracts`, `active_batches`, `batch_readings`  
*Signal:* After `company` changes in `oil_contracts` for a given `oil_type`, the trailing batch gravity readings for the same plant drop by > 8% over the next 14 days  
*Why it matters:* The new vendor's material quality is degrading production output  
*How to detect:* 
  1. Record "vendor change event" with date when A14 fires
  2. Start a 14-day watch window for quality metrics at that plant
  3. If quality metrics drop during the watch window, raise a correlated alert
*Notification:* Urgent → admin, unit_head  
*Suggested action:* "Production quality at [plant] dropped 11% in the 14 days following vendor switch from [A] to [B] on [date]. Consider reverting to prior vendor."  
*Tier:* 3 — **most complex anomaly in the catalog**  
*Tricky flag (multiple):*
  - Correlation ≠ causation. Quality could have dropped for other reasons (equipment, operator, recipe change) coincidentally
  - Oil from vendor B is likely mixed with existing tank stock for 1–2 weeks after receipt. The "pure" effect of vendor B material only appears after old stock is consumed (FIFO tank mixing problem)
  - The batch table doesn't have a direct reference to which oil_contract it consumed. The link is inferred by plant + timing, which is imprecise
  - Needs minimum 5 post-switch batches to have statistical meaning

---

**A16 — PO overdue — no dispatch received**  
*Table:* `oil_contracts`  
*Signal:* Contract with `status='open'` and `dispatched_qty = 0` and `date < (today - 15 days)`  
*Why it matters:* Supplier not delivering on time — will impact production planning  
*Notification:* Warning → admin, unit_head  
*Tier:* 1 — daily scan, simple date check  

---

**A17 — Fragmented buying (same item, multiple small POs)**  
*Table:* `oil_contracts`  
*Signal:* More than 3 contracts for the same `oil_type` and `company` created within 7 days, each for smaller quantities  
*Why it matters:* Possible approval limit circumvention, or procurement inefficiency  
*Notification:* Warning → admin  
*Tier:* 1 — insert-triggered  
*Tricky flag:* Threshold needs calibration. High-frequency small-batch buyers won't see this as anomalous.

---

**A18 — Labour cost per batch spiking**  
*Tables:* `labour_costs`, `active_batches`  
*Signal:* (Sum of labour_costs.amount for plant X in week W) / (batch count for plant X in week W) > 130% of the 4-week average for same plant  
*Why it matters:* Same output is costing more in labour — could be overtime, contractor rate changes, or low productivity  
*Notification:* Warning → admin  
*Tier:* 2 — weekly scan, needs baseline  
*Tricky flag:* `labour_costs` has `date` and `plant_id`. `active_batches` has `created_at` and `plant_id`. The join is by plant + date range. This works but is imprecise since a batch spans multiple days (start → close).

---

**A19 — Marine insurance fund running critically low**  
*Table:* `marine_insurance`  
*Signal:* Current balance (latest row's `balance` field) falls below 15% of last 3 months' average monthly claim + dispatch value  
*Why it matters:* Insurance fund insufficient to cover a potential loss event  
*Notification:* Warning → admin  
*Tier:* 1 — insert-triggered on 'claim' or 'adjustment' rows  
*Tricky flag:* The `balance` field is manually entered (not computed). If someone enters a wrong balance, the alert is based on wrong data. Ideally, balance should be computed from the ledger, not stored directly.

---

**A20 — Requisition queue building up**  
*Table:* `store_requisitions`  
*Signal:* More than 5 requisitions with `status='pending'` and `created_at < (now - 3 days)` at the same plant  
*Why it matters:* Operations blocked — store or purchase team not processing requests  
*Notification:* Warning → admin, unit_head  
*Tier:* 1 — daily scan  

---

### 5. Maintenance

---

**A21 — Recurring equipment breakdown** *(high value)*  
*Table:* `maintenance_tickets`  
*Signal:* When a new emergency ticket is created for `equipment` X, check if there are ≥ 2 other emergency tickets for the same equipment in the last 30 days at the same plant  
*Why it matters:* Chronic failure pattern — indicates the repair approach is wrong, part is failing repeatedly, or root cause hasn't been addressed  
*Notification:* Urgent → admin, unit_head  
*Suggested action:* "Equipment [X] has had [N] emergency breakdowns in 30 days. Consider root cause analysis or replacement rather than repair."  
*Tier:* 1 — insert-triggered, single-table lookup  
*This is one of the most actionable anomalies in the system*

---

**A22 — Multiple periodic tasks overdue simultaneously**  
*Table:* `maintenance_tickets`  
*Signal:* More than 3 periodic tickets with `due_date < today` and `status != 'closed'` at the same plant  
*Why it matters:* Scheduled maintenance backlog — equipment running without preventive care, failure risk rising  
*Notification:* Urgent → admin, unit_head  
*Suggested action:* "[N] scheduled maintenance tasks are overdue at plant [X]. Risk of unplanned breakdown is elevated."  
*Tier:* 1 — daily scan  

---

**A23 — Emergency ticket stuck in approval stage too long**  
*Table:* `maintenance_tickets`  
*Signal:* An emergency ticket has been in `pending_unit_head` or `pending_purchase` status for more than 4 days  
*Why it matters:* Approval bottleneck is extending equipment downtime  
*Notification:* Warning → admin, unit_head  
*Tier:* 1 — daily scan  

---

**A24 — Scrapping rate increasing**  
*Table:* `maintenance_tickets`  
*Signal:* Over the last 30 days, the ratio of `defective_part_decision = 'scrap'` to total resolved tickets exceeds 70%, compared to a 3-month average of < 50%  
*Why it matters:* High scrap rate = high replacement cost + suggests parts quality issue or heavy overuse  
*Notification:* Warning → admin, unit_head  
*Tier:* 2 — needs 90 days of closed ticket history  

---

**A25 — Spare parts store availability declining**  
*Table:* `maintenance_store_requests`  
*Signal:* In the last 30 days, more than 50% of store requests have `store_decision = 'unavailable'`  
*Why it matters:* Store inventory not aligned with maintenance needs — parts being procured externally more than expected (cost + delay)  
*Notification:* Warning → admin, unit_head  
*Suggested action:* "Store is fulfilling only [X]% of maintenance requests. Review spare parts stocking list."  
*Tier:* 2 — needs minimum 10 requests to be meaningful  

---

### 6. Operations & Shift

---

**A26 — Night check-in missed**  
*Table:* `shift_logs`  
*Signal:* No `shift_logs` row inserted for plant X between 10 PM and 4 AM on any working day  
*Why it matters:* Night manager not checking in — safety risk, no on-site oversight  
*Notification:* Urgent → admin, unit_head  
*Tier:* 1 — but requires a **scheduled/time-triggered scan**, not insert-triggered (detecting absence of data)  
*Tricky flag:* The biggest architectural difference — all other anomalies react to data being inserted. This one needs a cron job to run at (say) 2 AM and check if check-in happened. Cannot be done via a database insert trigger.

---

**A27 — Off-site GPS check-in**  
*Table:* `shift_logs`  
*Signal:* `is_on_site = false` on any inserted row  
*Why it matters:* Person claiming to be at plant is not there  
*Notification:* Urgent → admin, unit_head  
*Suggested action:* "Night check-in submitted from off-site location ([X]m from plant). GPS: [lat, lng]."  
*Tier:* 1 — insert-triggered, already partially handled by the check-in flow  

---

**A28 — Multiple consecutive off-site check-ins**  
*Table:* `shift_logs`  
*Signal:* Same `profile_id` has `is_on_site = false` for 3+ consecutive check-ins  
*Why it matters:* Systematic attendance fraud — not a one-off, a pattern  
*Notification:* Urgent → admin  
*Tier:* 1 — insert-triggered, check last 3 rows for profile  

---

### 7. Cross-metric Compound Anomalies

These are the richest signals but require multi-table queries and often a delay between cause and effect.

---

**A29 — High production + falling dispatch**  
*Tables:* `active_batches`, `sales_contracts`  
*Signal:* Rolling 2-week batch count is at or above average, but dispatched_qty in sales_contracts is 30%+ below the same period last month  
*Why it matters:* Production is running but goods aren't moving — possible logistics blockage, customer dispute, or market demand collapse  
*Notification:* Warning → admin  
*Suggested action:* "Plant producing at normal rate but dispatch is down 34% vs. last month. Stock is building. Check sales pipeline."  
*Tier:* 3 — cross-table, time-window correlation  

---

**A30 — Maintenance downtime coinciding with labour cost spike**  
*Tables:* `maintenance_tickets`, `labour_costs`  
*Signal:* During a period where one or more emergency tickets are in `pending_purchase` or `pending_handover` stage (equipment not running) for plant X, labour costs for plant X are above 110% of the weekly average  
*Why it matters:* Workers are present and being paid while equipment is down — idle cost  
*Notification:* Warning → admin  
*Suggested action:* "Equipment at [plant] has been down for [N] days (ticket #[ID]). Labour cost this period is [X]% above average."  
*Tier:* 3 — requires correlating ticket stage duration with labour cost dates, both at plant level  
*Tricky flag:* Maintenance ticket status doesn't have timestamps per stage (just created_at and closed_at). Would need to add stage-change timestamps to track "time spent in pending_purchase" precisely.

---

**A31 — Customer outstanding growing while dispatch continues**  
*Tables:* `customers`, `sales_contracts`  
*Signal:* Customer's `outstanding` increased month-over-month while `dispatched_qty` across their contracts also increased in the same period  
*Why it matters:* Continuing to ship to a non-paying customer — credit risk escalating  
*Notification:* Urgent → admin  
*Tier:* 2 — needs monthly outstanding snapshots (see Tricky Flags)  

---

**A32 — Blacklisted entity appearing in activity records**  
*Tables:* `blacklist`, `activity_logs`, `shift_logs`  
*Signal:* Text in `activity_logs.done_by` or `activity_logs.equipment` (for vehicles) matches an active blacklist entry's `name` or `identifier`  
*Why it matters:* A restricted entity is still being used operationally  
*Notification:* Urgent → admin, unit_head  
*Tier:* 1 — insert-triggered, cross-check against blacklist entries  

---

**A33 — Backdated data entry**  
*Tables:* Any table with separate `date`/`due_date` and `created_at` fields  
*Signal:* The entered `date` is more than 7 days before `created_at` (i.e., data is being entered retroactively)  
*Why it matters:* Possible data manipulation, late entry covering up a missed task or a missed delivery  
*Notification:* Warning → admin  
*Scope:* `activity_logs`, `labour_costs`, `shift_logs`, `batch_edit_logs`, `oil_contracts`  
*Tier:* 1 — insert-triggered per table  
*Tricky flag:* Not all backdated entries are suspicious (e.g., correcting an old mistake is legitimate). This should generate a "review" flag, not a critical alert. The distinction between legitimate correction and manipulation is a human judgement call.

---

## Tricky Flags — What Makes This Hard

### 1. Cold-start / baseline data problem
Every Tier 2+ anomaly requires historical data to compute a "normal" baseline. With a new system, the first 4–8 weeks of data are still establishing baselines. Enabling these detectors too early will flood admins with false positives and cause alert fatigue.

**Recommended approach:** Add a `min_data_points` guard to each detector. Don't fire until there are at least N rows of the relevant type. Display "Anomaly detection warming up — X data points needed" in the UI.

---

### 2. Lag effects (the vendor→quality problem)
The user's example is a canonical lag-effect anomaly: the cause (vendor switch) precedes the effect (quality drop) by days or weeks due to FIFO tank mixing. A simple "compare before/after on the switch date" will usually show no anomaly at day 0, then a real signal 10–14 days later.

**Recommended approach:** When A14 (vendor switch) fires, create a "watch record" in a new `anomaly_watches` table: `{ trigger_type, trigger_date, watch_until, plant_id, metric_to_watch, baseline_value }`. Run A15 daily during the watch window (not just on insert).

---

### 3. Detecting absence vs. detecting excess
All insert-triggered anomalies detect something *happening*. Several important anomalies are about something *not happening* (missed check-in, batch not started, PO not received). These require a completely different architecture: **scheduled scans** (pg_cron or Supabase Edge Function with a cron schedule).

Anomalies requiring scheduled scans: A5, A6, A7, A10, A16, A20, A22, A23, A26.

---

### 4. Alert fatigue throttling
If the same anomaly condition persists (e.g., equipment is still down after 7 days), the detector would re-fire the notification daily, creating noise. Need a cooldown window per anomaly type + entity combination.

**Recommended approach:** Before inserting a notification, check: has this exact `(anomaly_type, entity_id)` pair had a notification in the last N hours? If yes, suppress.

A dedicated `anomaly_log` table to track this: `{ id, anomaly_type, entity_id, entity_type, fired_at, cooldown_until, was_acknowledged }`.

---

### 5. Outstanding amount is not a time-series
The `customers.outstanding` field is a point-in-time snapshot. A31 (customer outstanding growing) requires comparing it over time, but the schema doesn't store outstanding history. Detecting growth requires either:
- (a) A daily snapshot job that writes to a `customer_outstanding_log` table, or
- (b) Computing outstanding from sales contract data (booked × price - paid) — which requires adding a `payments` table that doesn't exist yet

---

### 6. Cross-table free-text matching
Anomalies like A13 (stock received without PO) and A32 (blacklisted entity in activity) rely on matching free-text fields across tables (e.g., `stock_levels.item` vs `oil_contracts.oil_type`). These are both free text, so a minor spelling difference (`"Liquid Paraffin"` vs `"Liquid paraffin IP"`) breaks the match.

**Recommended approach:** Create a lookup/master list for item names and use IDs for cross-table joins rather than free text. Until then, use case-insensitive substring matching with manual review.

---

### 7. The vendor→production correlation needs a new data link
Currently, there's no column in `active_batches` or `batch_readings` that references which `oil_contract` supplied the raw material. The correlation in A15 is purely inferred by plant + timing, which breaks down when:
- Multiple vendors' material is in the tank simultaneously (FIFO mixing period)
- The plant uses stock that was received before the vendor switch

A proper implementation would require adding a `raw_material_batch_id` or `oil_contract_id` reference to `active_batches`. This is a schema change that would require production-side tracking changes.

---

## Implementation Blueprint

### Phase 1 — Insert-triggered (can build now)

| Anomaly | Trigger table | Action |
|---|---|---|
| A2 — Temperature excursion | `batch_readings` INSERT | Check temp vs threshold |
| A9 — Locked price below avg | `sales_contracts` INSERT | Compare to last 5 for same density |
| A14 — Vendor switch price jump | `oil_contracts` INSERT | Compare to prior contract for same oil_type |
| A16 — PO overdue | `oil_contracts` INSERT | Schedule a future check |
| A17 — Fragmented buying | `oil_contracts` INSERT | Count contracts in 7-day window |
| A21 — Recurring equipment breakdown | `maintenance_tickets` INSERT | Count tickets for same equipment in 30 days |
| A27 — Off-site GPS check-in | `shift_logs` INSERT | Check is_on_site flag |
| A28 — Multiple consecutive off-site | `shift_logs` INSERT | Check last 3 rows for same profile |
| A33 — Backdated entry | Multiple table INSERTs | Compare date vs created_at |

### Phase 2 — Scheduled scans (needs pg_cron or Edge Function cron)

| Anomaly | Scan frequency | Needs baseline? |
|---|---|---|
| A1 — Batch yield drop | On batch close | Yes (10 batches) |
| A4 — Abnormal HCl consumption | On batch close | Yes (10 batches) |
| A5 — Batch cadence drop | Weekly | Yes (4 weeks) |
| A6 — MTD revenue pace | Daily | Yes (prior month) |
| A7 — Customer going silent | Daily | Yes (3 months) |
| A10 — Open booking no dispatch | Daily | No |
| A20 — Requisition queue | Daily | No |
| A22 — Periodic overdue pile-up | Daily | No |
| A23 — Ticket stuck in approval | Daily | No |
| A25 — Store unavailability rate | Weekly | Yes (10+ requests) |
| A26 — Night check-in missed | Nightly 2 AM | No |

### Phase 3 — Complex correlations (architecture work required first)

| Anomaly | Prerequisite |
|---|---|
| A15 — Vendor switch → quality drop | `anomaly_watches` table + watch window runner + A14 fired |
| A18 — Labour cost per batch | Labour timing aligned with batch periods |
| A29 — High production + falling dispatch | Define "normal" dispatch/production ratio |
| A30 — Downtime + labour cost spike | Stage-change timestamps in maintenance_tickets |
| A31 — Customer outstanding growing | `customer_outstanding_log` or `payments` table |

---

## Proposed Notification Schema Extension

Current `notifications` table already has `target_roles`, `type`, `body`, `route`. Add these fields for anomaly notifications:

```sql
alter table notifications
  add column if not exists anomaly_type    text,   -- e.g. 'A21_recurring_breakdown'
  add column if not exists entity_id       text,   -- the equipment name, customer id, etc.
  add column if not exists entity_type     text,   -- 'equipment' | 'customer' | 'vendor' | 'batch'
  add column if not exists cooldown_until  timestamptz,  -- don't re-fire until this time
  add column if not exists auto_resolved   boolean default false;  -- cleared by scheduled check
```

And a dedicated `anomaly_log` table for throttling and history:

```sql
create table if not exists anomaly_log (
  id            uuid primary key default gen_random_uuid(),
  anomaly_type  text not null,
  entity_id     text,
  entity_type   text,
  severity      text,
  detail        jsonb,
  fired_at      timestamptz default now(),
  cooldown_until timestamptz,
  acknowledged  boolean default false,
  acknowledged_by text,
  acknowledged_at timestamptz
);
```

---

## Summary — Top 5 to build first (highest ROI, lowest complexity)

1. **A21 — Recurring equipment breakdown** — Single-table insert trigger. Extremely high operational value for a manufacturing plant. Simple to build.

2. **A14 — Vendor switch with price jump** — Insert trigger on oil_contracts. Catches cost leaks at the moment they're created.

3. **A27/A28 — Off-site GPS check-in** — Already partially in the system logic. Making it generate a formal anomaly notification is low effort.

4. **A22 — Multiple periodic tasks overdue** — Daily scan, no baseline needed. Prevents the "maintenance backlog" failure mode.

5. **A9 — Locked price below recent average** — Insert trigger on sales_contracts. Prevents accidental under-pricing, especially useful when junior staff are creating contracts.
