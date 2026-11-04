"""Work orders: the carrier-side repair request flow.

Status flow (enforced):
  open -> looking_for_shop -> quote_received -> approved -> in_progress
       -> ready -> closed
Reject at the approval stage returns the order to looking_for_shop.
Closing requires an uploaded invoice; it appends the final amount to the
vehicle expense ledger and flips the unit back to available.
"""
import secrets
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.fleet import fleet_user
from app.config import get_settings
from app.db import get_db
from app.models import (
    Business,
    ExpenseCategory,
    FleetDriver,
    QuoteStatus,
    Trailer,
    TrailerStatus,
    User,
    Vehicle,
    VehicleExpense,
    VehicleStatus,
    WorkOrder,
    WorkOrderAttachment,
    WorkOrderEvent,
    WorkOrderPayMethod,
    WorkOrderPriority,
    WorkOrderQuote,
    WorkOrderServiceType,
    WorkOrderStatus,
    utcnow,
)

router = APIRouter(prefix="/api/fleet/work-orders", tags=["fleet"])

MAX_FILE_BYTES = 8 * 1024 * 1024
ATTACHMENT_KINDS = ("photo", "invoice", "payment_proof")


# ---------------------------------------------------------------- helpers

def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _own_wo(db: Session, user: User, wo_id: uuid.UUID) -> WorkOrder:
    wo = db.get(WorkOrder, wo_id)
    if wo is None or wo.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work order not found")
    return wo


def _require_status(wo: WorkOrder, *allowed: WorkOrderStatus) -> None:
    if wo.status not in allowed:
        names = " or ".join(s.value.replace("_", " ") for s in allowed)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This action requires the order to be in {names} (it is {wo.status.value.replace('_', ' ')})",
        )


def _event(db: Session, wo: WorkOrder, actor: User, note: str | None = None,
           from_status: WorkOrderStatus | None = None,
           to_status: WorkOrderStatus | None = None) -> None:
    db.add(WorkOrderEvent(
        work_order_id=wo.id, actor_id=actor.id,
        from_status=from_status.value if from_status else None,
        to_status=to_status.value if to_status else None,
        note=note,
    ))


def _transition(db: Session, wo: WorkOrder, actor: User,
                to: WorkOrderStatus, note: str | None = None) -> None:
    _event(db, wo, actor, note=note, from_status=wo.status, to_status=to)
    wo.status = to


def _unit_label(db: Session, wo: WorkOrder) -> dict:
    out: dict = {"unit_number": None, "trailer_unit": None}
    if wo.vehicle_id:
        v = db.get(Vehicle, wo.vehicle_id)
        out["unit_number"] = v.unit_number if v else None
    if wo.trailer_id:
        t = db.get(Trailer, wo.trailer_id)
        out["trailer_unit"] = t.unit_number if t else None
    return out


def _set_unit_status(db: Session, wo: WorkOrder, in_repair: bool) -> None:
    if wo.vehicle_id:
        v = db.get(Vehicle, wo.vehicle_id)
        if v is not None:
            v.status = VehicleStatus.IN_REPAIR if in_repair else VehicleStatus.ACTIVE
    if wo.trailer_id:
        t = db.get(Trailer, wo.trailer_id)
        if t is not None:
            t.status = TrailerStatus.IN_REPAIR if in_repair else TrailerStatus.ACTIVE


def _quote_out(q: WorkOrderQuote) -> dict:
    return {
        "id": str(q.id),
        "business_id": str(q.business_id) if q.business_id else None,
        "shop_name": q.shop_name,
        "price_cents": q.price_cents,
        "eta": q.eta,
        "note": q.note,
        "status": q.status.value,
        "created_at": _iso(q.created_at),
    }


