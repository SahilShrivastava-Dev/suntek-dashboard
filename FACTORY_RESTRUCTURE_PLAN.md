# Implementation Plan — Location / Factory / Shared-Store Model

**Branch:** `feature/factory-location-store-model`
**Companion:** `FACTORY_RESTRUCTURE_AUDIT.md` (read-only audit, 2026-07-28)
**Status:** 📋 **PLAN ONLY — nothing implemented.** No migration written, no schema changed, no data touched.

---

## 1. Goal

Support the client's confirmed structure — **3 states → 3 locations → 5 factories**, with the three Rehla factories sharing **one store** while keeping **separate FAR** and **separate maintenance** — without changing any existing behaviour for Sikandrabad or Ganjam, and without altering a single existing user permission.

### 1.1 In scope

- `locations` master (state + location) and a location tier on `plants`
- Rename the 4 existing factories; create `SPPL(K) – Rehla`; retire 3 dead records
- `stores` + `factory_store_access` — many-to-many, replacing the implicit store ≡ plant identity
- Split the overloaded `plant_id` into `source_store_id` (where stock is) + `requesting_plant_id` (who pays)
- `user_stores` — store access as a dimension separate from factory access
- De-duplicate the 434 double-loaded store items and the 324 double-loaded FAR assets
- Atomic stock issue (fixes the lost-update race)
- Location-level and factory-level dashboard views

### 1.2 Explicitly NOT in scope

- ❌ Any change to how users are assigned to factories or roles (§2.1)
- ❌ BUSY ERP master data — customer/supplier names keep their `(SHD)` / `(Rehla)` suffixes
- ❌ Plant-scoping the BUSY-sourced Sales / Customers / Purchase-value reports (pre-existing gap, separate project)
- ❌ Phase 2b/2c RLS (notifications, L1 batch tables, sales/customers) — pre-existing, unrelated
- ❌ Renaming role ids (`technician_shd`, `accountant_delhi`, `store_manager_chlorides`) — they encode legacy names but are not plant references; renaming them is churn with no benefit

---

## 2. Locked decisions

### 2.1 🔒 Existing functionality does not change

Carried forward verbatim from audit §12, and binding on every task below:

1. `user_plants` and `user_roles` keep their exact semantics. Multi-factory and multi-role assignment behave identically before and after.
2. `plants.id` is immutable. Renames touch `plants.name` only. **No plant row is ever `DELETE`d** — retirement means `is_factory = false` / `is_active = false` plus an entry in `legacy_names`.
3. The permission migration is **additive only**. `user_stores` is backfilled from `user_plants` so day-one effective access is byte-for-byte what it is today. Nothing revoked, nothing granted.
4. New State/Location pickers are **filters** over the existing factory multi-select. The write to `user_plants` is unchanged.
5. `is_global`, tiers, capabilities and password step-up untouched.
6. **`factory_store_access` with one row per factory ⇒ today's behaviour exactly.** Sikandrabad and Ganjam change in zero code paths.
7. No re-login, no session invalidation, no token change, for any user, at any point.
8. Regression test R-1 (non-shared store behaves identically) is a **release gate**.

### 2.2 Confirmed by the client diagram

| | |
|---|---|
| Factory count | **5** (not 6) |
| Hierarchy | State → Location → Company → Factory |
| Rehla | 2 companies (SCPL, SPPL); 3 operational entities (SCPL, SPPL, SPPL(K)) |
| Store | **Common for all 3 at Rehla** |
| FAR | **Different for all 3** |
| Maintenance | **Different for all 3** |
| Spellings | `Sikandrabad`, `Rehla` |

### 2.3 Confirmed by the audit

| Decision | Why |
|---|---|
| **SPPL(K) is a `plants` row, not a `units` row** | `fixed_assets` and `maintenance_schedules` have **no `unit_id` column**. As a plant it inherits the already-live `plant_in_scope()` RLS for free; as a unit it would need new columns, new policies, and importer rewrites. |
| **Renaming is safe for permissions** | `user_plants.plant_id` is a UUID FK; JWT carries only `{name, role_id}`; no re-login needed. |
| **`units` stays as-is** | It exists for the Chlorides / Plasticiser procurement sub-divisions. Unrelated. |
| **Fix the FAR-picker leak first** | `Maintenance.tsx:812` falls back to showing *all* assets when a plant-name lookup fails — a live violation of "assets of one factory must not appear under another", independent of this project. |
| **Stock issue must become an atomic RPC** | `Maintenance.tsx:1739-1744` is a client-side read-modify-write. Harmless-ish with private registers; a live lost-update bug the moment three factories share one row. |

