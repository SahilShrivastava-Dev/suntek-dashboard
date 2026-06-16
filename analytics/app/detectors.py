"""The seven anomaly applications (doc §4). Each watches a slice of operations,
compares what is happening against what should be happening, and raises flags.

In demo mode they run on synthetic data (app/synthetic.py); the same logic runs
on real Supabase data once history accumulates.
"""
from __future__ import annotations

from .config import settings
from .engine import Flag, ScanResult, reconciliation_gap, robust_z, zscore, severity_from
from . import synthetic as syn


# ── 4.1 Predictive QC — mid-batch yield anomaly ───────────────────────────────

def predictive_qc() -> ScanResult:
    res = ScanResult("predictive_qc")
    tol = settings.offspec_tolerance_pct
    for b in syn.running_batches():
        target = float(b["grade"])
        # Project the final gravity by how far the live readings deviate from the
        # golden curve at the SAME points, carried to the golden endpoint (target).
        # (Linear-extrapolating a saturating curve over-projects wildly.)
        golden_partial = b["golden"][: len(b["partial"])]
        ratios = [p / g for p, g in zip(b["partial"], golden_partial) if g]
        drift_factor = sum(ratios) / len(ratios) if ratios else 1.0
        projected = target * drift_factor
        dev_pct = (drift_factor - 1.0) * 100.0
        if abs(dev_pct) <= tol:
            continue
        # Wasted Cl2/NP/reactor-hours if it runs to a bad close.
        stake = abs(dev_pct) / 100.0 * 200_000
        sev = severity_from(abs(dev_pct) / tol * 2.5, stake, 0.82)
        res.flags.append(Flag(
            source_app="predictive_qc", severity=sev, plant=b["plant"],
            entity_type="batch", entity_id=b["batch_no"], entity_label=f"Batch {b['batch_no']}",
            title=f"Batch {b['batch_no']} projected off-spec",
            evidence=(f"At reading {len(b['partial'])}, projected final gravity "
                      f"{projected:.0f} vs target {b['grade']} ({dev_pct:+.1f}%). "
                      f"Outside ±{tol:.0f}% band, hours before closure."),
            recommended_action=("Alert operator now; steer toward the golden-batch curve "
                                f"({'reduce' if dev_pct > 0 else 'increase'} Cl2 feed) and re-check."),
            value_at_stake=round(stake), value_unit="INR", confidence=0.82,
            route="/dashboard/predictive-qc",
        ))
    return res


# ── 4.2 Material reconciliation & loss detection ──────────────────────────────

def material_reconciliation() -> ScanResult:
    res = ScanResult("material_recon")
    noise = settings.recon_noise_pct
    for plant in syn.PLANTS:
        m = syn.material_issue(plant)
        gap = reconciliation_gap(m["implied_np"], m["issued_np"])
        if abs(gap) <= noise:
            continue
        loss_mt = m["issued_np"] - m["implied_np"]
        stake = loss_mt * 95_000  # ₹/MT NP
        sev = severity_from(abs(gap) / noise * 2.0, stake, 0.78)
        res.flags.append(Flag(
            source_app="material_recon", severity=sev, plant=plant,
            entity_type="batch", entity_label=f"{plant} · shift",
            title=f"Unexplained NP loss at {plant}",
            evidence=(f"Yield-implied NP {m['implied_np']} MT vs issued {m['issued_np']} MT "
                      f"({gap:+.1f}%) — beyond {noise:.0f}% process-loss noise."),
            recommended_action="Reconcile this shift's metering; check for spillage or mis-logged issues.",
            value_at_stake=round(stake), value_unit="INR", confidence=0.78,
            route="/dashboard/stock",
        ))
    return res


# ── 4.3 Usage-based predictive maintenance ────────────────────────────────────

def predictive_maintenance() -> ScanResult:
    res = ScanResult("predictive_maint")
    for e in syn.equipment():
        frac = e["runtime_hours"] / e["mtbf"]
        if frac < 0.9:
            continue
        sev = severity_from((frac - 0.9) * 30, None, 0.7)
        res.flags.append(Flag(
            source_app="predictive_maint", severity=sev, plant=e["plant"],
            entity_type="asset", entity_label=e["asset"],
            title=f"{e['asset']} approaching service interval",
            evidence=f"{e['runtime_hours']} runtime hrs vs {e['mtbf']}-hr MTBF ({frac * 100:.0f}%).",
            recommended_action="Schedule service in the next forecasted low-demand window.",
            value_at_stake=e["mtbf"] - e["runtime_hours"] if frac < 1 else 0,
            value_unit="hours", confidence=0.7, route="/dashboard/purchase/maint",
        ))
    return res


# ── 4.4 Consumption & throughput anomaly detection ────────────────────────────

