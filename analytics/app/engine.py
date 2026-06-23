"""Shared anomaly engine: detection methods (§5.1) and severity scoring (§5.2).

All seven applications share these primitives. Keeping them in one place is what
keeps the system trustworthy — consistent maths, consistent scoring.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np


# ── §5.1 Detection methods ────────────────────────────────────────────────────

def zscore(value: float, history: list[float]) -> float:
    """Standard z-score of value against a history (statistical baseline)."""
    if len(history) < 3:
        return 0.0
    arr = np.asarray(history, dtype=float)
    mu, sd = float(arr.mean()), float(arr.std())
    if sd == 0:
        return 0.0
    return (value - mu) / sd


def robust_z(value: float, history: list[float]) -> float:
    """Outlier-tolerant z-score using median + MAD (robust statistical baseline)."""
    if len(history) < 3:
        return 0.0
    arr = np.asarray(history, dtype=float)
    med = float(np.median(arr))
    mad = float(np.median(np.abs(arr - med)))
    if mad == 0:
        return 0.0
    return 0.6745 * (value - med) / mad


def ewma_drift(series: list[float], span: int = 5) -> float:
    """Latest deviation of an EWMA from the series mean — catches slow drift."""
    if len(series) < 3:
        return 0.0
    arr = np.asarray(series, dtype=float)
    alpha = 2.0 / (span + 1)
    ewma = arr[0]
    for x in arr[1:]:
        ewma = alpha * x + (1 - alpha) * ewma
    sd = float(arr.std())
    if sd == 0:
        return 0.0
    return (ewma - float(arr.mean())) / sd


def project_endpoint(partial: list[float], total_points: int) -> float:
    """Trajectory: linear-fit a partial curve and project the final value
    (used by Predictive QC to estimate final gravity mid-batch)."""
    if len(partial) < 2:
        return partial[-1] if partial else 0.0
    x = np.arange(len(partial), dtype=float)
    y = np.asarray(partial, dtype=float)
    a, b = np.polyfit(x, y, 1)
    return float(a * (total_points - 1) + b)


def reconciliation_gap(expected: float, actual: float) -> float:
    """Signed % gap of actual vs an expected value computed from physics/ratios."""
    if expected == 0:
        return 0.0
    return (actual - expected) / expected * 100.0


# ── §5.2 Severity scoring ─────────────────────────────────────────────────────

def severity_from(deviation_sigma: float, value_at_stake: float | None, confidence: float) -> str:
    """Map a finding to Critical / Warning / Watch.

    Combines how far outside tolerance it sits (deviation in sigma / multiples of
    the threshold), the value at stake, and confidence. A batch about to be
    ruined outranks a minor consumption wobble.
    """
    dev = abs(deviation_sigma)
    stake = value_at_stake or 0.0
    # Base on deviation magnitude.
    if dev >= 4 or stake >= 150_000:
        base = "critical"
    elif dev >= 2.5 or stake >= 50_000:
        base = "warning"
    else:
        base = "watch"
    # Low confidence demotes one level.
    if confidence < 0.5 and base == "critical":
        base = "warning"
    elif confidence < 0.4 and base == "warning":
        base = "watch"
    return base


@dataclass
class Flag:
    """A single anomaly flag, shaped for the anomaly_flags table."""
    source_app: str
    title: str
    severity: str = "watch"
    plant: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    entity_label: str | None = None
    evidence: str | None = None
    recommended_action: str | None = None
    value_at_stake: float | None = None
    value_unit: str | None = None
    confidence: float | None = None
    route: str | None = None

    def to_row(self) -> dict[str, Any]:
        return {
            "source_app": self.source_app,
            "title": self.title,
            "severity": self.severity,
            "plant": self.plant,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "entity_label": self.entity_label,
            "evidence": self.evidence,
            "recommended_action": self.recommended_action,
            "value_at_stake": self.value_at_stake,
            "value_unit": self.value_unit,
            "confidence": self.confidence,
            "route": self.route,
            "status": "open",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }


@dataclass
class ScanResult:
    source_app: str
    flags: list[Flag] = field(default_factory=list)