def _wo_out(db: Session, wo: WorkOrder, detail: bool = False) -> dict:
    driver_name = None
    if wo.driver_id:
        d = db.get(FleetDriver, wo.driver_id)
        driver_name = d.name if d else None
    quotes = db.execute(
        select(WorkOrderQuote).where(WorkOrderQuote.work_order_id == wo.id)
        .order_by(WorkOrderQuote.created_at)
    ).scalars().all()
    out = {
        "id": str(wo.id),
        "wo_number": wo.wo_number,
        "status": wo.status.value,
        "service_type": wo.service_type.value,
        "priority": wo.priority.value,
        "call_type": wo.call_type,
        "description": wo.description,
        "vehicle_id": str(wo.vehicle_id) if wo.vehicle_id else None,
        "trailer_id": str(wo.trailer_id) if wo.trailer_id else None,
        "driver_id": str(wo.driver_id) if wo.driver_id else None,
        "driver_name": driver_name,
        "business_id": str(wo.business_id) if wo.business_id else None,
        "shop_name": wo.shop_name,
        "shop_confirmed_at": _iso(wo.shop_confirmed_at),
        "final_amount_cents": wo.final_amount_cents,
        "discount_cents": wo.discount_cents,
        "payment_method": wo.payment_method.value if wo.payment_method else None,
        "closing_notes": wo.closing_notes,
        "closed_at": _iso(wo.closed_at),
        "created_at": _iso(wo.created_at),
        "updated_at": _iso(wo.updated_at),
        "quote_count": len(quotes),
        "accepted_quote_id": next(
            (str(q.id) for q in quotes if q.status == QuoteStatus.ACCEPTED), None
        ),
        **_unit_label(db, wo),
    }
    if detail:
        events = db.execute(
            select(WorkOrderEvent).where(WorkOrderEvent.work_order_id == wo.id)
            .order_by(WorkOrderEvent.created_at)
        ).scalars().all()
        atts = db.execute(
            select(WorkOrderAttachment)
            .where(WorkOrderAttachment.work_order_id == wo.id)
            .order_by(WorkOrderAttachment.created_at)
        ).scalars().all()
        out["quotes"] = [_quote_out(q) for q in quotes]
        out["events"] = [{
            "id": str(e.id),
            "from_status": e.from_status,
            "to_status": e.to_status,
            "note": e.note,
            "created_at": _iso(e.created_at),
        } for e in events]
        out["attachments"] = [{
            "id": str(a.id),
            "kind": a.kind,
            "original_name": a.original_name,
            "content_type": a.content_type,
            "created_at": _iso(a.created_at),
        } for a in atts]
    return out


# ---------------------------------------------------------------- create / list / detail

class WorkOrderIn(BaseModel):
    vehicle_id: uuid.UUID | None = None
    trailer_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    service_type: WorkOrderServiceType = WorkOrderServiceType.REPAIR
    priority: WorkOrderPriority = WorkOrderPriority.NORMAL
    description: str = Field(min_length=3, max_length=4000)


@router.post("", status_code=201)
def create_work_order(body: WorkOrderIn, user: User = Depends(fleet_user),
                      db: Session = Depends(get_db)):
    if body.vehicle_id is None and body.trailer_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Pick a truck or a trailer for the request")
    if body.vehicle_id is not None:
        v = db.get(Vehicle, body.vehicle_id)
        if v is None or v.owner_user_id != user.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown truck")
    if body.trailer_id is not None:
        t = db.get(Trailer, body.trailer_id)
        if t is None or t.owner_user_id != user.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown trailer")
    if body.driver_id is not None:
        d = db.get(FleetDriver, body.driver_id)
        if d is None or d.owner_user_id != user.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown driver")

    next_no = (db.execute(
        select(func.max(WorkOrder.wo_number)).where(WorkOrder.owner_user_id == user.id)
    ).scalar() or 0) + 1
    wo = WorkOrder(
        owner_user_id=user.id, wo_number=next_no,
        vehicle_id=body.vehicle_id, trailer_id=body.trailer_id,
        driver_id=body.driver_id, service_type=body.service_type,
        priority=body.priority, description=body.description.strip(),
    )
    db.add(wo)
    db.flush()
    _event(db, wo, user, note="Request created", to_status=WorkOrderStatus.OPEN)
    db.commit()
    return _wo_out(db, wo, detail=True)