---

## 3. ❓ Questions for you

Grouped by whether they block. **Where I have a recommendation I've marked it — you can reply "agree" and skip the question.**

### 3.1 🔴 Blocking — work cannot finish without these

**Q1. Who owns which of the 324 Rehla assets?**
`Fixed Assets Register-SPPL.xlsx` has **no entity column**, and the identification marks are bare (`GLC1`…`GLC16`). Nothing in any file distinguishes an SCPL asset from an SPPL or SPPL(K) one.
*Needed:* the register back with an owner against each row. A spreadsheet column is fine.
*Blocks:* FAR split, maintenance split, tests M-2/M-3/M-4/F-1. **Everything else in this plan can proceed without it** — so please don't let this hold up a start.

**Q2. What is `SCPL Delhi`, and where does its history belong?**
Your diagram lists no Delhi factory, yet this record holds **331 FAR rows, 242 tickets, 241 schedules** — identical to SPPL's. My hypothesis: it *is* the Rehla FAR, mis-filed under a Delhi label. Confirm before I remap anything; it cannot simply be retired.

### 3.2 🟠 Important — shape the design, needed before Phase C

**Q3. Bulk-purchase surplus — who owns the excess?**
SCPL – Rehla is short 10 gaskets. Purchase buys 100 (better rate). 10 go to the ticket, **90 land in the Common Store**. Tomorrow SPPL(K) draws 5 of them.
- (a) Common stock from the moment it lands. SCPL is charged only its 10; the other 90 are unallocated until consumed, and charged to whoever consumes them. **← my recommendation**
- (b) SCPL owns all 100; SPPL(K)'s 5 create an inter-factory transfer.
Worked through in §6.

**Q4. 🔴 Inter-company movement — SCPL and SPPL are different legal entities.**
This is the one that worries me most, and it is an accounting/statutory question, not a software one. If stock purchased on **SCPL's** GSTIN is consumed by **SPPL(K)**, that may be a taxable supply between distinct persons under GST. The codebase already handles GSTINs on supplier bills (`src/lib/utils/gst.ts`).
- (a) Out of scope — the shared store is an operational convenience; your accountants handle it outside the system. **← my recommendation for v1**, with the system providing a *"consumption by factory vs. purchase by factory"* reconciliation report so they have the numbers.
- (b) In scope — the system must generate inter-company transfer records.
**Please check with your accountant before answering.** (b) is a materially bigger build.

**Q5. Repaired part — back to the common pool, or reserved for the payer?**
SPPL(K) paid for the seal and paid to repair it. On return:
- (a) Back into the common pool; the repair cost stays charged to SPPL(K). **← my recommendation** — the part was never SPPL(K)'s property, it was common stock issued to an SPPL(K) job. Keeping *stock always common, cost always factory-attributed* is the one rule that keeps the model comprehensible.
- (b) Reserved for SPPL(K) — implementable via `reserved_for_plant_id`, but it complicates every stock query permanently.

**Q6. Reservations — can three factories be promised the same last unit?**
Today stock is deducted only at **handover**, not at request. With private registers that's fine. With one shared row, three technicians can each be told "1 in stock" for the same unit.
- (a) Add a soft reservation at approval time (`reserved_qty`, available = `on_hand − reserved_qty`). **← my recommendation**
- (b) Leave as-is; whoever reaches handover first wins, the others fall through to procurement.

**Q7. Opening-stock reconciliation.** The `Rehla` and `SPPL` copies are 434-for-434 identical *by item name*. Before merging I must confirm the **quantities** — are they genuinely one register entered twice, or has one drifted? Which is authoritative? I'll produce a variance report first (§5, Task C-2) and will not merge until you sign it off.

