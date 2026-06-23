# Suntek Analytics Service

Python (FastAPI) microservice that runs the Phase 2 anomaly applications (doc §4),
scores them with the shared engine (§5), and writes flags into Supabase
(`anomaly_flags`), where the **Anomaly Operations Center** picks them up live.

This is the only structural addition in Phase 2 — the React app and Supabase stay
the source of truth. Heavy maths (forecasting, baselining, reconciliation,
trajectory projection) belongs here, not in the front-end.

## Run

```bash
cd analytics
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill SUPABASE_SERVICE_KEY to persist flags
uvicorn app.main:app --reload --port 8000
```

On boot it runs every detector once (so the Center is populated) and then on a
timer (`SCAN_INTERVAL_SECONDS`).

## Modes

- **Demo mode** (`ANALYTICS_DEMO_MODE=true`, default): detectors run on synthetic,
  internally-consistent data (`app/synthetic.py`) so every detector exercises its
  full logic before months of history exist.
- **Connected**: set the Supabase service key; `app/db.py` reads source tables and
  writes flags. (Flag-writing works as soon as the key is set, even in demo mode —
  that's how the Center gets populated for a demo.)

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | status, connection, detector list |
| GET  | `/detectors` | list detector keys |
| POST | `/scan/all` | run all detectors, persist flags, alert on Critical |
| POST | `/scan/{detector}` | run one detector |
| GET  | `/preview/{detector}` | run one detector, return flags WITHOUT persisting |

## The seven applications (`app/detectors.py`)

| Key | Doc | Method (§5.1) |
|---|---|---|
| `predictive_qc` | 4.1 | trajectory — project final gravity off the golden curve |
| `material_recon` | 4.2 | reconciliation — yield-implied vs issued NP |
| `predictive_maint` | 4.3 | reconciliation — runtime hours vs MTBF |
| `throughput` | 4.4 | statistical baseline — robust z-score per plant/metric |
| `demand` | 4.5 | forecast — demand-by-grade vs raw-material cover |
| `margin` | 4.6 | rule — realised price vs landed cost + floor |
| `receivables` | 4.7 | rule — exposure vs credit limit + ageing |

Severity (Critical/Warning/Watch) is scored in `app/engine.py:severity_from`
from deviation magnitude, value at stake, and confidence. Critical flags route to
WhatsApp/email via `app/alerting.py` when those channels are configured.

## Feedback loop (§5.4)

Operators resolve/dismiss flags **with a reason** in the Anomaly Operations Center.
That judgement is the training signal: confirmed anomalies sharpen the detectors,
dismissed false positives raise thresholds. (Wire the `resolution_reason` column
back into per-detector threshold tuning as history accumulates.)
