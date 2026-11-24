"""Telegram Mini App (Web App) endpoints for driver PTI.

Authenticated by the Telegram WebApp `initData` signature (HMAC with the bot
token), not a JWT — the mini app runs inside Telegram, outside our login.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.config import get_settings
from app.db import get_db
from app.models import InspectionDefect, PreTripInspection, TelegramLink, Vehicle, utcnow
from app.services import telegram as tg

router = APIRouter(prefix="/api/tg", tags=["telegram-webapp"])

MAX_PHOTOS = 60
MAX_PHOTO_BYTES = 8_000_000


def _image_ext(head: bytes) -> str | None:
    """Return a safe extension if `head` is a real raster image, else None.
    SVG/HTML and anything script-bearing have no binary signature and are
    rejected, so a stored file can never be served as active content."""
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def _driver(init_data: str, db: Session) -> TelegramLink:
    u = tg.validate_init_data(init_data)
    if u is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Telegram session")
    link = db.execute(
        select(TelegramLink).where(TelegramLink.chat_id == u["id"])
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_linked")
    return link


@router.post("/context")
def context(init_data: str = Form(...), db: Session = Depends(get_db)):
    link = _driver(init_data, db)
    trucks = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == link.owner_user_id)
        .order_by(Vehicle.unit_number)
    ).scalars().all()
    return {
        "driver_name": link.driver_name,
        "checklist": [{"key": k, "label": label} for k, label in tg.PTI_ITEMS],
        "trucks": [{"id": str(v.id), "unit_number": v.unit_number} for v in trucks],
    }


@router.post("/submit")
async def submit(init_data: str = Form(...), payload: str = Form(...),
                 photos: list[UploadFile] = File(default=[]),
                 db: Session = Depends(get_db)):
    link = _driver(init_data, db)
    try:
        data = json.loads(payload)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad payload")

    vehicle = None
    vid = data.get("vehicle_id")
    if vid:
        try:
            vehicle = db.get(Vehicle, uuid.UUID(str(vid)))
        except ValueError:
            vehicle = None
        if vehicle is None or vehicle.owner_user_id != link.owner_user_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Truck not found")

    norm = []
    for it in (data.get("items") or []):
        status_ = it.get("status")
        status_ = status_ if status_ in ("ok", "defect", "skipped") else "ok"
        norm.append({
            "key": str(it.get("key"))[:32], "label": str(it.get("label"))[:64],
            "status": status_, "note": (str(it.get("note"))[:500] if it.get("note") else ""),
            "photos": [],
        })
    defects = [i for i in norm if i["status"] == "defect"]
    result = "fail" if (defects or data.get("overall") == "found_issue") else "pass"

    pti = PreTripInspection(
        owner_user_id=link.owner_user_id, vehicle_id=vehicle.id if vehicle else None,
        unit_number=vehicle.unit_number if vehicle else None, driver_name=link.driver_name,
        chat_id=link.chat_id,
        inspection_type="post" if data.get("inspection_type") == "post" else "pre",
        result=result, defect_count=len(defects), items=norm, performed_at=utcnow(),
    )
    db.add(pti)
    db.flush()  # need pti.id for the photo directory

    by_key = {i["key"]: i for i in norm}
    media = Path(get_settings().media_dir) / "pti" / str(pti.id)
    saved = 0
    # Every part counts toward the cap, so a flood of junk parts is bounded.
    for part in photos[:MAX_PHOTOS]:
        # Bounded read: never pull more than the limit into memory.
        content = await part.read(MAX_PHOTO_BYTES + 1)
        if not content or len(content) > MAX_PHOTO_BYTES:
            continue
        ext = _image_ext(content[:16])
        if ext is None:
            continue  # not a real image — reject (no HTML/SVG/script on disk)
        # Server-generated name + validated extension; the client filename is
        # only used to route the photo to its checklist item.
        item_key = (part.filename or "").split("__", 1)[0]
        name = f"{uuid.uuid4().hex}.{ext}"
        media.mkdir(parents=True, exist_ok=True)
        (media / name).write_bytes(content)
        rel = f"/media/pti/{pti.id}/{name}"
        if item_key in by_key:
            by_key[item_key]["photos"].append(rel)
        saved += 1
    flag_modified(pti, "items")  # nested photo lists changed in place

    if vehicle is not None:
        for d in defects:
            db.add(InspectionDefect(
                vehicle_id=vehicle.id, source="telegram_pti",
                defect_type=d["label"][:64], comment=d.get("note") or None, severity="major"))
    db.commit()
    return {"ok": True, "result": result, "defects": len(defects), "photos": saved}