**Q8. Monthly Store Keeping workbook.** `store_stock_uploads` is `unique(plant_id, period_month)` — one upload per plant per month. Your file is a single **`Store Keeping 26-27 Jharkhand.xlsx`**. Going forward: one Jharkhand file uploaded once against the Common Store *(my recommendation — it matches how you already work)*, or separate files per entity?

### 3.3 🟡 Visibility & approvals

**Q9. Can a Rehla unit head see the whole common register, or only their own consumption?**
*Recommendation:* full register readable by all three (they share a physical store; knowing the last 3 seals are gone is operationally necessary), but **consumption and cost filtered to their own factory**.

**Q10. Who approves a purchase for the common store?** Each factory's unit head for their own request, or one Rehla-level purchase authority? *Recommendation:* keep today's flow — the requesting factory's unit head approves, since the cost lands on that factory.

**Q11. Should the store keeper have any factory access at all?**
In my design Mukesh has `user_stores` only and **zero** `user_plants` — he sees the part queue for all three, and none of their FARs. Confirm that matches how the job actually works, or tell me which factory he also belongs to.

### 3.4 🟢 Naming & cleanup — quick answers

**Q12.** Display as `SPPL(K) – Rehla` or `SPPLK – Rehla`? And what does **(K)** stand for — a village or section name worth storing?
**Q13.** `Madan chemical` (your diagram) or `Madan Chemicals Pvt Ltd` (your FAR workbook) on screen?
**Q14.** Is `SHD` the same site as `Madan`? BUSY uses `SHD` as the suffix for UP/NCR customers and Ghaziabad neighbours Sikandrabad. `SHD` holds only 2 rows, so merging is cheap. *Recommendation:* merge into Madan.
**Q15.** Retire `K.G`, `SCPL Odisha` (duplicate of Ganjam), and flag `HQ` non-factory? *Recommendation:* yes to all three. And — where is `M.G`? You've mentioned it but no such record exists.

### 3.5 ⚪ Rollout — answer later

**Q16.** Phased or big-bang? *Recommendation:* **phased.** Phases A–B (rename + hierarchy) are low-risk and shippable on their own; Phase C (store merge) is the risky one and can follow weeks later.
**Q17.** Is there a low-activity window at Rehla for the store merge? It needs a quiet period and a fresh snapshot.
**Q18.** Who runs UAT — Mukesh for the store flow, Naresh/Ashok for unit-head approval?

---

## 4. Target data model

```sql
create table locations (
  id uuid primary key default gen_random_uuid(),
  state text not null,                      -- 'Jharkhand'
  name  text not null,                      -- 'Rehla'
  code  text unique,                        -- 'REHLA'   ← stable technical key
  unique (state, name)
);

alter table plants                          -- ADD ONLY. id and every FK untouched.
  add column location_id  uuid references locations(id),
  add column company_name text,             -- 'Suntek Plasticizer Private Limited'
  add column entity_name  text,             -- 'SPPL(K)'
  add column factory_code text unique,      -- 'SPPLK_REHLA'  ← never displayed
  add column legacy_names text[],           -- {'SPPL','Rehla'} → alias search
  add column is_factory   boolean default true;

create table stores (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  name text not null,                       -- 'Rehla Common Store'
  code text unique                          -- 'REHLA_COMMON'
);

create table factory_store_access (         -- factory ↔ store, many-to-many
  plant_id uuid references plants(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  primary key (plant_id, store_id)
);

create table user_stores (                  -- store access ≠ factory access
  user_account_id uuid references user_accounts(id) on delete cascade,
  store_id        uuid references stores(id) on delete cascade,
  primary key (user_account_id, store_id)
);

-- Split the overloaded plant_id
alter table store_items                 add column store_id uuid references stores(id);
alter table store_stock_events          add column store_id uuid references stores(id),
                                        add column requesting_plant_id uuid references plants(id);
alter table maintenance_store_requests  add column source_store_id uuid references stores(id);
alter table store_stock_uploads         add column store_id uuid references stores(id);
alter table stock_purchase_receipts     add column store_id uuid references stores(id);
alter table repair_return_receipts      add column store_id uuid references stores(id);
-- plant_id RETAINED on all of the above through the transition (dual-write).
```

