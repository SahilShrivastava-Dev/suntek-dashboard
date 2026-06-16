"""Thin Supabase REST client — reads source tables, writes anomaly flags.

Uses the service-role key so it can read everything and write flags. When
Supabase isn't configured, read_rows() returns [] and the detectors fall back to
synthetic data (demo mode).
"""
from __future__ import annotations

from typing import Any

import httpx

from .config import settings


def _headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Content-Type": "application/json",
    }


def read_rows(table: str, select: str = "*", params: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Read rows from a table via PostgREST. Returns [] if Supabase isn't ready."""
    if not settings.supabase_ready:
        return []
    url = f"{settings.supabase_url}/rest/v1/{table}"
    q = {"select": select}
    if params:
        q.update(params)
    try:
        r = httpx.get(url, headers=_headers(), params=q, timeout=20.0)
        r.raise_for_status()
        return r.json()
    except Exception as exc:  # noqa: BLE001 — best-effort read
        print(f"[db] read {table} failed: {exc}")
        return []


def write_flags(flags: list[dict[str, Any]]) -> int:
    """Insert flags into anomaly_flags. Returns the number written (0 if not ready)."""
    if not settings.supabase_ready or not flags:
        return 0
    url = f"{settings.supabase_url}/rest/v1/anomaly_flags"
    try:
        r = httpx.post(url, headers={**_headers(), "Prefer": "return=minimal"}, json=flags, timeout=30.0)
        r.raise_for_status()
        return len(flags)
    except Exception as exc:  # noqa: BLE001
        print(f"[db] write_flags failed: {exc}")
        return 0


def clear_open_flags_for(source_app: str) -> None:
    """Resolve previously-open flags from a source before a fresh scan, so the
    feed doesn't accumulate duplicates. Respects operator resolutions (only
    touches status=open, not acknowledged/resolved/dismissed)."""
    if not settings.supabase_ready:
        return
    url = f"{settings.supabase_url}/rest/v1/anomaly_flags"
    try:
        httpx.patch(
            url,
            headers={**_headers(), "Prefer": "return=minimal"},
            params={"source_app": f"eq.{source_app}", "status": "eq.open"},
            json={"status": "dismissed", "resolution_reason": "superseded by newer scan"},
            timeout=20.0,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[db] clear_open_flags_for {source_app} failed: {exc}")
