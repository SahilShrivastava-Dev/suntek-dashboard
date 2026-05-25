# Suntek Group Operations Dashboard — Technical Documentation

> **Project:** CaratSense · Suntek Group internal ops platform  
> **Version:** v0.2 (May 2026)  
> **Stack:** React 19 · TypeScript · Vite 8 · Tailwind CSS 3 · React Router v7 · Supabase  

---

## Table of Contents

1. [Project Purpose](#1-project-purpose)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Routing Architecture](#4-routing-architecture)
5. [Role-Based Access Control (RBAC)](#5-role-based-access-control-rbac)
6. [Layout System](#6-layout-system)
7. [Dashboard Modules](#7-dashboard-modules)
8. [Standalone L1 Apps](#8-standalone-l1-apps)
9. [Core Business Algorithms](#9-core-business-algorithms)
10. [Data Layer](#10-data-layer)
11. [UI Patterns & Component Library](#11-ui-patterns--component-library)
12. [Key Design Decisions](#12-key-design-decisions)
13. [Pending Work & Roadmap](#13-pending-work--roadmap)

---

## 1. Project Purpose

The Suntek Group dashboard is an **internal operations platform** for a multi-plant chemical manufacturing business (chlorinated paraffin / CP production). It consolidates data across 4 factories (Rehla, Ganjam, SHD, Bawana) and a port warehouse.

**Core functions it covers:**

| Domain | What it does |
|---|---|
| **Batch production** | Track reactor runs, oil-ratio QC, drum counts per gravity |
| **CPM Stock** | Drums in/out across godowns, 400+ store SKUs, tank levels |
| **Purchase** | Fixed Asset Register, maintenance logs, store requisitions, purchase orders, marine insurance, labour costs |
| **Sales** | Locked-price contracts, dispatch tracking, density-spread pricing |
| **Night Operations** | GPS-verified check-in photos from overnight shift workers |
| **Finance** | Customer ledger, outstanding payments, marine insurance balance |

The platform is designed for **multiple user levels** — from factory floor operators who only log batch readings, up to the owner who sees everything.

---

## 2. Technology Stack

| Layer | Choice | Version |
|---|---|---|
| UI Framework | React | 19.2.6 |
| Language | TypeScript | 5.x |
| Build Tool | Vite | 8.0.14 |
| CSS | Tailwind CSS | 3.4.19 |
| Routing | React Router | v7.15.1 |
| Backend / DB | Supabase (PostgreSQL + Auth) | latest |
| Icons | Inline SVG (no icon library) | — |

---

## 3. Project Structure

```
suntek-dashboard/
├── src/
│   ├── App.tsx                        # Root: routes tree, wraps RoleProvider
│   ├── main.tsx                       # Entry point
│   ├── index.css                      # Global Tailwind + design tokens
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── DashboardLayout.tsx    # Shell: sidebar + topbar + outlet + access guard
│   │   │   ├── Sidebar.tsx            # Role-filtered navigation
│   │   │   ├── TopBar.tsx             # Page title + ProfileSwitcher
│   │   │   ├── ProfileSwitcher.tsx    # Role preview dropdown (top-right)
│   │   │   └── RestrictedAccess.tsx   # Shown when role lacks route permission
│   │   ├── charts/
│   │   │   ├── CPMStockMatrix.tsx     # Density × location heatmap
│   │   │   └── TankLevels.tsx         # Tank capacity bars
│   │   ├── tables/
│   │   │   └── MovementsFeed.tsx      # Today's movements feed component
│   │   └── tiles/
│   │       └── KPITile.tsx            # Generic KPI number tile
│   │
│   ├── contexts/
│   │   └── RoleContext.tsx            # Active profile state + switchProfile()
│   │
│   ├── hooks/
│   │   └── useAuth.ts                 # Supabase auth hook
│   │
│   ├── lib/
│   │   ├── profiles.ts                # Mock profiles + profileCanAccess()
│   │   ├── supabase.ts                # Supabase client init
│   │   ├── database.types.ts          # Auto-generated Supabase types
│   │   ├── algorithms/
│   │   │   ├── batchQC.ts             # Batch yield QC vs Oil Ratio Table
│   │   │   ├── densityPricing.ts      # Dispatch price with density spread
│   │   │   ├── geofencing.ts          # Haversine GPS check-in validation
│   │   │   └── laborCost.ts           # Labour cost derivation + marine deduction
│   │   └── utils/
│   │       ├── formatting.ts          # Currency, date, number formatters
│   │       └── rbac.ts                # RBAC utility helpers
│   │
│   ├── data/
│   │   └── mockData.ts                # All in-memory mock data (replaces DB for now)
│   │
│   └── routes/
│       ├── auth/
│       │   └── Login.tsx
│       ├── dashboard/
│       │   ├── Overview.tsx           # Main dashboard home
│       │   ├── Sales.tsx              # Contracts + dispatch
│       │   ├── CPMStock.tsx           # Inventory matrix + store items
│       │   ├── BatchSheet.tsx         # Active batch tracker
│       │   ├── CustomerHistory.tsx    # Customer ledger
│       │   ├── NightManagerBoard.tsx  # Night shift GPS map
│       │   ├── OilRatioTable.tsx      # Density coefficients reference
│       │   ├── AuditLog.tsx           # Full system audit trail
│       │   ├── NightEntry.tsx         # Embedded check-in (Night Manager role)
│       │   ├── BatchEntry.tsx         # Embedded batch logger (Operator role)
│       │   └── purchase/
│       │       ├── PurchaseLayout.tsx # Purchase hub with shared stage flow
│       │       ├── FAR.tsx            # Fixed Asset Register
│       │       ├── Maintenance.tsx    # Equipment maintenance log
│       │       ├── ActivityLog.tsx    # Plant worker activity
│       │       ├── StoreRequisitions.tsx
│       │       ├── PurchaseOrders.tsx
│       │       ├── MarineInsurance.tsx
│       │       └── Labour.tsx         # Per-plant labour cost
│       ├── night-manager/
│       │   └── CheckIn.tsx            # Standalone GPS check-in app
│       ├── operator/
│       │   └── BatchLogger.tsx        # Standalone batch reading entry app
│       └── warehouse/
│           └── Warehouse.tsx          # Standalone warehouse entry app
│
├── Data/                              # Raw Excel files from operations teams
│   ├── Sales Report 26-27.xlsx
│   ├── Purchase 2026-27.xlsx
│   └── CP and Stock 2026-27.xlsx
│
├── DOCUMENTATION.md                   # This file
├── package.json
└── vite.config.ts
```

---

## 4. Routing Architecture

All routes are declared in `src/App.tsx`. The structure uses **React Router v7 nested routes**.

### Route Tree

```
/login                          → Login (no layout)

/dashboard                      → DashboardLayout (shell)
  /dashboard/                   → Overview
  /dashboard/purchase           → PurchaseLayout (sub-shell)
    /dashboard/purchase/far     → FAR
    /dashboard/purchase/maint   → Maintenance
    /dashboard/purchase/activity → ActivityLog
    /dashboard/purchase/storereq → StoreRequisitions
    /dashboard/purchase/purchase → PurchaseOrders
    /dashboard/purchase/marine  → MarineInsurance
    /dashboard/purchase/labour  → Labour
  /dashboard/sales              → Sales
  /dashboard/stock              → CPMStock
  /dashboard/batches            → BatchSheet
  /dashboard/customers          → CustomerHistory
  /dashboard/night-manager      → NightManagerBoard
  /dashboard/oil-ratio          → OilRatioTable
  /dashboard/audit              → AuditLog
  /dashboard/night-entry        → NightEntry  ← embedded L1 check-in
  /dashboard/batch-entry        → BatchEntry  ← embedded L1 batch logger

/night-manager/check-in         → CheckIn (standalone — no sidebar)
/warehouse                      → Warehouse (standalone)
/warehouse/stock-entry          → Warehouse
/warehouse/requisition          → Warehouse
/operator/batch-logger          → BatchLogger (standalone)

/                               → redirect → /dashboard
/*                              → redirect → /dashboard
```

### Two App Modes

| Mode | Routes | Has Sidebar |
|---|---|---|
| **Dashboard** | `/dashboard/*` | ✅ Yes — DashboardLayout |
| **Standalone L1 app** | `/warehouse`, `/operator/*`, `/night-manager/*` | ❌ No — fullscreen only |

L1 apps can also be **embedded inside the dashboard** via `/dashboard/night-entry` and `/dashboard/batch-entry` — they render with `embedded={true}` which hides their own header/shell.

---

## 5. Role-Based Access Control (RBAC)

### Overview

The RBAC system has two layers:
1. **Sidebar filtering** — navigation items are hidden if the role can't access the route
2. **Route guard** — if someone navigates directly to a URL they can't access, `<RestrictedAccess />` is rendered instead of the page

Both layers use the same `profileCanAccess(profile, route)` function.

### Profile Definitions (`src/lib/profiles.ts`)

Six mock profiles exist, representing the real operational hierarchy:

| ID | Name | Level | Role | Home Route |
|---|---|---|---|---|
| `admin` | Sagar Nenwani | L4 | Owner · Admin | `/dashboard` |
| `unit_head` | Vijay Ji | L3 | Unit Head | `/dashboard` |
| `warehouse_manager` | Ramesh Yadav | L2 | Warehouse Manager | `/dashboard/stock` |
| `labour_manager` | Mohan Lal | L2 | Labour Manager | `/dashboard/purchase/labour` |
| `night_manager` | Devraj Singh | L1 | Night Manager | `/dashboard/night-entry` |
| `factory_operator` | Shyam Patel | L1 | Factory Operator | `/dashboard/batch-entry` |

### `allowedDashboardRoutes` per role

```
admin:               ['*']   ← full access

unit_head:           /dashboard
                     /dashboard/batches
                     /dashboard/stock
                     /dashboard/night-manager   ← VIEW board only
                     /dashboard/purchase/far
                     /dashboard/purchase/maint
                     /dashboard/purchase/activity
                     /dashboard/purchase/storereq
                     /dashboard/purchase/purchase
                     /dashboard/oil-ratio
                     /dashboard/audit
                     — NOT: sales, customers, marine, labour, night-entry, batch-entry

warehouse_manager:   /dashboard/stock
                     /dashboard/purchase/storereq

labour_manager:      /dashboard/purchase/labour
                     /dashboard/purchase/activity

night_manager:       /dashboard/night-entry    ← ENTRY only, not the board

factory_operator:    /dashboard/batch-entry    ← ENTRY only, not the sheet
```

### VIEW vs ENTRY Distinction

This is the **core architectural principle**:

| Level | Principle | Example |
|---|---|---|
| L3–L4 | **VIEW aggregated boards** | Unit Head sees Night Manager GPS map but cannot submit a check-in |
| L1–L2 | **ENTER operational data** | Night Manager can only see the check-in form, not any other dashboard |

Night Manager has `/dashboard/night-entry` (entry form) but NOT `/dashboard/night-manager` (GPS board). Unit Head has the board but not the entry form.

### `profileCanAccess()` — Exact Match Only

```typescript
export function profileCanAccess(profile: MockProfile, route: string): boolean {
  if (profile.allowedDashboardRoutes.includes('*')) return true;
  return profile.allowedDashboardRoutes.includes(route); // EXACT match
}
```

**Why exact match?** An earlier version used `route.startsWith(allowed + '/')` (prefix matching). This caused a critical bug: Unit Head had `/dashboard` in their routes, so ALL `/dashboard/*` paths were accessible — including `/dashboard/night-entry` and `/dashboard/batch-entry` (L1 entry terminals). Exact match eliminates this entirely.

### `isViewingAs` Banner

When any profile other than `admin` is active, `DashboardLayout` renders an orange "Viewing as [role]" banner at the top of every page with a "← Back to Admin" button.

### Profile Switcher

Located in the `TopBar` (top-right corner). Dropdown lists all 6 profiles with:
- Avatar (gradient, initials)
- Name, role label, description
- Plant location if applicable
- Access note (what they can/cannot see)
- Access badge: **Full** (green) / **N views** (blue) / **App only** (amber)

Selecting a profile calls `switchProfile(id)` + `navigate(profile.homeRoute)`.

---

## 6. Layout System

### `DashboardLayout`

The outer shell for all `/dashboard/*` routes. Renders:
- `<Sidebar />` — fixed 260px left column
- `<main>` — scrollable right content area (margin-left: 260px)
  - `<TopBar />` — page title + breadcrumb + ProfileSwitcher
  - "Viewing as" banner (conditional)
  - `{canAccessRoute ? <Outlet /> : <RestrictedAccess />}`

**Purchase root special case:** `/dashboard/purchase` itself isn't in any `allowedDashboardRoutes` (it immediately redirects to the first sub-tab). The layout allows it through if the profile has access to **any** purchase sub-tab.

### `Sidebar`

Role-filtered navigation with 4 sections:

```
WORKSPACE   → Overview, Purchase (accordion with visible sub-tabs only)
OPERATIONS  → Batch Sheet, Night Manager board, CPM Stock,
              Warehouse App (Admin + Warehouse Manager),
              Batch Logger shortcut (Admin only),
              Night Check-in (Night Manager role),
              Log Reading (Factory Operator role)
FINANCE     → Sales, Customer History
REFERENCE   → Oil Ratio Table, Audit Log
```

Section headers are hidden when no items in that section are visible for the active role. This means Labour Manager sees only "Purchase" accordion (with Labour + Activity tabs) — no other sections appear at all.

Bottom of sidebar: user card showing the active profile's name, role, and plant.

### `RestrictedAccess`

Shown when a role navigates (directly or via URL) to a route outside their `allowedDashboardRoutes`. Displays:
- Lock icon + "Access Restricted"
- Profile badge + access note
- "Go to my section" button → `navigate(activeProfile.homeRoute)`
- "← Back to Admin" button (only when `isViewingAs`)

---

## 7. Dashboard Modules

### Overview (`/dashboard`)

The main landing page for Admin and Unit Head. Contains:

| Section | Description | Interactive |
|---|---|---|
| Hero card | Date widget, pending approvals count, company filter, voice button | Company dropdown (SCPL/SPPL/KG/Madan/All), period filter (Q1-Q4/FY) |
| KPI grid | All companies card (labour cost, approve/review buttons), Sales KPI, Purchase KPI, System lock, Quarterly target donut, Active batches, Customer snapshot | All cards clickable → relevant module |
| Movements feed | Today's stock/batch/sales/purchase/maintenance events with search + type filter | Row click → navigates to relevant module |
| Modules list | Quick-nav to all 6 main modules | Click → navigate |
| Alerts panel | 7 open alerts with severity (red/amber/low) | Click → navigates to relevant section |
| CPM Stock matrix | Density × location heatmap | "Open Stock →" button |
| Tank levels | 6 tanks with fill bars and alert flags | Click any tank → `/dashboard/stock` |

### Sales (`/dashboard/sales`)

| Section | Description |
|---|---|
| KPI tiles | CP sales MTD, HCL MTD, open contracts count, avg dispatch/day |
| Info banner | Explains how a sale auto-updates stock, contracts, labour, Busy |
| Contracts table | Customer, density, locked price, booked/dispatched/pending drums, progress bar, status |

**+ New contract button** opens a modal with:
- Customer name (text input)
- Density grade selector (1300/1400/1450/1500 toggle chips)
- Locked price + booked qty (side-by-side inputs)
- Live contract value preview (qty × price)
- Save → green success state → auto-close

**Row click** expands an inline detail row showing progress %, pending drums, pending value, and a "Log dispatch" button.

### CPM Stock (`/dashboard/stock`)

| Section | Description |
|---|---|
| KPI tiles | Total CP drums, HCL stock, below-threshold SKU count, tank capacity % |
| CP density matrix | Density × location table with heatmap cell shading |
| Tank levels | Per-tank capacity bars with alert colours |
| Store items table | 400+ SKUs with opening/in/out/closing/threshold, status badge |

**Bulk update button** opens a modal with:
- Multi-row entry (item name / qty / IN-OUT toggle / note per row)
- + Add another item / × remove row
- Save button with live count: "Save 3 updates"
- Success state → auto-close

### Batch Sheet (`/dashboard/batches`)

Displays active reactor runs across all plants. Each batch shows: number, plant, recipe, target gravity, current gravity, drums filled, elapsed time, operator, QC status.

**Relationship to Oil Ratio Table:** When a batch reading is logged (CP gravity), the system uses `batchQC.ts` to compare actual yield vs. expected yield from the Oil Ratio Table. Variance > 3% triggers a QC flag.

### Night Manager Board (`/dashboard/night-manager`)

GPS overview of all overnight shift workers. Shows:
- Worker cards with name, role, plant, last check-in time, GPS status (green/amber/red)
- Map pins with geofence status
- Workers flagged "out of zone" (e.g. Manoj at 42 min ago)

### Customer History (`/dashboard/customers`)

Per-customer ledger showing:
- MTD quantity and value, 12-month value, average order size
- Outstanding balance
- Trend indicator (↑/↓ %)
- Click to expand: monthly order history bar chart, density preference breakdown, payment terms

### Oil Ratio Table (`/dashboard/oil-ratio`)

The "brain" of the production system. Reference table of per-density coefficients:

| Column | Meaning |
|---|---|
| Density | CP target gravity (1100–1500) |
| NP / kg CP | Normal paraffin input ratio |
| Waxol / kg CP | Waxol solvent ratio |
| Cl₂ / kg CP | Chlorine gas consumption |
| HCL produced | HCL byproduct per kg CP |
| Last variance | Most recent batch deviation from expected |
| Status | In tolerance / Flagged |

**Two variants:** Suntek baseline and Manav & KG (Feb revision) — toggle via chips.

**Row click** opens a side detail panel showing all 4 coefficients as individual cards plus a variance highlight and a "Compare variant" link.

### Purchase Hub (`/dashboard/purchase/*`)

Nested layout (`PurchaseLayout`) with a shared stage-flow progress bar at the top and 7 sub-tabs:

| Sub-tab | Route | What it shows |
|---|---|---|
| FAR · Fixed Assets | `/far` | Equipment register with model, capacity, value, invoice |
| Maintenance | `/maint` | Equipment repair/service log by plant and date |
| Activity Log | `/activity` | Plant worker activity — inspections, calibrations, photo logs |
| Store Req | `/storereq` | Requisition pipeline: authorisation → unit-head → in-stock → purchase |
| Purchase Orders | `/purchase` | POs with supplier, material, quantity, status |
| Marine Ins. | `/marine` | Marine insurance fund ledger (auto-deducted on dispatch) |
| Labour | `/labour` | Per-plant labour costs with production vs. sales qty |

### Audit Log (`/dashboard/audit`)

Full timestamped trail of all system events across all modules.

---

## 8. Standalone L1 Apps

These are separate full-screen apps without the dashboard sidebar. Used by L1 workers on mobile/tablet.

### Night Manager Check-In (`/night-manager/check-in`)

**Purpose:** GPS-verified photo check-in for overnight shift workers.

**Flow:**
1. Worker opens app → sees plant selector + check-in button
2. App requests GPS location
3. `validateGeofence()` checks if within 200m of plant coordinates
4. Worker uploads shift photo
5. Submission creates a record in Supabase

**Embedded variant:** When rendered at `/dashboard/night-entry` (for Night Manager profile inside the dashboard), `embedded={true}` is passed → hides the standalone header, uses compact layout.

### Batch Logger (`/operator/batch-logger`)

**Purpose:** Factory operator logs batch readings — CP gravity, drum count, machine readings.

**Flow:**
1. Operator selects active batch
2. Logs current CP gravity reading
3. System calls `runBatchQC()` to compare vs Oil Ratio Table
4. If variance > 3% → QC flag shown to supervisor
5. "Close Batch & Run QC" finalises the batch

**Embedded variant:** At `/dashboard/batch-entry` with `embedded={true}` → hides dark-slate header, transparent background.

### Warehouse App (`/warehouse`)

**Purpose:** Warehouse manager logs physical stock movements — drums in/out, store item changes, raise requisitions.

Three sub-views: main stock view, stock-entry form, requisition form.

---

## 9. Core Business Algorithms

All algorithms live in `src/lib/algorithms/` and are pure TypeScript functions — no React dependencies.

### `batchQC.ts` — Batch Yield Quality Check

**When used:** When a batch is closed or a CP gravity reading is logged.

**Logic:**
```
expectedYieldKg   = paraffinWeightKg × np_ratio   (from Oil Ratio Table)
expectedYieldDrums = expectedYieldKg / 240          (240 kg per drum)
variancePct       = (actual - expected) / expected × 100

expectedHclKg     = paraffinWeightKg × cl2_consumption × hcl_output
hclVariancePct    = (actual - expected) / expected × 100

isFlagged         = |variancePct| > 3.0% OR |hclVariancePct| > 3.0%
```

**Key function:** `runBatchQC(input: BatchQCInput): BatchQCResult`

---

### `densityPricing.ts` — Dispatch Price with Density Spread

**When used:** At time of dispatch, when actual batch gravity differs from the gravity locked in the sales contract.

**Formula:**
```
finalPrice = lockedContractPrice + (actualDensity - preferredDensity) × spreadMultiplier
```
Default spread multiplier: **₹50 per density unit**.

**Example:** Contract locked at 1400, batch came out at 1450, locked price ₹85/drum:
```
adjustment = (1450 - 1400) × ₹50 = ₹2,500 per drum
finalPrice = ₹85 + ₹2,500 = ₹2,585/drum
```

**Key function:** `calculateDispatchPrice(input): DensityPricingResult`

---

### `geofencing.ts` — Night Manager GPS Validation

**When used:** Every time a night shift worker submits a check-in photo.

**Algorithm:** Haversine formula — calculates great-circle distance between employee's GPS coordinates and plant center coordinates. If distance > 200m, worker is flagged "out of zone".

```typescript
haversineDistance(lat1, lng1, lat2, lng2) → distance in metres
validateGeofence(employeeLat, lng, plantLat, lng, 200) → { isOnSite, statusLabel }
```

---

### `laborCost.ts` — Labour Cost Auto-Derivation

**When used:** Labour costs are computed from production throughput (purchased + sold quantity) rather than manually entered.

```
computedCost = (purchasedQtyMT + salesQtyMT) × targetCostPerMT
isFlagged    = |variancePct| > 5.0%
```

Also contains `deductMarineInsurance()` — subtracts dispatch value from marine insurance balance and triggers alert if balance falls below ₹1 Crore.

---

## 10. Data Layer

### Current State: Mock Data

All data is stored in `src/data/mockData.ts` as in-memory TypeScript arrays. This is the source of truth for the current prototype.

**Exported datasets:**

| Export | Used by |
|---|---|
| `FAR` | FAR.tsx |
| `MAINT` | Maintenance.tsx |
| `ACTIVITY` | ActivityLog.tsx |
| `STORE_REQ` | StoreRequisitions.tsx |
| `REQUIREMENTS` | PurchaseOrders.tsx |
| `MARINE_LEDGER` | MarineInsurance.tsx |
| `LABOUR_PLANTS` | Labour.tsx |
| `CONTRACTS` | Sales.tsx |
| `TANKS` | CPMStock.tsx, Overview.tsx |
| `CP_LOCATIONS / CP_DENSITIES / CP_MATRIX` | CPMStock.tsx, Overview.tsx |
| `STORE_ITEMS` | CPMStock.tsx |
| `ACTIVE_BATCHES` | BatchSheet.tsx |
| `CUSTOMERS / SAMARTH_HISTORY / SAMARTH_DENSITY` | CustomerHistory.tsx |
| `NIGHT_DUTY` | NightManagerBoard.tsx |
| `MOVEMENTS` | Overview.tsx |
| `MODULES` | Overview.tsx |
| `ALERTS` | Overview.tsx |
| `OIL_RATIO_SUNTEK / OIL_RATIO_MANAV` | OilRatioTable.tsx, BatchSheet.tsx |
| `BATCH_GRID_PATTERN` | Overview.tsx |

### Supabase Schema (Planned)

Connection configured in `src/lib/supabase.ts`. Types auto-generated in `src/lib/database.types.ts`.

Planned tables (not yet live):
- `batches` — batch production records
- `batch_readings` — CP gravity readings per batch
- `stock_movements` — all in/out events
- `store_items` — SKU master + current stock
- `contracts` — sales contracts
- `dispatches` — individual dispatch records
- `night_checkins` — GPS + photo check-in records
- `purchase_orders` — PO records
- `maintenance_log` — equipment service records
- `users` — auth + role assignments

### Excel Data Pending Ingestion

Three Excel files in `/Data/` contain historical operational data entered manually by the ops team:

| File | Contents | Who manages it | Target module |
|---|---|---|---|
| `Sales Report 26-27.xlsx` | Customer-wise sales, dispatch dates, quantities, prices | Admin (bulk import from Busy accounting) | Sales page |
| `Purchase 2026-27.xlsx` | Purchase orders, suppliers, quantities, payment status | Warehouse Manager / Unit Head | Purchase hub (all sub-tabs) |
| `CP and Stock 2026-27.xlsx` | Oil contracts, CP stock levels, density-wise inventory | Unit Head / Admin | CPM Stock, Oil Ratio |

**Planned approach:** Parse and import via a one-time migration script; thereafter data flows through the dashboard forms.

---

## 11. UI Patterns & Component Library

### Design Tokens (CSS variables in `index.css`)

```css
--green-soft   /* light green card background */
--red-soft     /* light red card background */
--blue-soft    /* light blue badge background */
--accent-soft  /* light orange badge background */
--accent-deep  /* dark orange text */
--dark         /* #0F172A — buttons, dark chips */
--border       /* #E2E8F0 — card borders */
--muted        /* #94A3B8 — secondary text */
```

### CSS Classes

| Class | Usage |
|---|---|
| `.card` | White rounded-2xl shadow card |
| `.btn-accent` | Orange filled button |
| `.btn-dark` | Dark/black button |
| `.btn-ghost` | Outline button |
| `.btn-outline` | Border-only button |
| `.pill` | Round pill shape modifier |
| `.chip` | Small label chip (filter tags) |
| `.chip.active` | Selected chip |
| `.nav-link` | Sidebar navigation item |
| `.nav-link.active` | Active page highlight |
| `.nav-sub` | Indented sub-nav for accordion |
| `.badge` | Coloured status label |
| `.density-pill` | Density grade label (e.g. "1400") |
| `.dt` | Data table (`<table>`) |
| `.progress` | Thin progress bar container |
| `.num` | Numeric font (tabular) |
| `.serif` | Serif display font for headlines |
| `.toast` | Floating notification |

### Modal Pattern

Used in Sales (new contract) and CPMStock (bulk update). Standard structure:

```tsx
{showModal && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}
    onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
  >
    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-7">
      {/* Header with × close button */}
      {/* Form content OR success state */}
      {/* Action buttons */}
    </div>
  </div>
)}
```

### Dropdown Pattern

Used in Overview (company/period filters) and ProfileSwitcher. Always uses:
- `useRef` + `useEffect` for outside-click close
- Chevron rotates 180° when open (`transform: rotate(180deg)`)
- `z-50` to float above content
- `rounded-2xl shadow-lg` panel

---

## 12. Key Design Decisions

### Why exact match for `profileCanAccess`?

Prefix matching (`route.startsWith(allowed + '/')`) caused Unit Head (who has `/dashboard` allowed) to gain access to `/dashboard/night-entry` and `/dashboard/batch-entry`. These are L1 entry terminals — operators type readings there; supervisors should never see them. Exact match eliminates the bug permanently. All allowed routes are explicit, so prefix matching adds no value.

### Why embed L1 apps inside DashboardLayout?

When a Night Manager profile is active, navigating away from the dashboard (to `/night-manager/check-in`) loses the sidebar — making it impossible to switch back to Admin without typing a URL. By embedding the check-in form at `/dashboard/night-entry`, the sidebar stays visible and the profile switcher remains accessible in the top bar.

### Why is CPM Stock in OPERATIONS, not FINANCE?

CPM (chlorinated paraffin) stock is physical drum inventory — it's a production output, not a financial asset. The Warehouse Manager (L2, operations role) manages it. Finance data (marine insurance fund balance, customer outstanding, sales revenue) is restricted to higher roles. Physical inventory is operational.

### Why does Unit Head NOT see Sales or Customers?

Sales contracts are agreed at the owner/admin level. Customer outstanding and payment terms are managed by the accounts team. The Unit Head's mandate is operations oversight (factory output, procurement, maintenance) — not the commercial side.

---

## 13. Pending Work & Roadmap

### Immediate (next sprint)

- [ ] **Supabase integration** — wire all mock data arrays to live DB tables
- [ ] **Excel ingestion** — parse `/Data/` files and seed Supabase tables
- [ ] **BatchLogger QC flow** — connect "Close Batch & Run QC" to `runBatchQC()` and show result modal
- [ ] **Dispatch log flow** — connect "Log dispatch" button in Sales contracts to stock decrement + contract balance update
- [ ] **Night Manager map** — real GPS dots instead of mock coordinates

### Medium term

- [ ] **Supabase Auth** — replace mock profiles with real `users` table + role column
- [ ] **Real-time updates** — Supabase subscriptions for batch readings, night check-ins, stock movements
- [ ] **Mobile responsiveness** — sidebar collapses to bottom nav on mobile for L1 apps
- [ ] **Photo storage** — Supabase Storage for night check-in photos and maintenance pics
- [ ] **Busy accounting sync** — pull sales data from Busy automatically

### Future

- [ ] **Notifications** — push alerts for out-of-zone workers, low stock, QC flags
- [ ] **Reporting** — PDF export of batch reports, purchase summaries
- [ ] **Multi-company view** — SCPL / SPPL / KG / Madan company selector actually filters data
- [ ] **FY period filter** — Q1/Q2/Q3/Q4 selector actually filters all KPIs by period

---

## Appendix: Role Access Matrix

| Route | Admin | Unit Head | Warehouse Mgr | Labour Mgr | Night Mgr | Factory Op |
|---|---|---|---|---|---|---|
| `/dashboard` (Overview) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/batches` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/stock` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/dashboard/night-manager` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/sales` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/customers` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/purchase/far` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/purchase/maint` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/purchase/activity` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `/dashboard/purchase/storereq` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/dashboard/purchase/purchase` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/purchase/marine` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/purchase/labour` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `/dashboard/oil-ratio` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/audit` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/dashboard/night-entry` | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `/dashboard/batch-entry` | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

*Suntek Group · CaratSense · Internal Use Only*  
*Last updated: May 2026*
