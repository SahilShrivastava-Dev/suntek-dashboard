# Suntek Group Operations Platform — Phase 2 Change Document

**Branch:** `feature/phase-2`  ·  **Base:** `main`
**Scope:** 78 files changed, ~7,567 insertions / ~1,119 deletions across 7 commits.
**Status:** Build green (`npm run build`), 43 unit tests green (`npm test`), Python analytics service compiles and runs.

This document records everything changed in Phase 2. It has two parts:

- **Track A — Production hardening:** turning the demo into a production-grade system of record (typed persistence, real auth, resilience, performance, tests).
- **Track B — Dashboard Intelligence & Anomaly Operations:** the full scope of `Suntek_Phase2_Scope.docx` (§3 dashboard enhancements, §4 anomaly applications, §5 engine).

---

## 1. Commit summary

| Commit | Title |
|--------|-------|
| `6aaf379` | Track A hardening: typed persistence, auth, resilience, perf, tests |
| `c2e512a` | Track B: Anomaly Operations Center (doc §3.1) |
| `2b8d80e` | Track B: Cost & Margin engine + intelligence panel (doc §3.2) |
| `3319e8d` | Track B: Multi-plant benchmarking (doc §3.3) |
| `173d868` | Track B: Python FastAPI analytics service (doc §4 + §5) |
| `227f48f` | Track B: Predictive QC board, Owner layer, Working Capital (§3.4/3.5/3.6) |
| `168807b` | chore: gitignore Python bytecode/venv for analytics service |

---

## 2. Why this work happened

The platform was feature-rich but **demo-grade**: financial KPIs were live from Busy/MSSQL, but operational modules read hardcoded arrays from `src/data/mockData.ts`; auth defaulted to L4 admin if Supabase was unavailable; ~210 `as any` casts bypassed the type system; there were zero tests; `alert()` was the error UX; and the whole app shipped as a single 1.4 MB bundle.

The Phase 2 scope doc then asked for an intelligence layer on top — a cost engine, an anomaly operations center, predictive QC, and five more anomaly apps — powered by a new Python analytics service.

**Governing decision:** harden first (so the operational modules persist real data — which is also the data-collection runway the predictive apps need), then build the intelligence layer. Per the user, where real historical data is thin, the analytics service runs on **synthetic data in demo mode** so every detector exercises its full logic today.

---

## TRACK A — Production Hardening

### A1. Authentication & RBAC integrity

**Files:** `src/hooks/useAuth.ts`, `src/routes/auth/Login.tsx`, `src/components/layout/DashboardLayout.tsx`

- **Fail closed:** an authenticated user with no `profiles` row is now granted **L1** (lowest), never L4 admin (previously it defaulted to admin — a privilege-escalation hole).
- **Production auth gate:** `DashboardLayout` redirects to `/login` when `import.meta.env.PROD && !session`. Development keeps the bypass so the role/profile switcher demo works without standing up auth.
- **Login:** the "Enter dashboard directly" bypass is now wrapped in `import.meta.env.DEV` (absent from production builds); auto-redirects if already signed in.

### A2. Persistence layer + killing mock data

**New:** `src/lib/db.ts`, `src/hooks/useTable.ts`
**Touched:** all dashboard + purchase + operator modules; `src/lib/database.types.ts`

- **`src/lib/db.ts`** — typed write helpers `insertRows` / `updateRows` / `upsertRows`. They enforce the Insert/Update **shape at the call site** and confine the one unavoidable Supabase typing cast to a single file, instead of scattering `(supabase.from(x) as any)` across every page.
- **`src/hooks/useTable.ts`** — a reusable typed CRUD + React Query + realtime hook (used by the Anomaly Center; available for future modules).
- **Reads** are typed via `.returns<T>()` throughout.
- **Mock data killed:** CPM Stock tanks + density matrix, and the Overview alerts feed, now read from real Supabase tables (migrations 0002, 0003). The mock arrays that remain (`MODULES`, `BATCH_GRID_PATTERN`, Oil Ratio coefficients, a CustomerHistory sample) are legitimately UI/reference constants, not transactional state.
- **`database.types.ts`** — added typed definitions for every table the app touches and introduced an `OptionalNulls<>` helper so nullable/defaulted columns are correctly optional on insert (hand-written `Omit<Row>` wrongly made every column required). `as any` count went from ~210 to effectively 0 in the data layer.