@router.get("")
def list_work_orders(status_filter: str | None = Query(default=None, alias="status"),
                     open_only: bool = Query(default=False),
                     user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    q = select(WorkOrder).where(WorkOrder.owner_user_id == user.id)
    if status_filter:
        try:
            q = q.where(WorkOrder.status == WorkOrderStatus(status_filter))
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown status")
    if open_only:
        q = q.where(WorkOrder.status != WorkOrderStatus.CLOSED)
    rows = db.execute(q.order_by(WorkOrder.created_at.desc())).scalars().all()
    return [_wo_out(db, wo) for wo in rows]


@router.get("/{wo_id}")
def get_work_order(wo_id: uuid.UUID, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    return _wo_out(db, _own_wo(db, user, wo_id), detail=True)


# ---------------------------------------------------------------- shop search

class SendIn(BaseModel):
    call_type: str = Field(pattern="^(scheduled|roadside)$")
    business_id: uuid.UUID | None = None   # assign a directory shop directly
    shop_name: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=2000)


@router.post("/{wo_id}/send")
def send_request(wo_id: uuid.UUID, body: SendIn, user: User = Depends(fleet_user),
                 db: Session = Depends(get_db)):
    """Send Request / Assign Shop: open -> looking_for_shop."""
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.OPEN)
    wo.call_type = body.call_type
    note = "Request sent to shops"
    if body.business_id is not None:
        biz = db.get(Business, body.business_id)
        if biz is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown shop")
        wo.business_id = biz.id
        wo.shop_name = biz.name
        note = f"Shop assigned: {biz.name}"
    elif body.shop_name:
        wo.shop_name = body.shop_name.strip()
        note = f"Shop assigned: {wo.shop_name}"
    if body.note:
        note = f"{note} - {body.note.strip()}"
    _transition(db, wo, user, WorkOrderStatus.LOOKING_FOR_SHOP, note=note)
    db.commit()
    return _wo_out(db, wo, detail=True)


class AssignIn(BaseModel):
    business_id: uuid.UUID | None = None
    shop_name: str | None = Field(default=None, max_length=255)
    call_type: str | None = Field(default=None, pattern="^(scheduled|roadside)$")


