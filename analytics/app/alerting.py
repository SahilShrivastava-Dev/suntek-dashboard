"""§5.3 Routing & alerting. Critical flags also push to WhatsApp / email with
escalation. No-ops cleanly when channels aren't configured."""
from __future__ import annotations

import httpx

from .config import settings
from .engine import Flag


def _whatsapp(text: str) -> None:
    if not (settings.whatsapp_api_url and settings.whatsapp_api_token):
        return
    try:
        httpx.post(
            settings.whatsapp_api_url,
            headers={"Authorization": f"Bearer {settings.whatsapp_api_token}"},
            json={"type": "text", "text": {"body": text}},
            timeout=15.0,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[alert] whatsapp failed: {exc}")


def _email(text: str) -> None:
    if not settings.alert_email_webhook:
        return
    try:
        httpx.post(settings.alert_email_webhook, json={"text": text}, timeout=15.0)
    except Exception as exc:  # noqa: BLE001
        print(f"[alert] email failed: {exc}")


def route_critical(flags: list[Flag]) -> int:
    """Push Critical flags to the configured channels. Returns count sent."""
    critical = [f for f in flags if f.severity == "critical"]
    for f in critical:
        body = f"🔴 CRITICAL · {f.title}\n{f.evidence or ''}\nAction: {f.recommended_action or ''}"
        _whatsapp(body)
        _email(body)
    return len(critical)