> **Note on strict schema:** making the schema fully satisfy supabase-js's `GenericSchema` was attempted and reverted — without relationship metadata it breaks every embedded-join select (`select('*, plants(name)')` → `SelectQueryError`). The correct fix is `supabase gen types typescript` against the live DB; documented in the header of `database.types.ts`. The loose schema + confined `db.ts` casts is the right interim state.

### A3. Resilience — errors, loading, empty states

**New:** `src/components/ErrorBoundary.tsx`, `src/components/ui/toast.tsx`, `src/components/ui/states.tsx`, `src/lib/utils/cn.ts`
**Touched:** `src/main.tsx` (mounts ErrorBoundary + ToastProvider), every data module

- **ErrorBoundary** at the app root + per-page (keyed on path, so a crashed page resets on navigation rather than blanking the shell).
- **Toast system** (`ToastProvider`/`useToast`) — the non-blocking replacement for `alert()`. **All `alert()` calls removed** across the app.
- **Shared async-state primitives** — `Skeleton`, `SkeletonRows`, `EmptyState`, `ErrorState`, `AsyncState` — so every list renders loading → data → empty/error consistently instead of blank tables.
- **`cn()`** — Tailwind class merge helper (clsx + tailwind-merge, previously installed but unused).

### A4. God-component decomposition

| Component | Before | After | Extracted to |
|-----------|--------|-------|--------------|
| `Overview.tsx` | 827 | 696 | `components/overview/StockSnapshot.tsx`, `AlertsPanel.tsx` |
| `purchase/Maintenance.tsx` | 1,233 | 1,086 | `purchase/maintenance/shared.tsx` (constants, helpers, `PhotoUploader`, `StageStrip`) |
| `operator/BatchLogger.tsx` | 1,037 | 798 | `operator/uploadPanels.tsx` (5 Sales/Purchase upload + review panels) |

All extractions are pure relocations (display components / pure helpers) — behaviour-identical, build- and test-verified.

### A5. Test foundation

**New:** `vitest.config.ts`, `src/test/setup.ts`, 7 test files (43 tests total)

Vitest + React Testing Library + jsdom. Kept the Vitest config separate from `vite.config.ts` so the production `tsc` build doesn't pull in Vitest's type augmentation (Vite 8 / rolldown vs vitest-bundled Vite had a plugin-type clash).

| Test file | Tests | Covers |
|-----------|-------|--------|
| `batchQC.test.ts` | 7 | yield variance, 3% flag, drum/HCL math |
| `densityPricing.test.ts` | 4 | density-spread price adjustment |
| `geofencing.test.ts` | 6 | Haversine distance, 200 m boundary |
| `laborCost.test.ts` | 6 | labour cost + marine-insurance deduction |
| `profiles.test.ts` | 6 | `profileCanAccess` exact-match RBAC |
| `nvidiaOcr.test.ts` | 8 | OCR parsers (`parsePressureToKg`, `parseBatchTimestamp`) |
| `costEngine.test.ts` | 6 | landed-cost engine + margin floor |

> A real bug was captured by tests: `computeLaborCost` derives `computedCost` and `targetTotalCost` from the **same** formula, so variance is structurally always 0 and the >5% flag can never fire. Documented with a test pending the real payroll-derived cost.

### A6. Type & performance hygiene

**Files:** `src/App.tsx`, `vite.config.ts`

