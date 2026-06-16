"""Synthetic data generation for demo mode.

The predictive apps need history the platform is only starting to capture. Until
real data accumulates, these generators produce realistic, internally-consistent
data so every detector exercises its full logic and the Anomaly Center is alive.
Deterministic via a fixed seed so demo flags are stable across scans.
"""
from __future__ import annotations

import numpy as np

PLANTS = ["Rehla", "Ganjam", "SHD", "Bawana"]
GRADES = [1300, 1400, 1450, 1500]
_rng = np.random.default_rng(42)


def golden_curve(grade: int, points: int = 12) -> list[float]:
    """The proven healthy gravity trajectory for a grade (rises to target)."""
    start = 1000.0
    target = float(grade)
    xs = np.linspace(0, 1, points)
    # Smooth saturating rise toward target.
    return [round(start + (target - start) * (1 - np.exp(-3 * x)), 1) for x in xs]


def running_batches(n: int = 6) -> list[dict]:
    """Live batches with a partial gravity curve — some healthy, some drifting."""
    out = []
    for i in range(n):
        grade = GRADES[i % len(GRADES)]
        plant = PLANTS[i % len(PLANTS)]
        golden = golden_curve(grade)
        seen = _rng.integers(3, 8)  # how many readings logged so far
        drift = _rng.choice([0.0, 0.0, 0.04, -0.05])  # most healthy, some off
        partial = [round(g * (1 + drift) + _rng.normal(0, 4), 1) for g in golden[:seen]]
        out.append({
            "batch_no": f"S{1300 + i}",
            "plant": plant,
            "grade": grade,
            "golden": golden,
            "partial": partial,
            "total_points": len(golden),
        })
    return out


def consumption_history(metric: str, n: int = 30) -> list[float]:
    """A rolling baseline series for a plant metric, with the latest possibly out."""
    base = {"consumption": 4.2, "output": 9.8, "cycle_time": 5.4}.get(metric, 5.0)
    series = list(base + _rng.normal(0, base * 0.04, n))
    return [round(x, 2) for x in series]


def material_issue(plant: str) -> dict:
    """Yield-implied vs actually-issued NP for a shift (some over-issue = loss)."""
    output_mt = round(9 + _rng.normal(0, 1), 2)
    implied = round(output_mt * 0.46, 2)  # yield-implied NP from oil ratio
    over = _rng.choice([0.0, 0.0, 0.06, 0.12])  # most fine, some loss
    issued = round(implied * (1 + over), 2)
    return {"plant": plant, "output_mt": output_mt, "implied_np": implied, "issued_np": issued}


def dispatches(n: int = 8) -> list[dict]:
    """Dispatches with realised price vs landed cost — some below margin floor."""
    out = []
    for i in range(n):
        grade = GRADES[i % len(GRADES)]
        landed = round(58000 + grade * 2 + _rng.normal(0, 800), 0)
        margin_factor = _rng.choice([1.18, 1.15, 1.05, 0.98])  # last two thin/under
        price = round(landed * margin_factor, 0)
        out.append({
            "dispatch_id": f"D{4400 + i}",
            "customer": ["Omgee", "Jain Poly", "Samarth", "KG Chem"][i % 4],
            "grade": grade,
            "landed_cost": landed,
            "realised_price": price,
            "qty_mt": round(8 + _rng.normal(0, 2), 1),
        })
    return out


def receivables(n: int = 6) -> list[dict]:
    """Customer exposure vs credit limit + ageing days."""
    out = []
    for i in range(n):
        limit = _rng.choice([500000, 800000, 1000000])
        outstanding = round(limit * _rng.choice([0.4, 0.7, 1.05, 1.2]), 0)
        days = int(_rng.choice([5, 12, 35, 48, 70]))
        out.append({
            "customer": ["Omgee", "Jain Poly", "Samarth", "KG Chem", "Madan", "SPPL"][i % 6],
            "limit": limit,
            "outstanding": outstanding,
            "overdue_days": days,
        })
    return out


def equipment(n: int = 6) -> list[dict]:
    """Assets with runtime hours vs mean-time-between-failure."""
    out = []
    classes = [("Reactor", 1250), ("Cooling pump", 1250), ("Compressor", 2000), ("Crusher", 1500)]
    for i in range(n):
        name, mtbf = classes[i % len(classes)]
        runtime = int(mtbf * _rng.choice([0.5, 0.75, 0.95, 1.02]))
        out.append({
            "asset": f"{name} {i + 1}",
            "plant": PLANTS[i % len(PLANTS)],
            "runtime_hours": runtime,
            "mtbf": mtbf,
        })
    return out


def demand_forecast() -> list[dict]:
    """Forecast CP demand by grade vs raw-material cover (some short)."""
    out = []
    for grade in GRADES:
        forecast_mt = round(40 + _rng.normal(0, 8), 1)
        # NP/Cl2 cover translated via ratios; some grades short.
        cover_mt = round(forecast_mt * _rng.choice([1.3, 1.1, 0.85, 0.7]), 1)
        out.append({"grade": grade, "forecast_mt": forecast_mt, "np_cover_mt": cover_mt})
    return out
