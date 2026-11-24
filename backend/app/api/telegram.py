"""Carrier-facing endpoints for the driver PTI Telegram bot: generate a driver
link code, see connected drivers, and list submitted inspections."""
from __future__ import annotations

import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import (
    DriverLinkCode,
    FleetDriver,
    PreTripInspection,
    TelegramLink,
    User,
    UserRole,
    utcnow,
)
from app.schemas import LinkCodeIn, LinkCodeOut, PtiOut, TelegramDriverOut, TelegramStatusOut
from app.security import require_roles

router = APIRouter(prefix="/api/fleet", tags=["telegram"])
fleet_user = require_roles(UserRole.DRIVER, UserRole.FLEET_MANAGER, UserRole.ADMIN)

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous chars
CODE_TTL_DAYS = 30


def _gen_code(db: Session) -> str:
    for _ in range(10):
        code = "".join(secrets.choice(_ALPHABET) for _ in range(8))
        if db.execute(select(DriverLinkCode.id).where(DriverLinkCode.code == code)).first() is None:
            return code
    raise RuntimeError("Could not allocate a link code")


def _deep_link(code: str) -> tuple[str | None, str | None]:
    username = (get_settings().telegram_bot_username or "").lstrip("@") or None
    deep = f"https://t.me/{username}?start={code}" if username else None
    return username, deep


@router.post("/telegram/link-code", response_model=LinkCodeOut)
def create_link_code(body: LinkCodeIn, owner: User = Depends(fleet_user),
                     db: Session = Depends(get_db)):
    name = (body.driver_name or "").strip() or None
    driver_id = None
    if body.driver_id is not None:
        driver = db.get(FleetDriver, body.driver_id)
        if driver is None or driver.owner_user_id != owner.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Driver not found")
        driver_id = driver.id
        name = name or driver.name
    code = _gen_code(db)
    row = DriverLinkCode(owner_user_id=owner.id, code=code,
                         driver_id=driver_id, driver_name=name,
                         expires_at=utcnow() + timedelta(days=CODE_TTL_DAYS))
    db.add(row)
    db.commit()
    username, deep = _deep_link(code)
    return LinkCodeOut(code=code, bot_username=username, deep_link=deep, expires_at=row.expires_at)


@router.get("/telegram/status", response_model=TelegramStatusOut)
def telegram_status(owner: User = Depends(fleet_user), db: Session = Depends(get_db)):
    settings = get_settings()
    links = db.execute(
        select(TelegramLink).where(TelegramLink.owner_user_id == owner.id)
        .order_by(TelegramLink.linked_at.desc())
    ).scalars().all()
    username = (settings.telegram_bot_username or "").lstrip("@") or None
    return TelegramStatusOut(
        configured=bool(settings.telegram_bot_token),
        bot_username=username,
        linked_count=len(links),
        drivers=[TelegramDriverOut(id=l.id, driver_name=l.driver_name,
                                   telegram_username=l.telegram_username,
                                   linked_at=l.linked_at) for l in links],
    )


@router.delete("/telegram/links/{link_id}", status_code=204)
def unlink_driver(link_id: uuid.UUID, owner: User = Depends(fleet_user),
                  db: Session = Depends(get_db)):
    """Disconnect a driver's Telegram chat from this carrier, and revoke any
    link code bound to that chat so it can't silently re-link afterwards."""
    row = db.get(TelegramLink, link_id)
    if row is not None and row.owner_user_id == owner.id:
        chat_id = row.chat_id
        db.delete(row)
        codes = db.execute(
            select(DriverLinkCode).where(
                DriverLinkCode.owner_user_id == owner.id,
                DriverLinkCode.used_by_chat_id == chat_id,
            )
        ).scalars().all()
        for c in codes:
            db.delete(c)  # consumed code is gone -> rejected on any future /start
        db.commit()


@router.get("/pti", response_model=list[PtiOut])
def list_pti(owner: User = Depends(fleet_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(PreTripInspection).where(PreTripInspection.owner_user_id == owner.id)
        .order_by(PreTripInspection.performed_at.desc()).limit(200)
    ).scalars().all()
    return [PtiOut.model_validate(r) for r in rows]
