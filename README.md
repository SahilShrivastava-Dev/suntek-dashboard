# Suntek Operations Dashboard

Production-grade React ERP dashboard for Suntek Chemical Manufacturing.
Tracks materials through: **PORT → TANKER → FACTORY → GODOWN → CUSTOMER**

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite + React 18 + TypeScript + Tailwind CSS |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| ETL | Python scripts for Excel data import |
| Hosting | Vercel (frontend) + Supabase cloud |

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173 — click **"Enter dashboard directly"** to bypass auth in dev mode.

## Role-Based Access Control

| Level | Role | Tile Colour | Access |
|-------|------|-------------|--------|
| L4 | Owner/Admin (Sagar) | 🔴 Red | Full system + Busy API financial data |
| L3 | Procurement Head (Vijay Ji) | 🟢 Green | Excel-synced data, large purchase approval |
| L2 | Unit Head / Supervisor | 🟡/🟢 | Approval queues, batch review |
| L1 | Frontline Operators | 🟡 Yellow | Own plant entry forms only |

## Data Source Colour Coding

| Colour | Source | Examples |
|--------|--------|---------|
| 🔴 Red | Busy Accounting API | Sales revenue, Purchase paid, Marine Insurance |
| 🟢 Green | Excel/CSV import | CPM Stock Matrix, Sales Contracts, Customer History |
| 🟡 Yellow | Manual daily entry | Night Manager check-ins, Batch logs, Warehouse stock |

## Supabase Setup

1. Create a Supabase project at https://supabase.com
2. Run `supabase_schema.sql` in the Supabase SQL editor
3. Copy `.env.local` and fill in your project URL and anon key
4. Run ETL scripts to import Excel data (see `etl/README.md`)

## Key Business Algorithms (src/lib/algorithms/)

- **geofencing.ts** — Haversine formula for Night Manager location validation
- **batchQC.ts** — Yield variance checker against Oil Ratio Table
- **densityPricing.ts** — Dynamic dispatch price spread calculation
- **laborCost.ts** — Auto-computed labor cost + variance flagging

## Development Phases

- ✅ Phase 0: Project setup
- ✅ Phase 1: Admin dashboard (static mock data from index.html)
- 🔄 Phase 2: Python ETL + connect green tiles to real Supabase data
- 📋 Phase 3: L1 operator apps (Night Manager, Batch Logger, Warehouse)
- 📋 Phase 4: Approval workflows + Supabase Realtime
- 📋 Phase 5: Business logic algorithms
- 📋 Phase 6: Busy API integration (red tiles)
- 📋 Phase 7: Mobile polish + UAT
