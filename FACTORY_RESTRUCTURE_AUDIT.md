# Factory / Location / Store Restructure — Read-Only Audit Report

**Date:** 2026-07-28
**Scope:** Suntek dashboard (`suntek-dashboard`, branch `feature/ui-redesign`), Supabase schema (`supabase-queries/*.sql`, 56 migrations), edge functions, BUSY-backed API server, and the handover DB snapshot `demo_backup_2026-07-23.sql`.
**Mode:** READ-ONLY. Nothing was committed, pushed, deployed, migrated, renamed, or modified. No production users, roles, permissions, or configuration were touched. No test environment was provisioned (see §14 — test execution is deferred to Phase 9, post-approval).

---

## 0. Two things to settle before reading further

### 0.1 Client diagram — received and transcribed

The handwritten org note reads, verbatim:

```
① UP:  Sikandrabad.
   company: Madan chemical.

② Odisha:  Ganjam.
   company: SCPL

③ Jharkhand:  Rehla
   companies: SCPL and SPPL
                      ↙        ↘
                   SPPL      SPPL(K)

   – Store is common for all 3.
   – FAR different for all 3.
   – maintenance different for all 3.
```

**This is authoritative and it settles six of the twelve open questions.** What it changes versus the original brief:

| Item | Original brief said | Diagram says | Effect |
|---|---|---|---|
| UP location spelling | "Sikandarabad" | **`Sikandrabad`** (no second *a*) | Use the client's spelling |
| UP company | "Madan Chemicals" | **`Madan chemical`** (singular) | ⚠️ Conflicts with the client's own FAR file, which says `Madan Chemicals Pvt Ltd`. One question remains (§13.1) |
| Jharkhand spelling | "Rehla" or "Rahela" | **`Rehla`** | ✅ Confirmed |
| Third Rehla entity | "SPPLK" — peer of SCPL/SPPL | **`SPPL(K)`** — a *child of SPPL* | 🔴 **Changes the hierarchy** — see §0.3 |
| Factory count | "five or six?" | **Five** | ✅ **Resolved — see §5** |
| Rehla store | "proposed" | **"Store is common for all 3"** | ✅ Confirmed requirement |
| Rehla FAR + maintenance | "proposed" | **"different for all 3"** | ✅ Confirmed requirement |

The diagram is silent on `SCPL Delhi`, `K.G`, `M.G`, `SHD`, `SCPL Odisha`, and `HQ` — which is itself informative: **none of them is a factory.** They are legacy, office, or duplicate records (§4).

### 0.3 🔴 The hierarchy is three levels at Rehla, not two

The brief described SCPL / SPPL / SPPLK as three peers. The diagram shows something different:

```
Jharkhand → Rehla ├── SCPL                    (company)
                  └── SPPL                    (company)
                       ├── SPPL               (operational entity)
                       └── SPPL(K)            (operational entity)
```

**Two legal companies at Rehla, but three operational entities.** SPPL(K) is a sub-division of SPPL, not a sibling of SCPL.

This does *not* change what must be built, because the three requirement lines — store common, FAR different, maintenance different — are all stated **"for all 3"**, i.e. at the *operational entity* level. But it does change how `company_name` is populated (SPPL and SPPL(K) share the company `Suntek Plasticizer Private Limited`; SCPL does not), and it means the display names should reflect the split. See §3.1 for the decisive technical consequence.

### 0.2 Your main concern, answered up front

> *"If we rename the factories, will a person's access to certain factories get limited?"*

**No. A rename cannot limit anyone's access.** This is the single most important finding of the audit, and it is unambiguous.

User→factory access lives in `user_plants(user_account_id, plant_id)` — a many-to-many table whose `plant_id` is a **foreign key to `plants.id` (a UUID)**. Renaming a factory writes to `plants.name` and nothing else. Specifically:

| Access mechanism | Keyed on | Survives rename? |
|---|---|---|
| `user_plants` membership | `plants.id` (UUID FK) | ✅ Yes |
| `user_units` membership | `units.id` (UUID FK) | ✅ Yes |
| RLS `my_plant_ids()` / `plant_in_scope()` (`28_rls_phase2a`) | `plant_id` UUID join | ✅ Yes |
| `PlantScopeContext` (`plantIds`, `allowedPlants`, `scopeQuery`) | UUID sets | ✅ Yes |
| `profiles.plant_id` | UUID FK | ✅ Yes |
| Auth JWT / `user_metadata` | `{ name, role_id }` — **no plant at all** | ✅ Yes, **and no re-login needed** |
| Role capabilities (`roles.capabilities`, `user_roles`) | role ids, plant-independent | ✅ Yes |

I verified the JWT specifically (`supabase/functions/admin-users/index.ts:208`): user metadata carries only `name` and `role_id`. There is no plant name in any token, session, or cache. **Nobody has to log in again, and nobody loses or gains a factory.**

Your existing user management is preserved exactly as-is — multiple factories per user and multiple roles per user already work and are untouched by anything proposed here. This is written up formally as a hard constraint in §12.

The rename *does* have cosmetic and edge-case fallout — 9 specific places listed in §7 — but not one of them is a permission.

---

## 1. Current System Structure (§28.1)

### 1.1 The factory model

There is exactly **one** organisational table:

```sql
-- supabase-queries/01_core_plants.sql + live schema
create table plants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,   -- ← the ONLY descriptive field
  lat               numeric,
  lng               numeric,
  geofence_radius_m integer,
  created_at        timestamptz
);
```

**There is no `state`, `location`, `company`, `entity`, `factory_code`, `slug`, or `display_name` column.** "Plant" is a single flat concept that silently conflates state, city, legal entity, factory, and store.

One sub-level exists:

```sql
create table units (            -- 27_plant_unit_scoping.sql
  id uuid primary key, plant_id uuid references plants(id),
  name text, code text, unique(plant_id, name)
);
```

`units` is **below** factory (procurement sub-divisions), not between location and factory. It cannot express "three factories at one location" without inverting its meaning.

### 1.2 Store relationships

**There is no `stores` table.** I confirmed this against all 53 tables across all 56 migrations. The store *is* the plant:

```sql
create table store_items (        -- 37_store_stock.sql
  plant_id  uuid references plants(id),
  item_name text not null,
  on_hand   numeric default 0,
  ...
  unique (plant_id, item_name)    -- ← inventory identity = (plant, item)
);
```

The current factory↔store relationship is therefore **one factory : one store, hard-wired by primary key**. Not one-to-many, not many-to-many — the two concepts are the same row. In the UI (`StockRegister.tsx:225`) a "store" is literally constructed as *"the slice of the register belonging to plant X"*.

### 1.3 FAR ownership

`fixed_assets.plant_id → plants(id)`. Assets are scoped to a factory and nothing else — no location, company, department, cost-centre, or store linkage. FAR is **RLS-enforced** (`28_rls_phase2a_operational.sql`: `create policy "scope_all" on fixed_assets using (plant_in_scope(plant_id))`), so backend enforcement matches the frontend. This is genuinely good.

### 1.4 Maintenance ownership

`maintenance_tickets.plant_id` + `unit_id`, RLS-enforced via `plant_unit_in_scope()`. Child rows (`maintenance_store_requests`) inherit scope via `ticket_in_scope()`.

Critically — `maintenance_store_requests` has **`plant_id` but no source-store column**. Reading `Maintenance.tsx:1392`, the requesting factory and the source store are the *same field*, always set to `selectedTicket.plant_id`. The parts type-ahead is loaded with `.eq('plant_id', pid)` where `pid` is the ticket's plant (`Maintenance.tsx:770`). **The system structurally assumes a store belongs to exactly one factory.**

### 1.5 User-access model

Genuinely well built, and better than the requirement in several places:

