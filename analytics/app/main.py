"""Suntek Analytics Service — FastAPI app that runs the anomaly applications and
writes flags into Supabase (anomaly_flags), where the Anomaly Operations Center
picks them up in real time.

Run:  uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .alerting import route_critical
from .config import settings
from .db import clear_open_flags_for, write_flags
from .detectors import ALL_DETECTORS, run_all

scheduler = BackgroundScheduler()


def scan_and_persist(only: str | None = None) -> dict:
    """Run detector(s), replace their open flags, persist, and alert on Critical."""
    results = [ALL_DETECTORS[only]()] if only else run_all()
    written = 0
    alerted = 0
    per_app: dict[str, int] = {}
    for res in results:
        clear_open_flags_for(res.source_app)
        rows = [f.to_row() for f in res.flags]
        written += write_flags(rows)
        alerted += route_critical(res.flags)
        per_app[res.source_app] = len(res.flags)
    return {
        "ran": list(per_app.keys()),
        "flags_found": sum(per_app.values()),
        "flags_written": written,
        "critical_alerted": alerted,
        "per_app": per_app,
        "supabase_connected": settings.supabase_ready,
        "demo_mode": settings.analytics_demo_mode,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Run once on boot so the Center is populated, then on the timer.
    scan_and_persist()
    scheduler.add_job(scan_and_persist, "interval", seconds=settings.scan_interval_seconds, id="scan")
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Suntek Analytics Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "supabase_connected": settings.supabase_ready,
        "demo_mode": settings.analytics_demo_mode,
        "detectors": list(ALL_DETECTORS.keys()),
        "scan_interval_seconds": settings.scan_interval_seconds,
    }


@app.get("/detectors")
def list_detectors() -> dict:
    return {"detectors": list(ALL_DETECTORS.keys())}


@app.post("/scan/all")
def scan_all() -> dict:
    return scan_and_persist()


@app.post("/scan/{detector}")
def scan_one(detector: str) -> dict:
    if detector not in ALL_DETECTORS:
        raise HTTPException(404, f"unknown detector '{detector}'")
    return scan_and_persist(detector)


@app.get("/preview/{detector}")
def preview(detector: str) -> dict:
    """Run a detector and return its flags WITHOUT persisting — for inspection."""
    if detector not in ALL_DETECTORS:
        raise HTTPException(404, f"unknown detector '{detector}'")
    res = ALL_DETECTORS[detector]()
    return {"source_app": res.source_app, "flags": [f.to_row() for f in res.flags]}