@router.post("/{wo_id}/assign-shop")
def assign_shop(wo_id: uuid.UUID, body: AssignIn, user: User = Depends(fleet_user),
                db: Session = Depends(get_db)):
    """Assign Shop Directly — from the map/profile picker or by name.

    Works while the order is open or still looking for a shop; an open order
    moves to looking_for_shop.
    """
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.OPEN, WorkOrderStatus.LOOKING_FOR_SHOP)
    if body.business_id is None and not (body.shop_name and body.shop_name.strip()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Pick a shop from the directory or type its name")
    if body.business_id is not None:
        biz = db.get(Business, body.business_id)
        if biz is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown shop")
        wo.business_id = biz.id
        wo.shop_name = biz.name
    else:
        wo.business_id = None
        wo.shop_name = body.shop_name.strip()
    if body.call_type:
        wo.call_type = body.call_type
    elif wo.call_type is None:
        wo.call_type = "scheduled"
    note = f"Shop assigned: {wo.shop_name}"
    if wo.status == WorkOrderStatus.OPEN:
        _transition(db, wo, user, WorkOrderStatus.LOOKING_FOR_SHOP, note=note)
    else:
        _event(db, wo, user, note=note)
    db.commit()
    return _wo_out(db, wo, detail=True)


# ---------------------------------------------------------------- quotes

class QuoteIn(BaseModel):
    shop_name: str = Field(min_length=2, max_length=255)
    business_id: uuid.UUID | None = None
    price_cents: int | None = Field(default=None, ge=0)
    eta: str | None = Field(default=None, max_length=128)
    note: str | None = Field(default=None, max_length=2000)


@router.post("/{wo_id}/quotes", status_code=201)
def add_quote(wo_id: uuid.UUID, body: QuoteIn, user: User = Depends(fleet_user),
              db: Session = Depends(get_db)):
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.LOOKING_FOR_SHOP, WorkOrderStatus.QUOTE_RECEIVED)
    if body.business_id is not None and db.get(Business, body.business_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown shop")
    quote = WorkOrderQuote(
        work_order_id=wo.id, business_id=body.business_id,
        shop_name=body.shop_name.strip(), price_cents=body.price_cents,
        eta=body.eta, note=body.note,
    )
    db.add(quote)
    if wo.status == WorkOrderStatus.LOOKING_FOR_SHOP:
        _transition(db, wo, user, WorkOrderStatus.QUOTE_RECEIVED,
                    note=f"Quote received from {quote.shop_name}")
    else:
        _event(db, wo, user, note=f"Quote received from {quote.shop_name}")
    db.commit()
    return _wo_out(db, wo, detail=True)


def _own_quote(db: Session, wo: WorkOrder, quote_id: uuid.UUID) -> WorkOrderQuote:
    q = db.get(WorkOrderQuote, quote_id)
    if q is None or q.work_order_id != wo.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    return q


@router.post("/{wo_id}/quotes/{quote_id}/accept")
def accept_quote(wo_id: uuid.UUID, quote_id: uuid.UUID,
                 user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Accept Quote: picks the shop; the order then waits for Approve/Reject."""
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.QUOTE_RECEIVED)
    quote = _own_quote(db, wo, quote_id)
    for other in db.execute(
        select(WorkOrderQuote).where(WorkOrderQuote.work_order_id == wo.id)
    ).scalars():
        if other.id != quote.id and other.status == QuoteStatus.ACCEPTED:
            other.status = QuoteStatus.PENDING
    quote.status = QuoteStatus.ACCEPTED
    wo.business_id = quote.business_id
    wo.shop_name = quote.shop_name
    _event(db, wo, user, note=f"Quote accepted: {quote.shop_name}"
           + (f" - ${quote.price_cents / 100:,.2f}" if quote.price_cents is not None else ""))
    db.commit()
    return _wo_out(db, wo, detail=True)


class NoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


@router.post("/{wo_id}/quotes/{quote_id}/negotiate")
def negotiate_quote(wo_id: uuid.UUID, quote_id: uuid.UUID, body: NoteIn,
                    user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.QUOTE_RECEIVED)
    quote = _own_quote(db, wo, quote_id)
    _event(db, wo, user, note=f"Negotiating with {quote.shop_name}: {body.note.strip()}")
    db.commit()
    return _wo_out(db, wo, detail=True)


@router.post("/{wo_id}/request-another-quote")
def request_another_quote(wo_id: uuid.UUID, user: User = Depends(fleet_user),
                          db: Session = Depends(get_db)):
    """Back to shop search; existing quotes are kept."""
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.QUOTE_RECEIVED)
    _transition(db, wo, user, WorkOrderStatus.LOOKING_FOR_SHOP,
                note="Requested another quote")
    db.commit()
    return _wo_out(db, wo, detail=True)


# ---------------------------------------------------------------- approval

@router.post("/{wo_id}/approve")
def approve(wo_id: uuid.UUID, user: User = Depends(fleet_user),
            db: Session = Depends(get_db)):
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.QUOTE_RECEIVED)
    accepted = db.execute(
        select(WorkOrderQuote).where(WorkOrderQuote.work_order_id == wo.id,
                                     WorkOrderQuote.status == QuoteStatus.ACCEPTED)
    ).scalars().first()
    if accepted is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Accept a quote before approving")
    _transition(db, wo, user, WorkOrderStatus.APPROVED, note="Approved")
    db.commit()
    return _wo_out(db, wo, detail=True)


@router.post("/{wo_id}/reject")
def reject(wo_id: uuid.UUID, body: NoteIn | None = None,
           user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Reject the accepted quote: back to shop search."""
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.QUOTE_RECEIVED)
    for q in db.execute(
        select(WorkOrderQuote).where(WorkOrderQuote.work_order_id == wo.id,
                                     WorkOrderQuote.status == QuoteStatus.ACCEPTED)
    ).scalars():
        q.status = QuoteStatus.DECLINED
    note = "Rejected" + (f": {body.note.strip()}" if body and body.note else "")
    _transition(db, wo, user, WorkOrderStatus.LOOKING_FOR_SHOP, note=note)
    db.commit()
    return _wo_out(db, wo, detail=True)


# ---------------------------------------------------------------- progress

@router.post("/{wo_id}/confirm")
def shop_confirmed(wo_id: uuid.UUID, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    """Shop confirmed receipt: approved -> in_progress, unit goes in repair."""
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.APPROVED)
    wo.shop_confirmed_at = utcnow()
    _set_unit_status(db, wo, in_repair=True)
    _transition(db, wo, user, WorkOrderStatus.IN_PROGRESS,
                note="Shop confirmed receipt - work started")
    db.commit()
    return _wo_out(db, wo, detail=True)


@router.post("/{wo_id}/notes", status_code=201)
def add_note(wo_id: uuid.UUID, body: NoteIn, user: User = Depends(fleet_user),
             db: Session = Depends(get_db)):
    """Free-form note / update request; allowed until the order is closed."""
    wo = _own_wo(db, user, wo_id)
    if wo.status == WorkOrderStatus.CLOSED:
        raise HTTPException(status.HTTP_409_CONFLICT, "The order is closed")
    _event(db, wo, user, note=body.note.strip())
    db.commit()
    return _wo_out(db, wo, detail=True)


@router.post("/{wo_id}/ready")
def mark_ready(wo_id: uuid.UUID, user: User = Depends(fleet_user),
               db: Session = Depends(get_db)):
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.IN_PROGRESS)
    _transition(db, wo, user, WorkOrderStatus.READY, note="Shop says the unit is ready")
    db.commit()
    return _wo_out(db, wo, detail=True)