- `user_plants` — many-to-many, **multi-factory already supported**
- `user_units` — optional narrowing (empty = all units of the user's plants)
- `user_accounts.is_global` — sees everything
- `user_roles` — many-to-many, **multi-role already supported**
- `roles.capabilities` + `tiers.rank` — capability grants with password step-up
- Enforced twice: app layer (`PlantScopeContext`) and DB layer (RLS, `auth.uid()`-keyed, `service_role` bypass for edge functions)

What it does **not** have: any dimension separating *store access* from *factory access*, or *FAR access* from *maintenance access*. Today all three are the same thing — `user_plants` membership.

### 1.6 Dashboard grouping

Grouping is by `plant_id`, rendered through the `plants(name)` join — e.g. `StockRegister.tsx:132` `select('*, plants(name)')`, `Overview.tsx:373` `{r.plants?.name}`. Filter chips are derived **dynamically from data** (`StockRegister.tsx:208-212` builds `plantsInData` from the loaded rows). There is no location tier and no consolidated-vs-individual toggle.

One exception: **Anomaly Operations Center** groups by the free-text `anomaly_flags.plant` string (`AnomalyOperationsCenter.tsx:64,84`) — see §7.

### 1.7 Reporting structure

Exports (`src/lib/utils/exportCsv.ts`, `exportXlsx.ts`) are generic column-mapped helpers; plant names reach them via the live `plants(name)` join, so reports pick up renames automatically. Sales / Customers / Purchase-value reports are **BUSY-sourced** via `server/` and are **not plant-scoped at all** — I grepped `server/index.js`, `server/db.js`, `server/lib/`, `server/routes/` for any plant/factory/location logic and found **none**.

---

## 2. Current Factory Name Inventory (§28.2, §6)

From `demo_backup_2026-07-23.sql`. ⚠️ **This is the handover/demo database snapshot, not verified live production.** Re-run the inventory query in §13.1 against live before acting on it.

**9 plant records exist — not 4, not 5, not 6.**

| # | Current name | Current ID | Coords | Users | FAR | Maint tickets | Maint schedules | Store items | Store months | Notifs | Proposed action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `SCPL Delhi` | `01bc9fff-1aed-4393-97ab-3f26cb5cfb67` | 28.70, 77.10 (Delhi) | 1 | **331** | 242 | 241 | 0 | 0 | 242 | ⚠️ **REVIEW** — office or factory? Holds a duplicate FAR |
| 2 | `SPPL` | `1c9cdf97-b95f-4686-8165-97c405054106` | 23.02, 72.57 (**Ahmedabad — wrong**) | 5 | **331** | 283 | 247 | **434** | 1709 | 220 | → `SPPL – Rehla` |
| 3 | `K.G` | `9acb6dc1-fb9a-40f1-94c5-743d3d089bc9` | 25.59, 85.14 (**Patna — wrong**) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ⚠️ **CONFIRM MEANING** — empty |
| 4 | `Madan` | `8bf19a24-f52e-41c4-b867-914417fa2c21` | 28.41, 77.32 (**Gurgaon — wrong**) | 3 | 0 | 10 | 0 | **159** | 158 | 68 | → `Madan Chemicals – Sikandarabad` |
| 5 | `SCPL Odisha` | `4475575e-8ac6-4114-8889-671602101014` | 20.30, 85.82 (Bhubaneswar) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ⚠️ Duplicate of `Ganjam`? |
| 6 | `SHD` | `43b8702b-c545-405c-a834-2f86e76f290a` | 23.79, 86.43 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | ⚠️ **CONFIRM** — 2 store reqs only |
| 7 | `Rehla` | `72d15956-4ab5-4003-9c84-e88419713dfe` | 24.13, 84.05 (**correct**) | 2 | 0 | 2 | 0 | **434** | 1709 | 3 | → `SCPL – Rehla` **or** becomes the *location* |
| 8 | `Ganjam` | `840b1f17-f377-439e-9e95-750e7b124cbf` | 19.39, 85.05 (**correct**) | 0 | 0 | 24 | 22 | 8 | 0 | 26 | → `SCPL – Ganjam` |
| 9 | `HQ` | `a9398ed0-856e-48a2-a56d-30ce89b5346e` | 22.57, 88.36 (Kolkata) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Retain as non-factory |

**`units`** — only 2 rows, both under `Rehla`: `Chlorides` (`chlorides`), `Plasticiser` (`plasticiser`).

**Notes on this inventory:**

- **There is no `M.G` record.** The prompt lists "MG and KG" as legacy values; only `K.G` exists in the DB. Either MG was never created, or it is one of the other rows under a different label. **Needs client confirmation.**
- **Coordinates are placeholders.** SPPL is pinned to Ahmedabad, K.G to Patna, Madan to Gurgaon. Only `Rehla` and `Ganjam` are geographically plausible. `CheckIn.tsx:12` even carries the comment *"Replace with real coordinates before production"*. These drive the night-duty geofence — worth fixing in the same pass.
- **`SPPL` currently holds the Rehla store and the Rehla FAR.** It is the operational Rehla record; the record literally named `Rehla` holds a duplicate store and almost nothing else.

### 2.1 Massive pre-existing data duplication ⚠️

This is the most serious data finding, and it directly determines how much work §7/§8 will be.

| Dataset | Plant A | Plant B | Distinct keys each | **Overlap** |
|---|---|---|---|---|
| `store_items` | `Rehla` (434) | `SPPL` (434) | 434 / 434 | **434 — 100% identical** |
| `fixed_assets` | `SCPL Delhi` (324 marks) | `SPPL` (324 marks) | 324 / 324 | **324 — 100% identical** |
| `maintenance_schedules` | `SCPL Delhi` (184) | `SPPL` (198) | — | **184 — 100% of the smaller** |
| `maintenance_schedules` | `Ganjam` (14) | `SPPL` (198) | — | **14 — 100% of the smaller** |
| `store_stock_months` | `Rehla` (1709) | `SPPL` (1709) | — | **identical** |

**The same physical Rehla store is already loaded twice** (once as `Rehla`, once as `SPPL`), and **the same FAR is already loaded twice** (`SCPL Delhi` + `SPPL`). Stock quantities and asset values are therefore **double-counted across the whole system today**.

Two pieces of evidence confirm this is the *cause*, not a coincidence:

1. `FAR.tsx:472-476` — the FAR importer takes a **multi-select of factories** and `flatMap`s the parsed rows across every selected plant, physically duplicating each asset. The UI even says so: *"These {rows} assets will be registered for each of the {plants} selected factories."* Multi-factory FAR sharing was implemented as **copy**, not as a relationship.
2. `StockRegister.tsx:216-217` — an explicit workaround comment: *"Merge identical items across the selected plants (sum on-hand + issued), so combining SPPL + Rehla shows 58, not two 29 rows."* The dashboard is already papering over the duplication by summing, which is only correct if you view both plants *together* and wrong if you view either alone.

**Consequence:** the "Rehla Common Store" requirement (§7 of your brief) is not a new feature request. It is the correct fix for a bug that already exists in production data.

### 2.2 What the client's own source files say

From `Suntek Data/Store:FAR:Maintanence/`:

| File | What it reveals |
|---|---|
| `Fixed Assets Register-SPPL.xlsx` | Header string: **"Suntek Plasticizer Private Limited(Unit I)"**. Columns: S.NO, Name Of Equipments, Quantity, Make, Serial no., Identification Mark, Model No., Capacity, Country of Origin, Year, Taxable Value, Invoice No., Date of Purchase, Account Head. **There is NO factory/entity column.** Identification marks are bare (`GLC1`…`GLC16`) with no entity prefix. Also contains `Graphicarb(Madan Chemicals)` as an asset make. |
| `SPPL Unit-1 Preventive Maintainance.xlsx` | Titled **"SUNTEK PLASTISIZER Unit 1"**. But two equipment rows are tagged **SPPLK**: `HCL PROCES TANK( AIR PURGIG)SPPLK`, `NEW WIND SHOCK HAS BEEN INSTALLE AT SPPLK`. **SPPLK equipment is currently commingled inside the SPPL workbook.** |
| `Store Keeping 26-27 Jharkhand (1).xlsx` | Sheets are `Sales <Month>` / `Purchase <Month>` — **one workbook for all of Jharkhand**, no per-entity split. |

**Three conclusions, all load-bearing:**

1. **The Rehla Common Store already exists in the client's own bookkeeping** — a single Jharkhand workbook. Our system split it into two plants; the client never did. §7 is a *correction*, not a new build.
2. **The FAR cannot be split by entity from existing data.** There is no entity column and no naming convention in the identification marks. Assigning 324 assets to SCPL / SPPL / SPPLK requires the client to physically mark up the register. **This is the hard blocker for §8** and no amount of engineering removes it.
3. **SPPL is organised as "Unit I"**, and SPPLK is not yet separated from it. This is the strongest available evidence for the sixth factory (§5).

---

## 3. Proposed Target Structure (§28.3)

```
State
└── Location                          ← NEW tier (geographical grouping, consolidated reporting)
    └── Factory / Entity              ← existing `plants`, enriched
        └── Unit                      ← existing `units` (Chlorides / Plasticiser)

Store                                 ← NEW table, many-to-many with Factory
```

```
Uttar Pradesh
└── Sikandrabad
    └── [Madan chemical]  Madan Chemical – Sikandrabad ──── Sikandrabad Store

Odisha
└── Ganjam
    └── [SCPL]  SCPL – Ganjam ─────────────────────────── Ganjam Store

Jharkhand
└── Rehla
    ├── [SCPL]  SCPL – Rehla     ──┐
    ├── [SPPL]  SPPL – Rehla     ──┼───────────────────── Rehla Common Store
    └── [SPPL]  SPPL(K) – Rehla  ──┘                      (shared, stock held once)
```

`[…]` is the owning **company**. Note `SCPL` spans two locations (Ganjam and Rehla), and `SPPL` owns two operational entities at one location — which is precisely why company, location, and factory must be three separate fields rather than one `name` string.

### 3.1 🔴 SPPL(K) must be a **plant** row, not a **unit** row

The diagram shows SPPL(K) nested under SPPL, which invites modelling it with the existing `units` table (`units.plant_id → plants.id`). **That will not work.** I checked the column lists directly:

| Table | Has `plant_id` | Has `unit_id` |
|---|---|---|
| `fixed_assets` | ✅ | ❌ **No** |
| `maintenance_schedules` | ✅ | ❌ **No** |
| `store_items` | ✅ | ❌ No |
| `maintenance_tickets` | ✅ | ✅ |
| `store_requisitions` | ✅ | ✅ |

The client's two hardest requirements are **"FAR different for all 3"** and **"maintenance different for all 3"**. FAR (`fixed_assets`) and the preventive-maintenance register (`maintenance_schedules`) **have no unit dimension at all**. Modelling SPPL(K) as a unit would require adding `unit_id` to both tables, writing new unit-level RLS predicates for FAR, and reworking the FAR/PM importers — while the existing `plant_in_scope()` policy on `fixed_assets` already does exactly the required job at plant granularity.

**Recommendation: create SPPL(K) – Rehla as its own `plants` row**, with `company_name = 'Suntek Plasticizer Private Limited'` shared with SPPL – Rehla. The company field carries the parent relationship; the plant row carries the isolation. This gets FAR and maintenance separation **for free** from RLS that is already written, tested, and live.

The existing `units` table stays exactly as it is, for what it was built for: the Chlorides / Plasticiser procurement sub-divisions.

Minimum schema delta (**proposal only — not applied**):

```sql
-- NEW: location master
create table locations (
  id uuid primary key default gen_random_uuid(),
  state       text not null,
  name        text not null,          -- 'Rehla', 'Ganjam', 'Sikandarabad'
  code        text unique,            -- 'REHLA'  (stable technical key)
  unique (state, name)
);

-- ENRICH: plants  (add columns only — id and every FK untouched)
alter table plants
  add column location_id  uuid references locations(id),
  add column company_name text,       -- 'Suntek Plasticizer Private Limited'
  add column entity_name  text,       -- 'SPPL'
  add column factory_code text unique,-- 'SPPL_REHLA'  ← technical key, never displayed
  add column legacy_names text[],     -- alias trail: {'SPPL','Rehla'}
  add column is_factory   boolean default true;  -- false for HQ / SCPL Delhi office
-- display_name = plants.name, generated as '<entity_name> – <location.name>'

-- NEW: stores, decoupled from factory
create table stores (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  name        text not null,          -- 'Rehla Common Store'
  code        text unique             -- 'REHLA_COMMON'
);
create table factory_store_access (   -- many-to-many
  plant_id uuid references plants(id),
  store_id uuid references stores(id),
  primary key (plant_id, store_id)
);

-- NEW: separate the access dimensions
create table user_stores (            -- store access ≠ factory access
  user_account_id uuid references user_accounts(id) on delete cascade,
  store_id        uuid references stores(id) on delete cascade,
  primary key (user_account_id, store_id)
);

-- RETARGET inventory: store-owned, factory-attributed
alter table store_items
  add column store_id uuid references stores(id);       -- WHERE the stock physically is
-- (plant_id retained during transition, dropped from the uniqueness key at cutover)
alter table store_stock_events
  add column store_id            uuid references stores(id),  -- stock deducted from
  add column requesting_plant_id uuid references plants(id);   -- cost attributed to
alter table maintenance_store_requests
  add column source_store_id uuid references stores(id);       -- plant_id stays = requesting factory
```

**Design rule throughout: `plants.id` never changes.** Every FK, every user assignment, every historical row keeps pointing at the same UUID. `name` becomes purely a display string; `factory_code` becomes the technical key for any logic that needs one.

---

## 4. Old → New Mapping (§28.4)

Updated against the client diagram. **9 existing records → 5 factories + 2 non-factory records + 2 retirements.**

| Current name | Current ID | Action | Proposed | Company | Risk |
|---|---|---|---|---|---|
| `SPPL` | `1c9cdf97…` | **Rename in place** | `SPPL – Rehla` | SPPL | 🟡 Holds the Rehla store (434) + a duplicate FAR (331) + 283 tickets. Rename is safe; the FAR/store split is the real work. |
| `Rehla` | `72d15956…` | **Rename in place** | `SCPL – Rehla` | SCPL | 🟡 Holds a 434-item duplicate of the SPPL store + the only 2 `units` rows + 2 users. **Do NOT convert this row into the `locations` record** — create a fresh `locations` row instead, so this plant's 2 users and unit links stay intact. |
| `Madan` | `8bf19a24…` | **Rename in place** | `Madan Chemical – Sikandrabad` | Madan chemical | 🟢 Low — 159 store items, 10 tickets, 3 users, all `plant_id`-linked. |
| `Ganjam` | `840b1f17…` | **Rename in place** | `SCPL – Ganjam` | SCPL | 🟢 Low — 24 tickets, 22 schedules, 8 store items. |
| — | (new row) | **Create** | `SPPL(K) – Rehla` | SPPL | 🔴 Needs an asset/maintenance split from SPPL that **does not exist in any source file** (§2.2). Create the row early (cheap, no dependents); populate it only once the client supplies the split. |
| `SCPL Delhi` | `01bc9fff…` | **Not a factory** per diagram → `is_factory = false` | `SCPL – Delhi (Office)` | SCPL | 🔴 But it holds 331 duplicate FAR rows + 242 tickets + 241 schedules. **Where does that history belong?** Most likely it *is* the Rehla FAR, mis-filed. Confirm before remapping. |
| `SHD` | `43b8702b…` | ⚠️ **Likely merge into `Madan`** (§5.3) | Retire as alias | — | 🟢 2 store reqs, 2 notifications only. |
| `SCPL Odisha` | `4475575e…` | **Retire** — duplicate of `Ganjam` | Alias only | — | 🟢 Zero dependent rows. |
| `K.G` | `9acb6dc1…` | **Not a factory** per diagram → retire | Alias only | — | 🟢 Zero dependent rows. |
| `HQ` | `a9398ed0…` | Retain, `is_factory = false` | `HQ` | — | 🟢 Zero dependent rows. |
| `M.G` | **does not exist** | — | — | — | Referenced by the client; no such record; not in the diagram. |

**Retire = set inactive and record in `plants.legacy_names`. Never `DELETE`** — per the §12.2 constraint, no plant row is ever removed or re-keyed.

**Nothing was renamed, merged, split, retired, or deleted during this audit.**

---

## 5. Factory-Count Clarification (§28.5) — ✅ RESOLVED: **five**

The diagram shows exactly five operational entities across three states and three locations:

| # | State | Location | Company | Operational entity |
|---|---|---|---|---|
| 1 | Uttar Pradesh | Sikandrabad | Madan chemical | **Madan Chemical – Sikandrabad** |
| 2 | Odisha | Ganjam | SCPL | **SCPL – Ganjam** |
| 3 | Jharkhand | Rehla | SCPL | **SCPL – Rehla** |
| 4 | Jharkhand | Rehla | SPPL | **SPPL – Rehla** |
| 5 | Jharkhand | Rehla | SPPL | **SPPL(K) – Rehla** |

**There is no sixth factory. None has been created or assumed.**

### 5.1 Where "six" most likely came from

Reading the diagram literally, the token `SPPL` appears **twice** at Rehla — once as the parent *company* and once as the child *operational entity*. Counting the leaf names naively gives four at Rehla (`SCPL`, `SPPL`, `SPPL`, `SPPL(K)`) and therefore six in total. The count of six is almost certainly this double-count, not a missing site. Worth a one-line confirmation with the client, but no action is required on it.

### 5.2 My earlier "SPPL Unit-II" hypothesis is refuted

In the pre-image draft I flagged `Suntek Plasticizer Private Limited(Unit I)` (FAR header) and `SUNTEK PLASTISIZER Unit 1` (PM workbook) as evidence of a missing Unit-II. The diagram shows the SPPL split is **SPPL / SPPL(K)**, not Unit-I / Unit-II. "Unit I" is simply how SPPL proper is labelled in its own paperwork. No sixth factory follows from it.

### 5.3 New hypothesis: `SHD` and `Madan` may be the same site

`SHD` is the suffix BUSY uses on UP/NCR-region customers — `A S Polymers (Ghaziabad) SHD`, `Samarth Cables(shd)`, `Ma Durga Plastic (SHD)`. Ghaziabad neighbours Sikandrabad. If `SHD` abbreviates **S**ikandra**b**a**d**, then the DB currently holds the UP factory **twice** — once by location (`SHD`, empty) and once by company (`Madan`, 159 store items, 10 tickets, 3 users).

Caveat: the literal string "Sikandrabad" appears nowhere in the codebase, BUSY data, or client workbooks, so this is inference from the suffix pattern, not proof. `SHD` carries only 2 store requisitions and 2 notifications, so merging it into `Madan` would be cheap either way. **Confirm before acting** (§13.1).

---

## 6. Answers to the Architecture Questions (§25)

| # | Question | Answer |
|---|---|---|
| 1 | Separate factory and location records? | ❌ **No.** One flat `plants` table; no location master. |
| 2 | Multiple factories at one location? | ⚠️ **Only by convention.** Nothing links them or enables location-level rollup. |
| 3 | One store shared by multiple factories? | ❌ **No.** No `stores` table; `store_items` is `unique(plant_id, item_name)`. Store ≡ plant. |
| 4 | FAR isolated while store shared? | ❌ **Not today** — both are gated by the same `user_plants` membership. ✅ **Achievable** — FAR RLS is already clean; it needs a separate store-access dimension, not a FAR rewrite. |
| 5 | Factory-specific asset + shared-store inventory? | ❌ **No.** `Maintenance.tsx:770` loads parts with `.eq('plant_id', ticket.plant_id)`. |
| 6 | Inventory transactions tagged with requesting factory? | ⚠️ **Coincidentally.** `store_stock_events.plant_id` is set from `selectedTicket.plant_id`, but it doubles as "which store" — one column, two meanings. Once the store is shared, that column is ambiguous. |
| 7 | Factory names used as technical identifiers? | ❌ **No, and this is the good news.** All FKs are UUIDs. Two exceptions in §7. |
| 8 | Legacy plant names hard-coded? | ⚠️ **Yes, in 6 files** — see §7.3. Only one is a live dropdown. |
| 9 | Will changing the factory master update the whole website? | ⚠️ **Mostly yes (~90%).** 9 exceptions in §7. |
| 10 | What will not update automatically? | §7.2–7.5. |
| 11 | Can existing records be safely renamed? | ✅ **Yes** — `plants.id` is stable, `plants.name` is not referenced by any FK. |
| 12 | Will user assignments survive a rename? | ✅ **Yes, all of them. Zero exceptions.** |
| 13 | Will reports and historical data keep their links? | ✅ **Yes** — all joins are ID-based. |
| 14 | Will dashboards use the new grouping automatically? | ⚠️ **Names yes** (`plants(name)` join is live). **Location tier no** — doesn't exist. |
| 15 | Will user-profile dropdowns show new names? | ✅ **Yes** — `UserManagement` reads `allowedPlants` from `PlantScopeContext`, which reads `plants` live. |
| 16 | Can users be assigned to multiple factories? | ✅ **Yes — already works.** `user_plants` is many-to-many. |
| 17 | Can store access be separated from FAR/maintenance access? | ❌ **No.** One dimension today. Needs `user_stores`. |
| 18 | Will existing clients be affected? | 🟢 Single-tenant deployment. Non-Rehla factories are unaffected if the shared-store path is opt-in. |
| 19 | Is a DB migration required? | ✅ **Yes** — `locations`, `stores`, `factory_store_access`, `user_stores`, + columns. |
| 20 | Is a user-permission migration required? | ⚠️ **Only additive** — backfill `user_stores` from `user_plants`. **No existing permission is altered or revoked.** |
| 21 | Backward-compatible? | ✅ **Yes if `plant_id` is retained alongside `store_id`** during transition (dual-write, then cut over). |
| 22 | Configuration / minor / moderate / major? | See §11. **Rename = configuration-only. Common store + FAR split = moderate data-model change.** |
| 23 | Five factories or six? | ✅ **Five** — confirmed by the client diagram. 9 DB records collapse to 5 factories + 2 offices + 2 retirements. See §5. |
| 24 | What client confirmation is needed? | **Down from 12 to 5** — see §13.1. Only one is blocking. |

---

## 7. Rename-Propagation Findings (§28.6, §20) — the 9 exceptions

**Which of §20's four cases applies?** Predominantly **20.1 (dynamic ID-based references)** — which is why the rename is safe — with small pockets of **20.2** (names copied into tables), **20.4** (hard-coded frontend values), and one instance of **20.3** (name in business logic).

### 7.1 ✅ Updates automatically (the ~90%)

Every screen joins `plants(name)` live: FAR, Maintenance, StockRegister, StoreRequisitions, ActivityLog, QRManagement, AssetProfile, Overview, UserManagement, NightDutyScheduler, notifications, CSV/XLSX exports (columns are mapped from the live join), and the Cmd+K search palette (`globalSearch.ts` issues live `ilike` queries — **there is no separate search index to reindex**).

### 7.2 ⚠️ Names copied into tables (§20.2) — needs a data migration

| Location | Impact | Fix |
|---|---|---|
| `user_accounts.plant_name` (text) | Written at save time (`UserManagement.tsx:432`), read for display (`:730`) and **indexed by Cmd+K search** (`globalSearch.ts:65-72`). Goes stale on rename. | One `UPDATE … FROM plants` in the rename migration. |
| `anomaly_flags.plant` (text, free) | **Anomaly Operations Center groups and filters entirely on this string** (`AnomalyOperationsCenter.tsx:64,84,167`). Historical rows keep the old name → **the filter dropdown splits into "SPPL" *and* "SPPL – Rehla" as two separate entries.** | Backfill + repoint to `plant_id`. |
| `oil_contracts.port` (text) | Destination-plant name; `27_plant_unit_scoping.sql:117` matches it via `lower(trim(c.port)) = lower(p.name)`. Future backfills break silently. | Backfill `plant_id`; stop matching on name. |
| `tanks.location`, `cpm_drum_stock.location`, `dispatch_logs.destination` / `from_location` (text) | Display-only free text; will show stale values. | Low priority; sweep or leave. |

### 7.3 ⚠️ Hard-coded frontend values (§20.4)

| File:line | Constant | Live or fallback? |
|---|---|---|
| `PurchaseOrders.tsx:60` | `const PLANTS = ['SHD','Rehla','Ganjam','HQ']` | 🔴 **LIVE** — rendered directly at `:393` (`{PLANTS.map(...)}`) with **no DB read at all**. Also `destination: 'SHD'` as form default (`:80`, `:159`). **This dropdown will show the old names forever after a rename.** |
| `FAR.tsx:232` | `PLANTS` | 🟡 Fallback only (`:358`, used if the `plants` read returns empty). Form default `plant: 'SHD'` (`:292`, `:551`) will be invalid. |
| `ActivityLog.tsx:82` | `PLANTS` | 🟡 Fallback (`:262`). Default `plant: 'SHD'` (`:195`, `:332`). Plus a stale demo string `'Atlas Copco GA18 — SHD-AC-04'` (`:482`). |
| `StoreRequisitions.tsx:47` | `FALLBACK_PLANTS` | 🟡 Fallback (`:134`). Default `plant: 'SHD'` (`:89`, `:182`). Plus hardcoded help text naming all four plants (`:232`). |
| `Maintenance.tsx:797` | `['SHD','Rehla','Ganjam','HQ']` | 🟡 Fallback. |
| `CheckIn.tsx:12-15` | `PLANT_NAME = 'Rehla (SCPL)'`, `PLANT_LAT/LNG/RADIUS` | 🔴 **LIVE and single-plant.** Carries the comment *"Replace with real coordinates before production."* Every night check-in is hard-bound to Rehla. |
| `FAR.tsx:561`, `:645` | KPI help text: *"across all 4 factory plants (SHD, Rehla, Ganjam, HQ)"* | 🟡 Display text, wrong today (9 plants exist). |
| `i18n/locales/en.ts:707,1699` + `hi.ts` | `"e.g. Madan Chemicals"`, `"e.g. SCPL-PM-047, SHD-Compressor-3"` | 🟢 Placeholder text only. |

### 7.4 ⚠️ Names used in business logic (§20.3)

| Location | Logic | Risk |
|---|---|---|
| `Maintenance.tsx:809` | `const raisePlant = dbPlants.find(p => p.name === raiseForm.plant)` — form state holds a **name**, resolved to an ID at submit. | 🟡 Survives a rename because the dropdown reloads. **But:** a form open *across* the rename resolves to `undefined` → `plant_id` saved as `null`. And it **requires globally unique names** — `.find()` returns the first match. The proposed names are unique, so this holds, but it is fragile. |
| `Maintenance.tsx:812` | `raiseFarAssets = raisePlant ? farAssets.filter(...) : farAssets` | 🔴 **When the name lookup fails, the asset picker falls back to showing ALL assets.** Combined with `Maintenance.tsx:778` (a `fixed_assets` query with **no `scopeQuery` and no plant filter**), a multi-factory Rehla user could see another Rehla entity's assets in the picker. RLS still blocks *writing* out of scope, but this **directly violates §8's "assets belonging to one factory must not appear under another."** |
| `Maintenance.tsx:805-806` | `jharkhandPlantIds` = units whose name/code matches `/chlorid\|plastic/i` | 🟡 **Regex on a display name driving a UI branch.** Renaming a unit hides the procurement-unit selector. |
| `NightManagerBoard.tsx:56-62` | `getCoords()` → `Object.keys(PLANT_COORDS).find(k => plantName.includes(k)) \|\| 'Rehla'` | 🟡 Name-**substring** matching with a silent fallback to Rehla. Only fires when `lat/lng` are null (currently never). Note `'SCPL – Rehla'.includes('Rehla')` is `true`, so the proposed names happen to work — by luck. |
| `27_plant_unit_scoping.sql:92` | `insert into units … where p.name = 'Rehla'` | 🟢 Migration-only, already executed. Any **re-run** after a rename silently seeds nothing. |
| `27_plant_unit_scoping.sql:123` | `role_id in ('admin','accountant_delhi')` → `is_global = true` | 🟢 Role id, not a plant — but it encodes a legacy location name. Same for role ids `technician_shd`, `store_manager_chlorides`, `store_manager_plasticiser`. |

### 7.5 ⚠️ Immutable historical artefacts

| Location | Impact |
|---|---|
| Cloudinary paths/filenames (`cloudinary.ts:94,118,132,217,244`) | Every uploaded photo is stamped `plant:<slug>` in its folder path and tags. **Already-uploaded assets keep the old slug forever.** Cosmetic only — files are addressed by URL, not by path parsing. |
| Already-downloaded CSV/XLSX exports | Immutable snapshots. Expected. |
| `store_stock_events`, `activity_logs`, `user_account_events`, `batch_edit_logs` | ID-based → **auto-update**. ✅ Good. |
| **BUSY ERP master data** | 🔴 **DO NOT TOUCH.** Customer/supplier names embed our abbreviations: `Grasim Industries Limited (Rehla)`, `Samarth Cables(shd)`, `A S Polymers (Ghaziabad) SHD`, `Madan Chemicals Pvt Ltd`, etc. (~40 occurrences in `server/fallback/*.json`). These are **BUSY's** naming convention, external to us, and renaming our plants must not and does not change them. |

### 7.6 ✅ Confirmed NOT affected

Caches · search indexes · slugs · URLs · **auth tokens** · sessions · **permissions**. Routes (`App.tsx`) contain no plant slug. `localStorage` holds only sidebar state, language, notification pointers, and the batch-logger draft — no plant names. **No re-login required.**

---

## 8. User Management Findings (§28.7, §18)

**Your existing system is well built. The audit found no reason to change how it works.**

| # | Question | Answer |
|---|---|---|
| 1 | Assigned by company / plant / location / factory / store? | **Plant only** (`user_plants`), optionally narrowed by unit (`user_units`). |
| 2 | One user → multiple factories? | ✅ **Yes, already.** In the snapshot, `Naresh yadav` holds 2 plants. |
| 3 | One user → multiple locations? | ✅ Implicitly (multiple plants) — but there is no location tier to select from. |
| 4 | Store access separate from factory access? | ❌ **No.** Same dimension. **This is the one real gap.** |
| 5 | Rehla Common Store access while restricted to one FAR? | ❌ **Not today.** Granting store access = granting `user_plants` on the store's plant = granting that plant's FAR + maintenance. |
| 6 | Assignments stored by ID or name? | ✅ **UUID.** `plant_name` exists as a display copy only. |
| 7 | Factory choices hard-coded in the user form? | ✅ **No** — `UserManagement` uses `allowedPlants` from `PlantScopeContext` (live DB read). |
| 8 | Dropdowns loaded dynamically? | ✅ **Yes** in User Management. ❌ **No** in `PurchaseOrders.tsx` (§7.3). |
| 9 | Rename preserves user assignments? | ✅ **Yes — guaranteed by FK.** |
| 10 | Factory details in sessions / JWTs / caches? | ✅ **No.** JWT carries `{name, role_id}` only. |
| 11 | Re-login needed after rename? | ✅ **No.** |
| 12 | Enforced frontend **and** backend? | ✅ **Yes** — `PlantScopeContext` + RLS (`28_rls_phase2a`), `auth.uid()`-keyed. |
| 13 | Bypass by changing request parameters? | ✅ **Blocked** for the 8 RLS'd tables (`maintenance_tickets`, `maintenance_store_requests`, `store_requisitions`, `maintenance_schedules`, `stock_levels`, `activity_logs`, **`fixed_assets`**, `labour_costs`) + store-stock tables (37). ⚠️ **Still open (Phase 2b/2c, pre-existing):** `notifications`, L1 batch tables, `sales_contracts`, `customers`, `oil_contracts`, `marine_insurance`, `anomaly_flags`. |
| 14 | Permission migration required? | ⚠️ **Additive only** — backfill `user_stores` from `user_plants` so every user keeps exactly what they have today. **No revocations.** |
| 15 | Factory options filterable by location? | ❌ No location tier. |
| 16 | Central admins across locations/factories? | ✅ **Yes** — `is_global` + admin role. |

### 8.1 Recommended flow vs. current

Your §17 target flow is: `State → Location → Factory(s) → Store → Department → Role → Modules`.

Current: `Factory(s) [multi-select] → Unit(s) → Role(s) → is_global → Capabilities`.

**The delta is two new pickers (State/Location as cascading filters, Store as an independent multi-select) — not a redesign.** State and Location can be pure *filters* over the existing factory multi-select, so the underlying `user_plants` write path is byte-for-byte identical. There is no `department` concept today; add it only if the client actually needs it.

---

## 9. Dashboard and Reporting Findings (§28.8, §22, §23)

| # | Question | Answer |
|---|---|---|
| 1 | What controls grouping? | `plant_id`, displayed via the `plants(name)` join. |
| 2 | Grouped by name / ID / company / location / store? | **Plant ID.** No company, location, or store dimension. |
| 3 | Legacy values hard-coded? | ⚠️ Yes in `PurchaseOrders.tsx` (live) + 5 fallbacks. |
| 4 | Filters loaded dynamically? | ✅ Yes — `StockRegister.tsx:208` derives chips from data. |
| 5 | Location-level **and** factory-level views? | ❌ **No.** Only factory. Location rollup needs the new tier. |
| 6 | Common-store inventory consolidated? | ❌ **No — it is actively duplicated** (§2.1). `StockRegister.tsx:218-231` masks it by summing across selected plants. |
| 7 | Consumption groupable by requesting factory? | ⚠️ **Structurally, once separated.** `store_stock_events.plant_id` currently means both "store" and "requester". |
| 8 | Historical dashboard data valid after rename? | ✅ **Yes** — all ID-joined. |
| 9 | Dashboard permissions follow the user's factory access? | ✅ Yes — `scopeQuery` + RLS. |
| 10 | Can users see unauthorised factories? | ⚠️ **One real hole:** `Maintenance.tsx:778` fetches `fixed_assets` with no scope filter, and `:812` falls back to *all* assets when the plant name lookup fails. RLS caps it at the user's own plants — so it is not a cross-tenant leak — but for a multi-factory Rehla user it **does** cross-show FAR between Rehla entities. Fails §8. |
| 11 | Dashboard APIs permission-controlled? | ✅ Supabase tables: yes (RLS). ❌ **BUSY server (`server/`): no plant scoping whatsoever.** |
| 12 | Query / index / model changes required? | ✅ Yes — see §3. |

**Reporting (§23).** Store stock report, FAR report, asset report, maintenance report, user-access report, audit report and all exports read from the live join and will show new names immediately. What is **missing** for your §23 expectations: (1) inventory consolidation under one store — blocked by §2.1 duplication; (2) consumption attributable to SCPL/SPPL/SPPLK — blocked by the single overloaded `plant_id`; (3) FAR/maintenance separation by Rehla entity — blocked by there being no source data to split on (§2.2).

---

## 10. Gap Analysis (§28.9, §26)

| # | Gap | Current | Required | Affected | Classification |
|---|---|---|---|---|---|
| 1 | **Rename factories** | 9 unclear names | `<Entity> – <Location>` | `plants.name`; `user_accounts.plant_name`; `anomaly_flags.plant`; 6 hardcoded files | 🟢 **Configuration + minor frontend** |
| 2 | **State / Location tier** | None | `locations` master, 3 rows | New table + FK; UI filters; dashboard rollup | 🟡 **Minor–moderate** (purely additive) |
| 3 | **Multiple factories at one location** | Convention only | Explicit + rollup | `plants.location_id` | 🟡 **Minor** |
| 4 | **Rehla Common Store** | ❌ No `stores` table; store ≡ plant; **stock duplicated 2×** | Stock held once, N factories draw from it | `stores`, `factory_store_access`, `store_items.store_id`, `store_stock_events`, `maintenance_store_requests.source_store_id`, RLS, StockRegister, Maintenance, AddPurchaseModal, RepairReturnModal | 🔴 **Moderate data-model change** |
| 5 | **Rehla FAR split (3 registers)** | 324 assets duplicated across 2 plants; **no entity column in source** | 3 isolated registers | `fixed_assets` remap; **client must mark up the register** | 🔴 **Moderate — blocked on client data** |
| 6 | **Store access ≠ FAR/maintenance access** | One dimension | Independent | `user_stores`; RLS split; UserManagement UI | 🟡 **Moderate** (additive, no revocations) |
| 7 | **Cost attribution to requesting factory** | `plant_id` means both store and requester | Separate columns | `store_stock_events.requesting_plant_id` | 🟡 **Minor** (once #4 lands) |
| 8 | **Hardcoded plant arrays** | 6 files | Dynamic | `PurchaseOrders.tsx` (live), 5 fallbacks | 🟢 **Minor frontend** |
| 9 | **FAR leak in maintenance picker** | Unfiltered fetch + all-assets fallback | Always scoped | `Maintenance.tsx:778,812` | 🟢 **Minor — but a §8 violation; fix regardless** |
| 10 | **Non-atomic stock issue** | Client-side read-modify-write (`Maintenance.tsx:1739-1744`) | Atomic | New `issue_store_item()` RPC | 🟡 **Minor–moderate — see §10.1** |
| 11 | **`CheckIn.tsx` hardcoded to Rehla** | Single-plant constants | Per-plant from DB | `CheckIn.tsx:12-15` | 🟢 **Minor** |
| 12 | **Placeholder coordinates** | 7 of 9 plants geographically wrong | Real coords | `plants.lat/lng` | 🟢 **Configuration** |
| 13 | **BUSY reports unscoped** | No plant filter in `server/` | Scoped | `server/routes/*` | 🟡 **Moderate — pre-existing, out of scope** |

### 10.1 Concurrency defect (relevant to §24.9) 🔴

Additions to stock are atomic — `53_stock_purchases.sql:172` uses `set on_hand = on_hand + v_qty` inside a `SECURITY DEFINER` function (row-locked, correct).

**Deductions are not.** `Maintenance.tsx:1739-1744` performs a client-side read-modify-write:

```ts
const { data: si } = await supabase.from('store_items').select('*').eq('id', req.store_item_id).single();
const issueQty = Math.min(qty, Math.max(0, Number(si.on_hand)));
await supabase.from('store_items')
  .update({ issued_qty: Number(si.issued_qty) + issueQty, on_hand: si.on_hand - issueQty })
  .eq('id', req.store_item_id);
```

Two concurrent handovers both read `on_hand = 10`, both write `10 − 5 = 5`. **Ten units leave the store; the register says five were issued.** The `store_items_on_hand_nonneg` CHECK (migration 39) prevents *negative* stock but does nothing about a lost update.

Today this is masked because each factory has its own private register — two people rarely touch the same row. **A shared Rehla store makes exactly this collision the normal case** (three factories drawing from one row). This must be converted to an atomic RPC *as part of* the common-store work, not after it.

---

## 11. Architecture and Impact Assessment (§28.10) + Final Recommendation (§28.15)

**The requirement splits cleanly into two very different pieces.**

### Piece A — Rename + hierarchy → 🟢 **Supported with minor changes**

Because `plants.id` is a stable UUID referenced by every FK, and no permission, token, cache, or URL depends on the name. Renaming is a data update plus ~6 frontend cleanups. **Adding `locations` is purely additive** — new table, new nullable FK, nothing existing changes behaviour. Zero risk to permissions. Zero risk to history.

### Piece B — Rehla Common Store + per-entity FAR → 🔴 **Requires moderate data-model changes**

Because `store_items` is `unique(plant_id, item_name)`: **inventory identity is currently defined as (factory, item)**. Shared inventory is not expressible without introducing a store entity. This is a schema change, an RLS change, a migration of 868 duplicated store rows and 648 duplicated FAR rows, and touches 5 screens.

It is **not an architectural rewrite.** The plant/unit/scope architecture is sound and stays; we are adding one sibling dimension (store) beside the existing one (factory), and separating one overloaded column into two.

**Overall classification: 🟡 MODERATE.** No architectural change required. The hardest part is not code — it is §2.2: **the client's FAR has no entity column, so nobody can tell which of the 324 Rehla assets belong to SCPL, SPPL, or SPPLK.** That is a client data-entry task, and it gates §8, §9, and §24.4–24.7 entirely.

### Impact summary

| Area | Impact |
|---|---|
| **Database** | 4 new tables (`locations`, `stores`, `factory_store_access`, `user_stores`) + ~10 columns. All additive. |
| **Backend** | Supabase RLS policies split (plant-scope vs store-scope). New `issue_store_item()` RPC. BUSY server untouched. |
| **Frontend** | ~8 files: StockRegister, Maintenance, FAR, UserManagement, AddPurchaseModal, RepairReturnModal, PurchaseOrders, CheckIn. |
| **User management** | **Additive only. No existing assignment altered. No re-login. No revocations.** |
| **Security** | 🟢 Net improvement — closes the FAR-picker leak (§7.4) and the lost-update race (§10.1). ⚠️ New surface: store access must not imply FAR access — needs explicit RLS tests. |
| **Dashboards** | Names auto-update. Location rollup and consolidated/individual Rehla views are new work. |
| **Reporting** | Auto-updates for names. Consolidation + factory attribution depend on Piece B. |
| **Existing clients** | Single-tenant. Non-Rehla factories unaffected if the shared-store path is opt-in (`factory_store_access` empty ⇒ current behaviour). |
| **Historical data** | ✅ Fully preserved — every FK is by UUID. Only 4 denormalized text columns need a backfill. |
| **Performance** | Negligible. One extra join for store lookups; `factory_store_access` will hold <10 rows. Index `store_items(store_id, item_name)`. |
| **Backward compatibility** | ✅ Maintained if `plant_id` is retained alongside `store_id` through a dual-write window. |

---

## 12. 🔒 Hard constraint — existing functionality must not change

Recorded here as a binding requirement on every phase below, per your explicit instruction:

> **The current user-management system is correct and must be preserved exactly as-is.** Assigning a person to multiple factories, assigning a person multiple roles, and everything built around those, works and is not to be altered. Additions are welcome; changes to existing behaviour are not.

Concretely, this means every proposed change must satisfy:

1. **`user_plants` and `user_roles` keep their exact current semantics.** No column changes, no key changes, no re-interpretation. Multi-factory and multi-role assignment behave identically before and after.
2. **`plants.id` is immutable.** Renames touch `plants.name` only. No plant record is deleted or re-keyed. (Retiring `SCPL Odisha` / `K.G` means flagging inactive, never `DELETE`.)
3. **The user-permission migration is additive only.** `user_stores` is *backfilled from* `user_plants` so that on day one every user's effective access is byte-for-byte what it is today. **Nothing is revoked; nothing is granted.**
4. **New pickers are filters, not replacements.** State and Location narrow the factory list in the user form; the underlying write to `user_plants` is unchanged. Store is an *additional* multi-select, not a substitute for the factory multi-select.
5. **`is_global`, tiers, capabilities, and password step-up are untouched.**
6. **`factory_store_access` empty ⇒ today's behaviour exactly.** Sikandarabad and Ganjam keep their independent stores with zero code-path change. The shared-store path is opt-in per location.
7. **No re-login, no session invalidation, no token change** — for any user, at any point.
8. **Regression test 24.18 is a release gate,** not a nice-to-have: a non-shared-store factory must behave identically before and after.

Any proposal that cannot meet all eight comes back for approval before implementation, not after.

---

## 13. Proposed Implementation Plan (§28.11) — **NOT EXECUTED**

### 13.1 Phase 1 — Client confirmation

**Seven of the original twelve questions are answered by the diagram.** Resolved: factory count (five), Sikandrabad spelling, Rehla spelling, SPPL(K) relationship to SPPL, the common-store requirement, the FAR-separation requirement, and the maintenance-separation requirement.

**Five remain. Only #1 blocks implementation.**

1. 🔴 **BLOCKING — Who owns which of the 324 Rehla assets?** The client's FAR (`Fixed Assets Register-SPPL.xlsx`) has **no entity column**, and the identification marks are bare (`GLC1`…`GLC16`) with no entity prefix. Nothing in any file distinguishes an SCPL asset from an SPPL or SPPL(K) one. **A marked-up register is required.** This blocks the FAR split (§8), the maintenance split (§9), and tests 24.4–24.7. Everything else in the plan can proceed without it.

2. 🟡 **What is `SCPL Delhi`, and where does its history belong?** The diagram lists no Delhi factory, yet this record holds 331 FAR rows, 242 tickets, and 241 schedules — identical to SPPL's. Strong hypothesis: it *is* the Rehla FAR, mis-filed under a Delhi label. Confirm before remapping; it cannot simply be retired.

3. 🟡 **Is `SHD` the same site as `Madan`?** (§5.3 — `SHD` looks like an abbreviation of Sikandrabad, and BUSY uses it as the suffix for UP/NCR customers.) If yes, merge. Cheap either way — `SHD` has only 2 store requisitions.

4. 🟢 **"Madan chemical" or "Madan Chemicals Pvt Ltd"?** The diagram says the former; the client's own FAR workbook says the latter. Which goes on screen?

5. 🟢 **Display form: `SPPL(K) – Rehla` or `SPPLK – Rehla`?** The diagram uses parentheses; the original brief used `SPPLK`; the PM workbook tags equipment `SPPLK`. Also — what does **(K)** stand for? It may be a village or section name worth carrying in `location_name`.

**Two recommendations you can simply approve rather than answer:**

- **Old names as searchable aliases:** yes — store them in `plants.legacy_names` so Cmd+K still finds "Rehla" and "SPPL". Zero cost, and it protects anyone who has the old vocabulary in their head.
- **Historical reports show new names:** yes — every report joins `plants(name)` live, so one consistent naming across all history costs nothing and avoids dual-labelling complexity.

Also confirm the §2 inventory against **live production** (read-only) before acting, since §2 is measured from the 2026-07-23 handover snapshot:

```sql
select p.id, p.name,
       (select count(*) from user_plants        where plant_id = p.id) users,
       (select count(*) from fixed_assets       where plant_id = p.id) far,
       (select count(*) from maintenance_tickets where plant_id = p.id) tickets,
       (select count(*) from store_items        where plant_id = p.id) items
from plants p order by p.name;
```

Also run this inventory against **live production** (read-only) to confirm the snapshot:

```sql
select p.id, p.name,
       (select count(*) from user_plants        where plant_id = p.id) users,
       (select count(*) from fixed_assets       where plant_id = p.id) far,
       (select count(*) from maintenance_tickets where plant_id = p.id) tickets,
       (select count(*) from store_items        where plant_id = p.id) items
from plants p order by p.name;
```

### 13.2 Phase 2 — Read-only audit ✅ **This document**

### 13.3 Phase 3 — Locked current→target mapping
Sign off §4 with the client. Produce the marked-up FAR (item 9 above).

### 13.4 Phase 4–6 — Design + impact
Per §3 and §11. Nothing new to decide.

### 13.5 Phase 7 — Implementation sequence (isolated branch, no merge, no deploy)

Ordered so that **every step is independently reversible** and the risky work comes last:

| Step | Change | Risk | Reversible by |
|---|---|---|---|
| **1** | `57_locations.sql` — create `locations`; add `location_id`, `company_name`, `entity_name`, `factory_code`, `legacy_names`, `is_factory` to `plants`. Backfill. **No renames yet.** | 🟢 Additive | Drop columns/table |
| **2** | Frontend cleanup: remove hardcoded arrays; make `PurchaseOrders.tsx` read `plants` live; drive `CheckIn.tsx` from the DB; fix the `Maintenance.tsx:778/812` FAR leak; replace name-matching (`:809`) with id-based form state. **Do this BEFORE renaming** so nothing depends on the old strings. | 🟢 Code only | `git revert` |
| **3** | `58_rename_plants.sql` — `UPDATE plants SET name = …` for the 4 confirmed records + backfill `user_accounts.plant_name`, `anomaly_flags.plant`, `oil_contracts.plant_id`. **Every `plants.id` unchanged.** | 🟢 Data only | `59_rollback_rename.sql` (names captured in `legacy_names`) |
| **4** | Create `SPPL(K) – Rehla` as a new **plant** row (not a unit — see §3.1), `company_name` shared with SPPL – Rehla. Retire `SHD` / `K.G` / `SCPL Odisha` as aliases; flag `HQ` and `SCPL Delhi` `is_factory = false`. | 🟢 Insert + flag | Delete the new row (no dependents yet); clear the flags |
| **5** | `60_stores.sql` — `stores`, `factory_store_access`, `store_items.store_id`, `store_stock_events.store_id` + `requesting_plant_id`, `maintenance_store_requests.source_store_id`. **`plant_id` retained everywhere.** Backfill 1 store per existing plant (identity mapping ⇒ **behaviour unchanged**). | 🟡 Additive, dual-write | Drop columns |
| **6** | `61_merge_rehla_store.sql` — merge the 434 duplicated `Rehla`/`SPPL` items into one `Rehla Common Store`; map all three Rehla factories via `factory_store_access`. **Reconcile quantities with the client first** (are the two copies identical, or has one drifted?). | 🔴 **Highest-risk step** | Full pre-step table snapshot + restore |
| **7** | `62_issue_store_item.sql` — atomic `SECURITY DEFINER` RPC for issues (fixes §10.1). Switch `Maintenance.tsx` handover to it. | 🟡 | Revert to client-side path |
| **8** | `63_user_stores.sql` + RLS split: FAR/maintenance stay on `plant_in_scope`; store tables move to `store_in_scope`. **Backfill `user_stores` from `user_plants` so day-one access is identical.** | 🟡 | `63_rollback` restores `plant_in_scope` |
| **9** | `64_far_remap.sql` — remap the 324 duplicated assets to SCPL/SPPL/SPPLK per the client's marked-up register; retire duplicates. | 🔴 Blocked on Phase 1 #9 | Snapshot + restore |
| **10** | UI: Location tier in dashboards (consolidated + individual Rehla views); Store multi-select in User Management; store column in StockRegister. | 🟢 | `git revert` |

### 13.6 Migration plan (§28.12)

- **Factory master:** rename in place; `id` never changes; old names preserved in `plants.legacy_names` for alias search.
- **Locations:** 3 new rows (Jharkhand/Rehla, Odisha/Ganjam, UP/Sikandarabad) + `plants.location_id` backfill.
- **User assignments:** ✅ **No migration needed** — `user_plants` is UUID-keyed and untouched.
- **Permissions:** `user_stores` backfilled from `user_plants` → **effective access identical on day one**.
- **Stores:** 1:1 identity mapping for every existing plant (no behaviour change), then Rehla's three collapse onto one shared store.
- **FAR:** remap `plant_id` per the client register. **Never delete** — flag superseded rows so history survives.
- **Maintenance:** `plant_id` unchanged (= requesting factory). Add `source_store_id`, backfilled to the factory's own store.
- **Reports/history:** all ID-joined → automatic. Only the 4 denormalized text columns in §7.2 need backfilling.

### 13.7 Rollback plan (§28.13)

Every step ships with a paired rollback script, mirroring the existing convention in this repo (`28_rollback_rls_phase2a.sql`, `37_rollback_store_stock.sql`, `53_rollback_stock_purchases.sql`, etc.).

| Step | Rollback |
|---|---|
| 1, 5 | `drop table` / `drop column` — additive only, nothing else references them |
| 2, 10 | `git revert` (frontend only) |
| 3 | `59_rollback_rename.sql` restores names from `plants.legacy_names` |
| 4 | Delete the new plant rows (verify no dependents first) |
| **6, 9** | 🔴 **Table snapshot before execution** — `create table store_items_backup_YYYYMMDD as select * from store_items;` (same for `fixed_assets`, `store_stock_months`, `store_stock_events`). Restore by truncate + reinsert. |
| 7 | Drop the RPC, revert the client call |
| 8 | `63_rollback` restores `plant_in_scope` on the store tables |

**Global rollback:** because `plants.id` is never mutated and no row is ever deleted, **any subset of steps 1–5 and 7–8 can be reverted independently and in any order.** Only steps 6 and 9 are ordered and snapshot-dependent.

### 13.8 Test results (§28.14) — ⏸️ NOT RUN

Per your §1 restriction, no isolated environment was provisioned and **no test in §24 has been executed**. All 18 scenarios are specified and ready; they run in Phase 10 after approval. Note the following in advance:

- **24.4–24.7 (SPPL / SCPL / SPPLK maintenance + FAR isolation) cannot be executed** until the client supplies the FAR entity split (Phase 1 #9). Every other scenario can run without it.
- **24.9 (concurrent consumption) is expected to FAIL against current code** — the defect is §10.1, already located by inspection. Step 7 of the plan is its fix.
- **24.14 (rename propagation) is expected to FAIL in 9 known places** — §7.2–7.5, all already enumerated. Step 2 of the plan fixes them pre-emptively.
- **24.18 (regression, non-shared store) is the release gate** — per §12.6, `factory_store_access` empty must reproduce today's behaviour exactly.

---

## Appendix A — Worked example: an SPPL(K) maintenance ticket at Rehla

The whole Rehla design rests on one idea, so it is worth stating before the walkthrough:

> **Stock is owned by the STORE. Cost, assets, and accountability are owned by the FACTORY.**
> Today one column — `plant_id` — is doing both jobs. Splitting it into `store_id` (where the stock physically is) and `requesting_plant_id` (who asked and who pays) is the entire fix.

Everything below follows from that. Sikandrabad and Ganjam are unaffected because for them the two answers happen to be the same value (§A.7).

### A.1 The setup

```
locations:            Rehla (Jharkhand)

plants:               SCPL – Rehla        (company: SCPL)
                      SPPL – Rehla        (company: SPPL)
                      SPPL(K) – Rehla     (company: SPPL)

stores:               Rehla Common Store

factory_store_access: SCPL – Rehla      → Rehla Common Store
                      SPPL – Rehla      → Rehla Common Store
                      SPPL(K) – Rehla   → Rehla Common Store

store_items:          ONE row per item.  "Mechanical Seal 45mm"  on_hand = 12
                      store_id = Rehla Common Store       ← not three rows. One.

fixed_assets:         three separate sets, each plant_id = its own factory
```

People:

| Person | Role | `user_plants` (factory access) | `user_stores` (store access) |
|---|---|---|---|
| **Ramesh** | Technician | `SPPL(K) – Rehla` | — |
| **Mukesh** | Store keeper | **— none —** | `Rehla Common Store` |
| **Naresh** | Unit Head, SPPL(K) | `SPPL(K) – Rehla` | — |
| **Rupesh** | Purchase Manager | all 3 Rehla factories | `Rehla Common Store` |

Mukesh is the important row. **He has store access and zero factory access** — which is exactly what your brief §17 asks for: *"Store access must not automatically grant FAR or maintenance access for all factories using that store."*

---

### A.2 Step 1 — Ramesh raises the ticket

He opens Maintenance → *Raise emergency*.

- **Factory picker** shows only `SPPL(K) – Rehla`. It is driven by `allowedPlants` from `PlantScopeContext`, which reads `user_plants`. He cannot select SCPL or SPPL — the options do not exist for him.
- **Asset picker** queries `fixed_assets` where `plant_id = SPPL(K)`. He picks **Centrifugal Pump P-07**.
  - Today this is where the §7.4 bug bites: `Maintenance.tsx:812` falls back to *all* assets if the plant lookup fails. **Step 2 of the plan fixes this before anything is renamed.** With it fixed, SCPL's and SPPL's pumps are not merely hidden — they are never fetched, and RLS on `fixed_assets` blocks them at the database even if the API is called directly.

```sql
INSERT INTO maintenance_tickets
  (type, status, plant_id,          far_asset_id,  equipment,            raised_by)
VALUES
  ('emergency', 'open', «SPPL(K)», «Pump P-07», 'Centrifugal Pump P-07', 'Ramesh Lal');
```

`plant_id = SPPL(K)` is set once, here, and **never changes for the life of the ticket.** That single field is what makes maintenance "different for all 3".

### A.3 Step 2 — Ramesh requests the part → `pending_store`

He types "Mechanical Seal" and the type-ahead offers **Mechanical Seal 45mm — 12 in stock**.

That number comes from the Common Store, not from SPPL(K). This is the one query that must change:

```ts
// TODAY — Maintenance.tsx:770 · the store IS the plant
supabase.from('store_items').select(...).eq('plant_id', ticket.plant_id)

// TARGET — resolve the ticket's factory to its store, then read that store
supabase.from('store_items').select(...).eq('store_id', storeIdFor(ticket.plant_id))
```

```sql
INSERT INTO maintenance_store_requests
  (ticket_id, part_name,             quantity, plant_id,   source_store_id,        store_item_id)
VALUES
  («ticket», 'Mechanical Seal 45mm',  2,       «SPPL(K)»,  «Rehla Common Store»,   «the ONE common row»);
```

**Two different factory-ish columns on one row, and that is the point:**

| Column | Value | Means |
|---|---|---|
| `plant_id` | `SPPL(K) – Rehla` | **who is asking, and who pays** |
| `source_store_id` | `Rehla Common Store` | **where the stock comes out of** |

Ticket → `pending_store`.

### A.4 Step 3 — Mukesh fulfils it, without ever seeing the FAR

Mukesh has no factory membership, so under today's RLS he would see nothing at all. The fix is one extra clause:

```sql
-- maintenance_store_requests: visible via the TICKET's factory, OR via MY STORE
using (public.ticket_in_scope(ticket_id) OR public.store_in_scope(source_store_id))

-- maintenance_tickets: same idea — a ticket drawing on my store is visible to me
using (public.plant_unit_in_scope(plant_id, unit_id)
       OR exists (select 1 from maintenance_store_requests r
                   where r.ticket_id = maintenance_tickets.id
                     and public.store_in_scope(r.source_store_id)))

-- fixed_assets: UNCHANGED. Still plant_in_scope() only.
```

That last line is the whole answer to "how do we share a store without sharing the FAR". Mukesh gets **one queue covering all three factories**, each line labelled with its requesting factory:

| Ticket | Requesting factory | Part | Qty | Shelf |
|---|---|---|---|---|
| #A31 | **SPPL(K) – Rehla** | Mechanical Seal 45mm | 2 | R4-B2 |
| #A28 | SCPL – Rehla | Gasket 6" | 4 | R2-A1 |
| #A30 | SPPL – Rehla | Bearing 6205 | 1 | R7-C3 |

He sets `store_decision = 'available'`, `qty_in_store = 12`, `shelf_location = 'R4-B2'`, `part_condition = 'new'`.

He **cannot** open SPPL(K)'s asset register, cannot see the Pump P-07 FAR row, cannot raise or approve a ticket. He sees the `equipment` text on the ticket — enough context to pick the right part off the shelf — and nothing more. Store access, not factory access.

### A.5 Step 4 — Naresh approves → `pending_unit_head` → `pending_handover`

Naresh is Unit Head of SPPL(K), so the ticket is in his queue. **SCPL's and SPPL's unit heads never see it** — `plant_unit_in_scope(SPPL(K))` excludes them, and no store clause applies because they have no store access.

(If the seal had been out of stock, this is where the ticket branches to `pending_purchase` → `pending_purchase_manager` → `pending_handover`, with the split-fulfilment logic from migration 40 running in parallel — that path is unchanged by any of this, except that a bulk-purchase surplus now lands in the Common Store rather than in a private one.)

### A.6 Step 5 — Handover: the one deduction

This is the step that must become atomic, and the step that produces the row every report is built from.

```sql
-- NEW RPC issue_store_item() — replaces the client-side read-modify-write at
-- Maintenance.tsx:1739-1744 (the lost-update race, §10.1)
UPDATE store_items
   SET on_hand = on_hand - 2, issued_qty = issued_qty + 2
 WHERE id = «the ONE common row»;          -- 12 → 10

INSERT INTO store_stock_events
  (item_id,  store_id,               requesting_plant_id, event_type, qty_delta, ref)
VALUES
  («seal», «Rehla Common Store»,     «SPPL(K)»,           'issue',    -2,  'ticket #A31');
```

**One row deducted, once.** Not two rows of 6 each, which is what the current data actually looks like (§2.1).

And that single event row carries both facts, which is what makes both reports possible off the same data:

- `store_id` → **Store Stock Report**: one consolidated Rehla register
- `requesting_plant_id` → **Factory Consumption / Cost Report**: charged to SPPL(K) alone

This is also why §10.1 stops being a theoretical defect. Today each factory has a private register, so two people rarely touch the same row. **With one shared row and three factories drawing on it, that collision is the normal case** — Mukesh issuing to SPPL(K) while a colleague issues the same seal to SCPL would, under the current client-side code, silently lose one of the two deductions. The RPC makes it row-locked and correct.

### A.7 Step 6–7 — Where the repaired item goes

Ramesh removed 2 old seals. He records the split (migration 56 — the DB constraint enforces `repair_qty + scrap_qty = replaced_qty`, so nothing can silently vanish):

```sql
INSERT INTO maintenance_defective_parts
  (ticket_id, plant_id,  part_name,              replaced_qty, repair_qty, scrap_qty)
VALUES
  («#A31»,   «SPPL(K)», 'Mechanical Seal 45mm',   2,            1,          1);
```

- **The scrapped one** → written off. Cost attributed to SPPL(K).
- **The repaired one** → out to a vendor, then back via `repair_return_receipts` / `repair_return_allocations`, landing in `store_items.repaired_qty` on the **same common row**.

**🟡 This is the one genuine design decision the diagram does not settle, and you should make it explicitly:**

The seal came *out of* common stock. SPPL(K) paid for it and paid to repair it. When it comes back, does it return to the common pool — where SCPL could consume it tomorrow — or is it reserved for SPPL(K)?

**My recommendation: it returns to the common pool, and the repair cost stays charged to SPPL(K).** Rationale: the part was never SPPL(K)'s property, it was common stock issued to an SPPL(K) job. Keeping *physical stock always common* and *cost always factory-attributed* is the single rule that makes the whole model comprehensible — the moment you start reserving individual units per factory, you have re-created three separate stores inside one table and lost the benefit.

The alternative (reserve repaired units for the paying factory) is implementable — a `reserved_for_plant_id` on the return allocation — but it adds a permanent complication to every stock query. **Worth asking the client; not worth assuming.**

### A.8 Step 8 — Close, and what each report then shows

| Report | Grouped by | Output |
|---|---|---|
| **Store Stock Report** | `store_id` | `Rehla Common Store` — Mechanical Seal 45mm: **on_hand 10**, issued 2, repaired 1. **One line, not three.** |
| **Factory Consumption** | `requesting_plant_id` | SPPL(K) – Rehla: 2 seals. SCPL – Rehla: 0. SPPL – Rehla: 0. |
| **Maintenance Cost** | `requesting_plant_id` | Part cost + repair cost + scrap write-off → **SPPL(K) only** |
| **FAR Report** | `plants.id` | Pump P-07 under **SPPL(K) only**. Never appears under SCPL or SPPL. |
| **Maintenance Report** | `plants.id` | Ticket #A31 under **SPPL(K) only** |
| **Rehla consolidated view** | `location_id` | All three factories' maintenance + **one** store register |

### A.9 Who could see what, end to end

| | Ramesh (tech, SPPL(K)) | Mukesh (store keeper) | Naresh (UH, SPPL(K)) | SCPL Unit Head |
|---|---|---|---|---|
| SPPL(K) FAR | ✅ | ❌ | ✅ | ❌ |
| SCPL FAR | ❌ | ❌ | ❌ | ✅ |
| Ticket #A31 | ✅ | ✅ *(via store)* | ✅ | ❌ |
| Common Store stock | ✅ read | ✅ **issue** | ✅ read | ✅ read |
| Approve #A31 | ❌ | ❌ | ✅ | ❌ |
| SPPL(K) costs | ❌ | ❌ | ✅ | ❌ |

Enforced in the database by RLS, not just in the UI — so it holds against direct API calls too (your §15.12 and §18.13).

### A.10 Why Sikandrabad and Ganjam are untouched

You are right that these are already handled, and the design keeps them that way — **not by special-casing them, but because the general model degenerates to their case automatically:**

```
factory_store_access:   Madan Chemical – Sikandrabad  →  Sikandrabad Store   (one row)
                        SCPL – Ganjam                 →  Ganjam Store        (one row)
```

One factory, one store. `storeIdFor(plant_id)` returns their own store. `source_store_id` and `plant_id` resolve to the same site on every row. Every screen, every report, every permission behaves **byte-for-byte as it does today**.

That is the §12.6 guarantee: **`factory_store_access` with one row per factory ⇒ current behaviour exactly.** Test 24.18 exists to prove it, and it is a release gate, not a nice-to-have.

### A.11 What actually has to change for all this

Smaller than it looks — four things, and two of them are bug fixes you want regardless:

| # | Change | Where | Notes |
|---|---|---|---|
| 1 | Read stock by `store_id`, not `plant_id` | `Maintenance.tsx:770`, `StockRegister`, `AddPurchaseModal`, `RepairReturnModal` | The one substantive change |
| 2 | Add `source_store_id` + `requesting_plant_id`; deduct via atomic RPC | migrations, `Maintenance.tsx:1739` | Also fixes the §10.1 race |
| 3 | RLS: `OR store_in_scope(...)` on tickets + store requests; **`fixed_assets` untouched** | new migration | This is what separates store access from FAR access |
| 4 | Fix the FAR-picker fallback | `Maintenance.tsx:778,812` | Pre-existing §8 violation — fix regardless |

The ticket lifecycle itself — `open → pending_store → pending_unit_head → pending_purchase → pending_purchase_manager → pending_handover → pending_defective_return → closed` — **does not change at all.** No new stage, no new screen, no retraining. Ramesh, Mukesh and Naresh do exactly what they do today; the system just stops keeping three copies of one store and starts recording who to charge.

---

## 14. What I did not do

- ❌ No commit, push, merge, or deploy
- ❌ No migration run (production or otherwise)
- ❌ No record renamed, deleted, merged, or split
- ❌ No user, role, or permission modified
- ❌ No configuration change
- ❌ No test environment provisioned; **no §24 scenario executed**
- ❌ No file in the existing codebase modified — **this report is the only file written**

**Awaiting your explicit written approval before any implementation begins.**
