"""Notification dispatch.

In-app notifications are always written. Email/SMS/push channels plug in here
when their providers are configured; none are in this environment, so the
channel list is intentionally just the database write.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models import Notification


def notify(
    db: Session,
    user_id: uuid.UUID,
    type_: str,
    title: str,
    body: str | None = None,
    data: dict | None = None,
) -> Notification:
    n = Notification(user_id=user_id, type=type_, title=title, body=body, data=data)
    db.add(n)
    return n