**The governing rule, stated once:**

> **`store_id` answers "where is the stock". `plant_id` / `requesting_plant_id` answers "who owns the asset and who pays".**
> Today one column does both jobs, which is exactly why the DB holds two identical copies of the Rehla store.

New RLS predicate, mirroring the existing `plant_in_scope()`:

```sql
create or replace function public.store_in_scope(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_global_user()
      or (p_store is not null and exists (
            select 1 from user_stores us
             join user_accounts ua on ua.id = us.user_account_id
            where ua.auth_user_id = auth.uid() and us.store_id = p_store));
$$;
```

Applied so that **store access grants the part queue, never the asset register**:

```sql
-- maintenance_store_requests: my factory's ticket, OR my store
using (ticket_in_scope(ticket_id) OR store_in_scope(source_store_id))

-- maintenance_tickets: my factory, OR a ticket drawing on my store
using (plant_unit_in_scope(plant_id, unit_id)
       OR exists (select 1 from maintenance_store_requests r
                   where r.ticket_id = maintenance_tickets.id
                     and store_in_scope(r.source_store_id)))

-- store_items / store_stock_events / uploads → store_in_scope(store_id)
-- fixed_assets → UNCHANGED, plant_in_scope(plant_id) only.   ← the whole point
```

---

## 5. Phased implementation

Ordered so every phase is independently shippable and independently reversible, with the risky work last. **Phases A and B deliver the rename you asked for and can go live without Phase C.**

### Phase A — Hierarchy (additive, zero behaviour change)

| Task | Deliverable |
|---|---|
| A-1 | `57_locations.sql` — `locations` table; new `plants` columns; backfill the 3 locations and company/entity fields |
| A-2 | `PlantScopeContext` exposes `locations` + `plants.location_id`; no consumer changes yet |
| A-3 | Unit tests for the location resolver |

*Ships nothing user-visible. Fully reversible by dropping the table and columns.*

### Phase B — Naming + frontend hardening (the rename)

| Task | Deliverable |
|---|---|
| B-1 | **Fix the FAR-picker leak** — `Maintenance.tsx:778,812`: scope the `fixed_assets` fetch, remove the show-all fallback |
| B-2 | Replace name-based form state with ids — `Maintenance.tsx:809` (`dbPlants.find(p => p.name === …)`) |
| B-3 | Remove hardcoded plant arrays — `PurchaseOrders.tsx:60` **(live dropdown, not a fallback)**, `FAR.tsx:232`, `ActivityLog.tsx:82`, `StoreRequisitions.tsx:47`, `Maintenance.tsx:797`; fix `'SHD'` form defaults |
| B-4 | Drive `CheckIn.tsx:12-15` from `plants` (currently hardcoded `'Rehla (SCPL)'` + coords); load real coordinates — 7 of 9 plants are geographically wrong today |
| B-5 | `58_rename_plants.sql` — rename the 4 factories; create `SPPL(K) – Rehla`; retire `SHD`/`K.G`/`SCPL Odisha`; flag `HQ`/`SCPL Delhi` non-factory; backfill `user_accounts.plant_name`, `anomaly_flags.plant`, `oil_contracts.plant_id`; populate `legacy_names` |
| B-6 | Alias search — Cmd+K matches `legacy_names` so "Rehla" still finds `SCPL – Rehla` |
| B-7 | Location tier in dashboard filters; consolidated Rehla view |

**B-1 through B-4 must land before B-5** so nothing depends on the old strings at the moment they change.

*Reversible: `59_rollback_rename.sql` restores names from `legacy_names`; frontend by `git revert`.*

### Phase C — Shared store 🔴 highest risk