def throughput() -> ScanResult:
    res = ScanResult("throughput")
    sigma_lim = settings.throughput_sigma
    for plant in syn.PLANTS:
        for metric in ("consumption", "output", "cycle_time"):
            hist = syn.consumption_history(metric)
            latest, base = hist[-1], hist[:-1]
            z = robust_z(latest, base) or zscore(latest, base)
            if abs(z) < sigma_lim:
                continue
            sev = severity_from(z, None, 0.66)
            res.flags.append(Flag(
                source_app="throughput", severity=sev, plant=plant,
                entity_type="batch", entity_label=f"{plant} · {metric}",
                title=f"{plant} {metric.replace('_', ' ')} off baseline",
                evidence=f"Latest {latest} is {z:+.1f}σ from the rolling {plant} baseline.",
                recommended_action="Investigate the deviation against the plant baseline.",
                confidence=0.66, route="/dashboard/benchmarking",
            ))
    return res


# ── 4.5 Demand & procurement forecasting ──────────────────────────────────────

def demand() -> ScanResult:
    res = ScanResult("demand")
    for d in syn.demand_forecast():
        cover_ratio = d["np_cover_mt"] / d["forecast_mt"] if d["forecast_mt"] else 1
        if cover_ratio >= 1.0:
            continue
        short_mt = d["forecast_mt"] - d["np_cover_mt"]
        stake = short_mt * 95_000
        sev = severity_from((1 - cover_ratio) * 6, stake, 0.74)
        res.flags.append(Flag(
            source_app="demand", severity=sev, entity_type="sku",
            entity_label=f"Grade {d['grade']}",
            title=f"Raw-material cover short for grade {d['grade']}",
            evidence=(f"Forecast demand {d['forecast_mt']} MT vs NP cover {d['np_cover_mt']} MT "
                      f"({cover_ratio * 100:.0f}%). Stockout risk before lead time."),
            recommended_action=f"Procure ~{short_mt:.0f} MT NP ahead to meet projected grade-{d['grade']} demand.",
            value_at_stake=round(stake), value_unit="INR", confidence=0.74,
            route="/dashboard/purchase/purchase",
        ))
    return res


# ── 4.6 Margin & pricing anomaly ──────────────────────────────────────────────

def margin_pricing() -> ScanResult:
    res = ScanResult("margin")
    floor_pct = settings.min_margin_pct
    for d in syn.dispatches():
        margin = d["realised_price"] - d["landed_cost"]
        margin_pct = margin / d["realised_price"] * 100 if d["realised_price"] else 0
        floor_price = d["landed_cost"] * (1 + floor_pct / 100)
        if d["realised_price"] >= floor_price:
            continue
        stake = (floor_price - d["realised_price"]) * d["qty_mt"]
        sev = severity_from((floor_pct - margin_pct) / 2, stake, 0.9)
        res.flags.append(Flag(
            source_app="margin", severity=sev, entity_type="dispatch",
            entity_id=d["dispatch_id"], entity_label=f"{d['customer']} · {d['dispatch_id']}",
            title=f"Dispatch {d['dispatch_id']} below margin floor",
            evidence=(f"Realised ₹{d['realised_price']:.0f} vs landed ₹{d['landed_cost']:.0f} "
                      f"(margin {margin_pct:.1f}%, floor {floor_pct:.0f}%)."),
            recommended_action="Review density-spread application and contract terms; re-quote at/above floor.",
            value_at_stake=round(stake), value_unit="INR", confidence=0.9,
            route="/dashboard/cost-intelligence",
        ))
    return res


# ── 4.7 Receivables & credit-limit anomaly ────────────────────────────────────

def receivables() -> ScanResult:
    res = ScanResult("receivables")
    for c in syn.receivables():
        over_limit = c["outstanding"] > c["limit"]
        overdue = c["overdue_days"] > 30
        if not over_limit and not overdue:
            continue
        reasons = []
        if over_limit:
            reasons.append(f"exposure ₹{c['outstanding']:.0f} over limit ₹{c['limit']:.0f}")
        if overdue:
            reasons.append(f"{c['overdue_days']}d overdue")
        sev = "critical" if over_limit and overdue else "warning"
        res.flags.append(Flag(
            source_app="receivables", severity=sev, entity_type="customer",
            entity_label=c["customer"],
            title=f"{c['customer']} credit/ageing breach",
            evidence=" · ".join(reasons).capitalize() + ".",
            recommended_action="Warn or block at next dispatch; auto-nudge the account.",
            value_at_stake=round(c["outstanding"]), value_unit="INR", confidence=0.92,
            route="/dashboard/customers",
        ))
    return res


ALL_DETECTORS = {
    "predictive_qc": predictive_qc,
    "material_recon": material_reconciliation,
    "predictive_maint": predictive_maintenance,
    "throughput": throughput,
    "demand": demand,
    "margin": margin_pricing,
    "receivables": receivables,
}


def run_all() -> list[ScanResult]:
    return [fn() for fn in ALL_DETECTORS.values()]