# ---------------------------------------------------------------- attachments

def _media_dir() -> Path:
    d = Path(get_settings().media_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _sniff(data: bytes) -> tuple[str, str] | None:
    """Return (extension, content type) for JPEG/PNG/WebP/PDF."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg", "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    if data[:5] == b"%PDF-":
        return "pdf", "application/pdf"
    return None


@router.post("/{wo_id}/attachments", status_code=201)
async def upload_attachment(
    wo_id: uuid.UUID,
    file: UploadFile,
    kind: str = Query(pattern="^(photo|invoice|payment_proof)$"),
    user: User = Depends(fleet_user),
    db: Session = Depends(get_db),
):
    wo = _own_wo(db, user, wo_id)
    if wo.status == WorkOrderStatus.CLOSED:
        raise HTTPException(status.HTTP_409_CONFLICT, "The order is closed")
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "File exceeds 8 MB")
    sniffed = _sniff(data[:16])
    if sniffed is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Only JPEG, PNG, WebP or PDF files are accepted")
    ext, ctype = sniffed
    if kind == "photo" and ext == "pdf":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Photos must be images")
    filename = f"wo-{secrets.token_hex(16)}.{ext}"
    (_media_dir() / filename).write_bytes(data)
    att = WorkOrderAttachment(
        work_order_id=wo.id, kind=kind, filename=filename,
        original_name=(file.filename or None), content_type=ctype,
        uploaded_by=user.id,
    )
    db.add(att)
    label = {"photo": "Photo", "invoice": "Invoice", "payment_proof": "Payment proof"}[kind]
    _event(db, wo, user, note=f"{label} uploaded"
           + (f": {file.filename}" if file.filename else ""))
    db.commit()
    return {"id": str(att.id), "kind": att.kind, "original_name": att.original_name,
            "content_type": att.content_type, "created_at": _iso(att.created_at)}


@router.get("/{wo_id}/attachments/{att_id}")
def download_attachment(wo_id: uuid.UUID, att_id: uuid.UUID,
                        user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    wo = _own_wo(db, user, wo_id)
    att = db.get(WorkOrderAttachment, att_id)
    if att is None or att.work_order_id != wo.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    path = _media_dir() / att.filename
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File is missing")
    return FileResponse(path, media_type=att.content_type or "application/octet-stream",
                        filename=att.original_name or att.filename)


# ---------------------------------------------------------------- closing

class CloseIn(BaseModel):
    final_amount_cents: int = Field(ge=0)
    discount_cents: int | None = Field(default=None, ge=0)
    payment_method: WorkOrderPayMethod
    notes: str | None = Field(default=None, max_length=4000)


@router.post("/{wo_id}/close")
def close_work_order(wo_id: uuid.UUID, body: CloseIn,
                     user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    wo = _own_wo(db, user, wo_id)
    _require_status(wo, WorkOrderStatus.READY)
    has_invoice = db.execute(
        select(WorkOrderAttachment.id).where(
            WorkOrderAttachment.work_order_id == wo.id,
            WorkOrderAttachment.kind == "invoice",
        )
    ).first() is not None
    if not has_invoice:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Upload the shop invoice before closing")
    wo.final_amount_cents = body.final_amount_cents
    wo.discount_cents = body.discount_cents
    wo.payment_method = body.payment_method
    wo.closing_notes = body.notes
    wo.closed_at = utcnow()
    _set_unit_status(db, wo, in_repair=False)
    # The paid repair lands on the truck's cost ledger (and service records).
    if wo.vehicle_id is not None and body.final_amount_cents > 0:
        v = db.get(Vehicle, wo.vehicle_id)
        db.add(VehicleExpense(
            vehicle_id=wo.vehicle_id, business_id=wo.business_id,
            category=ExpenseCategory.REPAIR,
            description=f"WO-{wo.wo_number}: {wo.description[:200]}"
                        + (f" ({wo.shop_name})" if wo.shop_name else ""),
            amount_cents=body.final_amount_cents,
            odometer_miles=v.odometer_miles if v else None,
            created_by=user.id,
        ))
    _transition(db, wo, user, WorkOrderStatus.CLOSED,
                note="Closed - unit back to available")
    db.commit()
    return _wo_out(db, wo, detail=True)