| Task | Deliverable |
|---|---|
| C-1 | `60_stores.sql` — `stores`, `factory_store_access`, `user_stores`, the new columns, `store_in_scope()`. **Backfill one store per existing factory (identity mapping ⇒ behaviour unchanged).** Backfill `user_stores` from `user_plants`. |
| C-2 | **Variance report (read-only)** — `Rehla` vs `SPPL` store copies, item by item, quantity by quantity. **Client sign-off gate. No merge until Q7 is answered.** |
| C-3 | `61_merge_rehla_store.sql` — create `Rehla Common Store`; merge the two 434-item copies per the signed-off reconciliation; map all 3 factories via `factory_store_access`. **Full table snapshot first.** |
| C-4 | `62_issue_store_item.sql` — atomic `SECURITY DEFINER` issue RPC; switch `Maintenance.tsx:1739` to it |
| C-5 | Read stock by `store_id` — `Maintenance.tsx:770`, `StockRegister`, `AddPurchaseModal`, `RepairReturnModal` |
| C-6 | Split RLS: store tables → `store_in_scope`; tickets/requests → `OR store_in_scope`; **`fixed_assets` untouched** |
| C-7 | Store multi-select in User Management (independent of the factory multi-select) |
| C-8 | Reservations, if Q6 = (a) |
| C-9 | Monthly upload against `store_id`, per Q8 |

### Phase D — FAR split 🔴 blocked on Q1

| Task | Deliverable |
|---|---|
| D-1 | Import the client's marked-up ownership column |
| D-2 | `63_far_remap.sql` — remap `fixed_assets.plant_id` to SCPL / SPPL / SPPL(K); retire duplicates by flag, never delete |
| D-3 | Same for `maintenance_schedules` (the PM register — SPPLK equipment currently sits inside the SPPL workbook) |
| D-4 | Remove the multi-factory `flatMap` from the FAR importer (`FAR.tsx:472`) — the root cause of the duplication |

### Phase E — Reporting

| Task | Deliverable |
|---|---|
| E-1 | Store Stock Report grouped by `store_id` — one consolidated Rehla register |
| E-2 | Factory Consumption + Maintenance Cost grouped by `requesting_plant_id` |
| E-3 | Location-level rollup; consolidated vs individual Rehla views |
| E-4 | Purchase-vs-consumption reconciliation by factory (the report that answers Q4 for your accountants) |

---

## 6. Worked example #2 — a stock-out at SCPL – Rehla, and a bulk buy

*(Appendix A of the audit walks the in-stock path for an SPPL(K) ticket. This one takes the other branch — the part is **not** in stock — because that is where the money questions live.)*

### The situation

Naresh's technician at **SCPL – Rehla** raises a ticket for a leaking flange on **Heat Exchanger HX-03** (SCPL's FAR). He needs **10 × Gasket 6" spiral wound**. The Common Store has **4**.

### Step 1 — Request, against the common store

```sql
INSERT INTO maintenance_store_requests
  (ticket_id, part_name,   quantity, plant_id,       source_store_id,       store_item_id)
VALUES
  («#B14»,   'Gasket 6"',  10,      «SCPL – Rehla», «Rehla Common Store»,  «the ONE gasket row»);
```

Mukesh sees `on_hand = 4` against a request for 10 and marks it **partially available**.

### Step 2 — The split (migration 40, unchanged)

The existing split-fulfilment logic fires and creates two rows tied by `split_group`:

| Track | Qty | Path |
|---|---|---|
| **In-store** | 4 | store → unit head → handover *(fast)* |
| **Procurement** | 6 | unit head → purchase → bill → handover *(slow)* |

Both rows carry `plant_id = SCPL – Rehla` and `source_store_id = Rehla Common Store`. **This logic needs no changes** — it already works per-request; it just now points at a store instead of a plant.

### Step 3 — In-store track: 4 issued

```sql
UPDATE store_items SET on_hand = on_hand - 4, issued_qty = issued_qty + 4
 WHERE id = «gasket»;                                            -- 4 → 0

INSERT INTO store_stock_events (item_id, store_id, requesting_plant_id, event_type, qty_delta, ref)
VALUES («gasket», «Rehla Common Store», «SCPL – Rehla», 'issue', -4, 'ticket #B14');
```

**⚠️ Q6 in action.** The register now reads 0. If SPPL(K) had raised a request for the same gasket an hour earlier and not yet reached handover, they were told "4 in stock" and will now hit a stock-out at handover. With private registers this could not happen; with a shared register it will. That's why I recommend soft reservations.

