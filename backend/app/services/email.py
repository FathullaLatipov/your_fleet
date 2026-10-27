"""Transactional email via Resend (https://resend.com).

Best-effort by design: a failed or unconfigured email never breaks the flow
that triggered it — in-app notifications remain the source of truth.
Without RESEND_API_KEY nothing is sent.
"""
from __future__ import annotations

import logging

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

API = "https://api.resend.com/emails"


def is_configured() -> bool:
    return bool(get_settings().resend_api_key)


def _deliver(to: str, subject: str, html: str) -> bool:
    settings = get_settings()
    resp = httpx.post(
        API,
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={"from": settings.email_from, "to": [to], "subject": subject, "html": html},
        timeout=10,
    )
    resp.raise_for_status()
    return True


def send(to: str, subject: str, html: str) -> bool:
    if not is_configured() or not to:
        return False
    try:
        return _deliver(to, subject, html)
    except Exception as e:  # noqa: BLE001 — email must never break the caller
        log.warning("email to %s failed: %s", to, e)
        return False


def render(title: str, body: str, cta_label: str | None = None, cta_path: str | None = None) -> str:
    """Minimal branded layout; body is pre-escaped HTML."""
    base = get_settings().frontend_url.rstrip("/")
    cta = ""
    if cta_label and cta_path:
        cta = (
            f'<p style="margin:24px 0"><a href="{base}{cta_path}" '
            'style="background:#f97316;color:#1b1e22;text-decoration:none;'
            'font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">'
            f"{cta_label}</a></p>"
        )
    return f"""<!doctype html>
<html><body style="margin:0;background:#f1f3f2;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#16181b;border-radius:12px 12px 0 0;padding:18px 24px">
    <span style="color:#fff;font-size:20px;font-weight:700">YourFleet</span>
  </div>
  <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:24px">
    <h1 style="margin:0 0 12px;font-size:20px;color:#1b1e22">{title}</h1>
    <div style="color:#4c545e;font-size:15px;line-height:1.5">{body}</div>
    {cta}
    <p style="margin:20px 0 0;color:#878f99;font-size:12px">
      You're receiving this because of activity on your YourFleet account.
    </p>
  </div>
</div>
</body></html>"""