- **Route-level code-splitting:** every route is `React.lazy` + `Suspense`.
- **Vendor chunking** (`vite.config.ts` `manualChunks`): React, Supabase, React-Query split into separate cacheable chunks.
- **Result:** app shell **1.42 MB → 95 KB raw / ~26 KB gzip** (~60% smaller initial load); the >500 KB warning is gone; `xlsx` and `leaflet` load only on the pages that use them.

---

## TRACK B — Dashboard Intelligence & Anomaly Operations

### §3 Dashboard enhancements (6 new pages)

All are RBAC-gated, lazy-loaded, listed under a new "Monitoring" sidebar section, and built on the Track A patterns (typed reads, toast, loading/error states).

| § | Page | Route | What it does |
|---|------|-------|--------------|
| 3.1 | **Anomaly Operations Center** | `/dashboard/anomaly-center` | Aggregates every flag from the analytics service into one severity-ranked, filterable feed (plant/source/status). Click-through to source; acknowledge / resolve / dismiss **with a captured reason** (the §5.4 feedback signal). Built on `useTable` (realtime). |
| 3.2 | **Cost & Margin Intelligence** | `/dashboard/cost-intelligence` | True landed cost per closed batch and per MT (material + labour + energy + overhead) with a live, tunable rate panel; avg cost/MT and total landed-cost KPIs. |
| 3.3 | **Multi-Plant Benchmarking** | `/dashboard/benchmarking` | Plant league table (batches, output MT, avg cycle time, off-spec rate, cost/MT), ranked cheapest-first, drill-through to batches. |
| 3.4 | **Live Predictive QC Board** | `/dashboard/predictive-qc` | Each running batch's live gravity curve vs the per-grade golden trajectory (recharts), projected final gravity, green/amber/red status. Front-end for detector 4.1. |
| 3.5 | **Owner Intelligence** | `/dashboard/owner` | Auto daily digest from live KPIs; ask-your-data (deterministic answers over KPIs, LLM-ready); what-if scenarios that shock a cost driver against the live cost engine and show the order-book hit. |
| 3.6 | **Working Capital & Cash** | `/dashboard/working-capital` | Projected cash position (receivables weighted by ageing, net of payables), net working capital, cash-conversion cycle, DSO/DPO, receivables-ageing view. |

**Cost engine** (`src/lib/algorithms/costEngine.ts`): the shared, pure, tested cost number that §3.2, §3.3, §3.5 what-if, and the margin detector all consume. `computeBatchCost()` + `computeMargin()` with a tunable `CostConfig` and a cost-plus-minimum floor.

### §4 + §5 Anomaly engine — the Python analytics service (`analytics/`)

A new FastAPI microservice — the only structural addition in Phase 2. It runs the seven anomaly applications, scores them with the shared engine, and writes flags into Supabase (`anomaly_flags`), where the Anomaly Operations Center picks them up live.

| File | Role |
|------|------|
| `app/engine.py` | §5.1 detection methods (z-score, robust MAD, EWMA drift, trajectory projection, reconciliation) + §5.2 severity scoring (Critical/Warning/Watch) + the `Flag` dataclass |
| `app/detectors.py` | the 7 apps: predictive QC (4.1), material reconciliation (4.2), predictive maintenance (4.3), throughput (4.4), demand (4.5), margin (4.6), receivables (4.7) |
| `app/synthetic.py` | deterministic synthetic data so every detector runs its full logic before months of history exist |
| `app/db.py` | Supabase REST read + flag write (graceful no-op when unconfigured) |
| `app/alerting.py` | §5.3 Critical-flag routing to WhatsApp / email |
| `app/main.py` | FastAPI app (`/health`, `/scan/all`, `/scan/{d}`, `/preview/{d}`) + APScheduler timer |
| `app/config.py` | env-driven settings incl. the §8 decision values (margin floor, tolerance bands, σ limits) |
| `requirements.txt`, `.env.example`, `README.md` | deps, config template, run docs |