### Step 4 — Procurement track: buy 100, need 6

Rupesh sources them and gets a much better rate at 100. He records the purchase against the **store**, and the ticket's need against the **factory**:

```sql
-- apply_stock_purchase() — already atomic (migration 53), extended with store_id
INSERT INTO stock_purchase_receipts
  (store_id,              plant_id,        vendor_name,  invoice_no, amount, gst_no)
VALUES
  («Rehla Common Store», «SCPL – Rehla»,  'Sealtech',   'ST/1182',  47200,  '20AABCS…');

UPDATE store_items
   SET procured_qty        = procured_qty + 94,   -- 94 to stock
       ticket_procured_qty = ticket_procured_qty + 6,   -- 6 straight to the technician
       on_hand             = on_hand + 94
 WHERE id = «gasket»;                                    -- 0 → 94
```

**Here is Q3, concretely.** 94 gaskets now sit in the Common Store, bought on SCPL's invoice and SCPL's GSTIN.

**Under my recommended (a):**

| | Charged to |
|---|---|
| 4 issued from stock | SCPL – Rehla |
| 6 bought for the ticket | SCPL – Rehla |
| **94 surplus in the store** | **nobody yet — charged on consumption** |

Next week SPPL(K) draws 5:

```sql
INSERT INTO store_stock_events (item_id, store_id, requesting_plant_id, event_type, qty_delta)
VALUES («gasket», «Rehla Common Store», «SPPL(K) – Rehla», 'issue', -5);
```

Maintenance cost report: **SCPL charged for 10, SPPL(K) charged for 5.** Clean, and it needs no new concept — the same `requesting_plant_id` column already carries it.

**But the reconciliation report (E-4) will show a gap**, and this is exactly what your accountants need to see:

| Factory | Purchased (₹) | Consumed (₹) | Variance |
|---|---|---|---|
| SCPL – Rehla | 47,200 (100 units) | 4,720 (10 units) | **+42,480 held in common stock** |
| SPPL(K) – Rehla | 0 | 2,360 (5 units) | **−2,360 consumed, not purchased** |

**That variance line is Q4.** SCPL and SPPL are different legal entities with different GSTINs. Physical goods bought by SCPL are being consumed by SPPL(K). Whether that needs an inter-company transfer document is an accounting call, not a software one — but the system must at minimum *surface the number*, which is why E-4 is in the plan regardless of how you answer.

### Step 5 — Handover and close

The 4 in-store gaskets and the 6 purchased ones reach the technician; both `split_group` rows hit `pending_handover` independently and the ticket proceeds to `pending_defective_return` → `closed`. Ticket ownership stays `SCPL – Rehla` throughout. **SPPL and SPPL(K) never see ticket #B14, HX-03, or SCPL's FAR** — only Mukesh saw the part line, and only because it drew on his store.

### 6.1 Secondary flow — the monthly Jharkhand workbook

Today `store_stock_uploads` is `unique(plant_id, period_month)`, so the single **`Store Keeping 26-27 Jharkhand.xlsx`** has to be uploaded twice — once as `Rehla`, once as `SPPL`. **That is the mechanical cause of the 434-item duplication.**

After Phase C, `store_id` replaces `plant_id` in that key: **one file, uploaded once, against `Rehla Common Store`.** It reconciles against one register, produces one month-over-month anomaly tally, and cannot double-count. Sikandrabad and Ganjam keep uploading exactly as they do today, against their own single stores.

This is a good illustration of the general shape of this project: **most of it removes a workaround rather than adding a feature.**

---

## 7. Testing

Run only in an isolated environment against a production-data **copy**. Nothing below runs against live.

