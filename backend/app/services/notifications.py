"""Notification dispatch.

In-app notifications are always written. When RESEND_API_KEY is configured and
the caller marks the event as email-worthy, a branded email goes out too —
best-effort, never failing the triggering flow.
"""
from __future__ import annotations

import html
import uuid

from sqlalchemy.orm import Session

from app.models import Notification, User
from app.services import email as email_svc


def notify(
    db: Session,
    user_id: uuid.UUID,
    type_: str,
    title: str,
    body: str | None = None,
    data: dict | None = None,
    *,
    email: bool = False,
    email_cta: tuple[str, str] | None = None,  # (label, frontend path)
) -> Notification:
    n = Notification(user_id=user_id, type=type_, title=title, body=body, data=data)
    db.add(n)
    if email and email_svc.is_configured():
        user = db.get(User, user_id)
        if user and user.email:
            cta_label, cta_path = email_cta or ("Open YourFleet", "/dashboard")
            email_svc.send(
                user.email,
                title,
                email_svc.render(
                    html.escape(title),
                    f"<p>{html.escape(body)}</p>" if body else "",
                    cta_label,
                    cta_path,
                ),
            )
    return n