- **§5.4 feedback loop:** operators resolve/dismiss flags with a reason in the Center; that judgement (`resolution_reason`) is the training signal to tune thresholds.
- **Verified:** all 7 detectors produce realistic, severity-scored flags (25 in demo mode).
- **Demo → live:** set `SUPABASE_SERVICE_KEY` to persist flags; set `ANALYTICS_DEMO_MODE=false` once real history exists. Same detector logic runs on real data.

---

## 3. Database migrations (`supabase/migrations/`)

Seven idempotent migrations (all run against the live Supabase project). Run order is numeric.

| File | Tables | Purpose |
|------|--------|---------|
| `0001_maintenance.sql` | `maintenance_tickets`, `maintenance_schedules`, `maintenance_store_requests` | Formalise the maintenance workflow tables (were used untyped) |
| `0002_cpm_stock.sql` | `tanks`, `cpm_drum_stock` | Replace the TANKS / CP_MATRIX mock arrays (seeded) |
| `0003_alerts.sql` | `alerts` | Replace the Overview ALERTS mock feed (seeded) |
| `0004_operator_sessions.sql` | `operator_sessions`, `batch_edit_logs` | BatchLogger draft cache + audit trail |
| `0005_unit_log_entries.sql` | `unit_log_entries` | DailyLogPage OCR daily monitoring log |
| `0006_users_blacklist.sql` | `user_accounts`, `blacklist` | User directory + restricted-entity registry |
| `0007_anomaly_flags.sql` | `anomaly_flags` | The feed every anomaly app writes into (seeded) |

All enable Supabase realtime; seeded tables are guarded by `NOT EXISTS` so re-running is safe.

---

## 4. How to run

**Frontend**
```bash
npm install
npm run dev:full     # Vite (:5173) + the existing Busy API server (:3001)
npm run build        # tsc -b && vite build — production build
npm test             # 43 unit tests
```

**Analytics service**
```bash
cd analytics
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # set SUPABASE_SERVICE_KEY to persist flags
uvicorn app.main:app --reload --port 8000
# POST /scan/all writes flags into anomaly_flags; the Anomaly Center shows them.
```

---

## 5. What is NOT done (operational / external, by design)

These need credentials, hosting, or real data — not code:

- **WhatsApp Business API + Busy API credentials** — `analytics/.env` has the slots; alerting no-ops cleanly until set.
- **Hosting** the Python analytics service + scheduler.
- **Flip demo → live:** set `SUPABASE_SERVICE_KEY` and `ANALYTICS_DEMO_MODE=false` once months of real batch-gravity / maintenance / sales history exist.
- **Decision values** (tolerance bands per grade, margin floor, credit limits) — currently env-configurable defaults in `analytics/.env`; confirm with Suntek.
- **Secret rotation (A7)** — the committed `.env*` keys (Supabase anon, NVIDIA, Cloudinary) should be rotated, and the NVIDIA/Cloudinary calls moved server-side, before internet-facing deployment. The Busy API URL is already env-driven (no hardcoded ngrok).
- **`supabase gen types`** — run against the live DB to enable the fully-strict schema and remove the last confined casts in `db.ts`.
- **Playwright e2e** — the Vitest unit suite covers the logic; a browser-driven smoke test is the natural next addition.

---

## 6. New routes added (quick reference)

```
/dashboard/anomaly-center      Anomaly Operations Center   (§3.1)
/dashboard/cost-intelligence   Cost & Margin Intelligence  (§3.2)
/dashboard/benchmarking        Multi-Plant Benchmarking    (§3.3)
/dashboard/predictive-qc       Live Predictive QC Board    (§3.4)
/dashboard/owner               Owner Intelligence          (§3.5)  [admin]
/dashboard/working-capital     Working Capital & Cash      (§3.6)
```
RBAC grants added for admin (all), unit_head, and the two accountant profiles in `src/lib/profiles.ts`; owner layer is admin-only.