| ID | Scenario | Pass criteria |
|---|---|---|
| **R-1** 🚦 | **Regression: Ganjam (non-shared store)** | Inventory, FAR, maintenance, users, reports, dashboards **byte-for-byte identical** before/after. **Release gate.** |
| R-2 | Regression: Sikandrabad | As R-1 |
| N-1 | Rename propagation | New name in user forms, profiles, filters, FAR, maintenance, stores, reports, exports, APIs, notifications. **Record every screen still showing the old name.** |
| N-2 | Permissions after rename | Every assignment intact; no user loses or gains a factory; **no re-login prompted** |
| N-3 | Alias search | Cmd+K "Rehla" still finds `SCPL – Rehla` |
| S-1 | Shared store, single copy | 3 factories mapped; **stock exists once**; no duplication |
| S-2 | Issue records requesting factory | Every `store_stock_events` row carries both `store_id` and `requesting_plant_id` |
| **S-3** | **Concurrent consumption** | Two factories issue the same item simultaneously → **no lost update, no oversell, both attributed correctly**. *Expected to FAIL pre-C-4.* |
| S-4 | Shortage | Negative stock prevented; no partial transaction; clear error |
| S-5 | Bulk surplus | Excess lands in the common store; consumption charged per Q3 |
| M-1 | SPPL(K) ticket, in stock | Audit Appendix A end to end |
| M-2 | SCPL ticket, stock-out | §6 end to end — split, bulk buy, attribution |
| M-3 | SPPL ticket | Cannot select SCPL or SPPL(K) assets |
| M-4 | SPPL(K) has its own FAR + history | Isolated from both siblings |
| **F-1** | **FAR isolation under shared store** | Store access does **not** expose another factory's FAR — via UI **and via direct API call** |
| U-1 | Single-factory user | SPPL(K) only; common store accessible; SCPL/SPPL FAR hidden; dashboard limited to SPPL(K) |
| U-2 | Store operator (Mukesh) | Processes issues for all 3; every issue records the requester; **no FAR access, no approval rights** |
| U-3 | Multi-factory user | SCPL + SPPL visible, SPPL(K) hidden; consolidation covers only authorised factories |
| U-4 | Ganjam isolation | `SCPL – Ganjam` user cannot see `SCPL – Rehla` **despite the shared entity name** |
| D-1 | Dashboard grouping | Location and factory views both work; common stock shown **once**; consumption factory-attributed |
| D-2 | Dashboard permissions | Unauthorised factories invisible; **dashboard APIs equally gated** |

---

## 8. Rollback

Every migration ships with a paired rollback, matching this repo's existing convention (`28_rollback_rls_phase2a.sql`, `37_rollback_store_stock.sql`, `53_rollback_stock_purchases.sql`).

| Phase | Rollback |
|---|---|
| A | `drop table locations` / `drop column` — additive only |
| B (frontend) | `git revert` |
| B-5 (rename) | `59_rollback_rename.sql` restores names from `plants.legacy_names` |
| C-1 | Drop the new tables and columns; `plant_id` still populated throughout |
| **C-3 (merge)** | 🔴 **Snapshot first:** `create table store_items_backup_YYYYMMDD as select * from store_items;` (same for `store_stock_months`, `store_stock_events`). Restore by truncate + reinsert. |
| C-4 | Drop the RPC, revert the client call |
| C-6 | Restore `plant_in_scope` on the store tables |
| **D-2 (FAR remap)** | 🔴 Snapshot `fixed_assets` first; restore by truncate + reinsert |

**Because `plants.id` is never mutated and no row is ever deleted, Phases A, B, C-1, C-4 and C-6 revert independently and in any order.** Only C-3 and D-2 are ordered and snapshot-dependent.

---

## 9. Sequencing

| Gate | Needs | Unblocks |
|---|---|---|
| **G0** | Q12–Q15 (naming) | Phase A + B — **can start immediately** |
| **G1** | Q2 (`SCPL Delhi`) | B-5 retirement decisions |
| **G2** | Q3–Q6 (store model), Q9–Q11 (access) | Phase C design |
| **G3** | Q7 sign-off on the C-2 variance report | C-3 merge |
| **G4** | Q1 (marked-up FAR) | Phase D |

**Phases A and B need only G0 and G1** — four quick naming answers plus a decision on `SCPL Delhi`. That's the rename you originally asked about, it is low-risk, and it can ship long before the store work is designed.

---

## 10. Status

- ✅ Branch `feature/factory-location-store-model` created
- ✅ Audit + this plan committed to it
- ⏸️ **No migration written. No schema changed. No data touched. No code modified.**
- ⏸️ Awaiting answers to §3 and your approval to begin Phase A.
