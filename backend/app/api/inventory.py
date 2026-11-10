"""Fleet inventory: equipment at the warehouse, on a truck or with a driver.

Owner-scoped like the rest of the fleet API. Money is integer cents; the
row amount is the price per unit and total = amount x quantity.
"""
import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.fleet import fleet_user
from app.api.work_orders import _media_dir, _sniff
from app.db import get_db
from app.models import FleetDriver, InventoryDocument, InventoryItem, User, Vehicle, utcnow
from app.services.report_export import report_to_xlsx

router = APIRouter(prefix="/api/fleet/inventory", tags=["fleet"])

# Order is the dropdown order.
ITEM_TYPES = {
    "snow_chains": "Snow Chains",
    "tablet": "Tablet",
    "mc_pass": "MC Pass",
    "bestpass": "BestPass",
    "prepass": "PrePass",
    "rfid_tag": "RFID tag",
    "fastrack": "FasTrack",
    "txtag": "TxTag",
    "k_tag": "K tag",
    "sun_pass": "Sun pass",
    "pike_pass": "Pike pass",
    "elite_pass": "Elite pass",
    "other": "Other",
}
TYPE_PATTERN = "^(" + "|".join(ITEM_TYPES) + ")$"
MAX_DOC_BYTES = 10 * 1024 * 1024

SORTS = {
    "name": InventoryItem.name,
    "item_type": InventoryItem.item_type,
    "quantity": InventoryItem.quantity,
    "reference": InventoryItem.reference,
    "mc_number": InventoryItem.mc_number,
    "note": InventoryItem.note,
    "created_at": InventoryItem.created_at,
    "amount": InventoryItem.amount_cents,
    "total": InventoryItem.amount_cents * InventoryItem.quantity,
}


# ---------------------------------------------------------------- helpers

def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _clean(s: str | None) -> str | None:
    s = (s or "").strip()
    return s or None


def _own_item(db: Session, user: User, item_id: uuid.UUID) -> InventoryItem:
    item = db.get(InventoryItem, item_id)
    if item is None or item.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Inventory item not found")
    return item


def _resolve_location(db: Session, user: User, kind: str,
                      vehicle_id: uuid.UUID | None, driver_id: uuid.UUID | None
                      ) -> tuple[str, uuid.UUID | None, uuid.UUID | None]:
    if kind == "warehouse":
        return "warehouse", None, None
    if kind == "vehicle":
        v = db.get(Vehicle, vehicle_id) if vehicle_id else None
        if v is None or v.owner_user_id != user.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick one of your trucks")
        return "vehicle", v.id, None
    d = db.get(FleetDriver, driver_id) if driver_id else None
    if d is None or d.owner_user_id != user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick one of your drivers")
    return "driver", None, d.id


def _labels(db: Session, user: User) -> tuple[dict, dict]:
    units = {v.id: v.unit_number for v in db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)).scalars()}
    drivers = {d.id: d.name for d in db.execute(
        select(FleetDriver).where(FleetDriver.owner_user_id == user.id)).scalars()}
    return units, drivers


def _location_label(item: InventoryItem, units: dict, drivers: dict) -> str:
    if item.location_kind == "vehicle":
        return f"Unit {units.get(item.vehicle_id, '?')}"
    if item.location_kind == "driver":
        return drivers.get(item.driver_id, "Driver")
    return "Warehouse"


def _item_out(item: InventoryItem, units: dict, drivers: dict, doc_count: int = 0) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "item_type": item.item_type,
        "type_label": ITEM_TYPES.get(item.item_type, item.item_type),
        "reference": item.reference,
        "mc_number": item.mc_number,
        "amount_cents": item.amount_cents,
        "quantity": item.quantity,
        "total_cents": item.amount_cents * item.quantity,
        "location_kind": item.location_kind,
        "vehicle_id": str(item.vehicle_id) if item.vehicle_id else None,
        "driver_id": str(item.driver_id) if item.driver_id else None,
        "location_label": _location_label(item, units, drivers),
        "note": item.note,
        "archived": item.archived_at is not None,
        "created_at": _iso(item.created_at),
        "document_count": doc_count,
    }


def _filtered_query(user: User, tab: str, q: str | None, item_type: str | None,
                    location: str | None, mc: str | None):
    stmt = select(InventoryItem).where(InventoryItem.owner_user_id == user.id)
    stmt = stmt.where(InventoryItem.archived_at.is_not(None) if tab == "archived"
                      else InventoryItem.archived_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(InventoryItem.name.ilike(like),
                              InventoryItem.reference.ilike(like),
                              InventoryItem.note.ilike(like)))
    if item_type:
        stmt = stmt.where(InventoryItem.item_type == item_type)
    if location:
        # "warehouse" | "vehicle" | "driver" | "vehicle:<uuid>" | "driver:<uuid>"
        kind, _, ref = location.partition(":")
        stmt = stmt.where(InventoryItem.location_kind == kind)
        try:
            if kind == "vehicle" and ref:
                stmt = stmt.where(InventoryItem.vehicle_id == uuid.UUID(ref))
            elif kind == "driver" and ref:
                stmt = stmt.where(InventoryItem.driver_id == uuid.UUID(ref))
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Bad location filter")
    if mc:
        stmt = stmt.where(InventoryItem.mc_number == mc)
    return stmt


def _doc_counts(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = db.execute(
        select(InventoryDocument.item_id, func.count())
        .where(InventoryDocument.item_id.in_(ids)).group_by(InventoryDocument.item_id)
    ).all()
    return {iid: n for iid, n in rows}


# ---------------------------------------------------------------- reads

@router.get("/options")
def inventory_options(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Everything the filters and the add/edit drawer need."""
    vehicles = db.execute(select(Vehicle).where(Vehicle.owner_user_id == user.id)
                          .order_by(Vehicle.unit_number)).scalars().all()
    drivers = db.execute(select(FleetDriver).where(FleetDriver.owner_user_id == user.id)
                         .order_by(FleetDriver.name)).scalars().all()
    mcs = {m for (m,) in db.execute(
        select(InventoryItem.mc_number).where(InventoryItem.owner_user_id == user.id,
                                              InventoryItem.mc_number.is_not(None))
        .distinct()).all()}
    if user.carrier_name:
        mcs.add(user.carrier_name)
    return {
        "types": [{"key": k, "label": v} for k, v in ITEM_TYPES.items()],
        "vehicles": [{"id": str(v.id), "unit_number": v.unit_number} for v in vehicles],
        "drivers": [{"id": str(d.id), "name": d.name} for d in drivers],
        "mc_numbers": sorted(mcs, key=str.lower),
        "default_mc": user.carrier_name,
    }


@router.get("")
def list_inventory(
    tab: str = Query(default="active", pattern="^(active|archived)$"),
    q: str | None = Query(default=None, max_length=128),
    item_type: str | None = Query(default=None, pattern=TYPE_PATTERN),
    location: str | None = Query(default=None, max_length=64),
    mc: str | None = Query(default=None, max_length=128),
    sort: str = Query(default="created_at", pattern="^(" + "|".join(SORTS) + ")$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    user: User = Depends(fleet_user),
    db: Session = Depends(get_db),
):
    stmt = _filtered_query(user, tab, q, item_type, location, mc)
    sub = stmt.subquery()
    total, qty_sum, money_sum = db.execute(
        select(func.count(), func.coalesce(func.sum(sub.c.quantity), 0),
               func.coalesce(func.sum(sub.c.amount_cents * sub.c.quantity), 0))
    ).one()
    col = SORTS[sort]
    ordered = stmt.order_by(col.desc() if order == "desc" else col.asc(), InventoryItem.id)
    items = db.execute(ordered.offset((page - 1) * page_size).limit(page_size)).scalars().all()
    units, drivers = _labels(db, user)
    counts = _doc_counts(db, [i.id for i in items])
    return {
        "items": [_item_out(i, units, drivers, counts.get(i.id, 0)) for i in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "totals": {"quantity": int(qty_sum), "amount_cents": int(money_sum)},
    }


@router.get("/groups")
def asset_groups(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Active inventory rolled up by type: where it sits and what it's worth."""
    rows = db.execute(
        select(InventoryItem.item_type, InventoryItem.location_kind,
               func.count(), func.sum(InventoryItem.quantity),
               func.sum(InventoryItem.amount_cents * InventoryItem.quantity))
        .where(InventoryItem.owner_user_id == user.id, InventoryItem.archived_at.is_(None))
        .group_by(InventoryItem.item_type, InventoryItem.location_kind)
    ).all()
    groups: dict[str, dict] = {}
    for itype, kind, n, qty, cents in rows:
        g = groups.setdefault(itype, {
            "item_type": itype, "type_label": ITEM_TYPES.get(itype, itype),
            "rows": 0, "quantity": 0, "total_cents": 0,
            "in_warehouse": 0, "on_trucks": 0, "with_drivers": 0,
        })
        g["rows"] += n
        g["quantity"] += int(qty or 0)
        g["total_cents"] += int(cents or 0)
        key = {"warehouse": "in_warehouse", "vehicle": "on_trucks", "driver": "with_drivers"}[kind]
        g[key] += int(qty or 0)
    order = list(ITEM_TYPES)
    return sorted(groups.values(), key=lambda g: order.index(g["item_type"])
                  if g["item_type"] in order else len(order))


@router.get("/export")
def export_inventory(
    tab: str = Query(default="active", pattern="^(active|archived)$"),
    q: str | None = Query(default=None, max_length=128),
    item_type: str | None = Query(default=None, pattern=TYPE_PATTERN),
    location: str | None = Query(default=None, max_length=64),
    mc: str | None = Query(default=None, max_length=128),
    user: User = Depends(fleet_user),
    db: Session = Depends(get_db),
):
    stmt = _filtered_query(user, tab, q, item_type, location, mc)
    items = db.execute(stmt.order_by(InventoryItem.created_at.desc())).scalars().all()
    units, drivers = _labels(db, user)
    rows = [[
        i.name, ITEM_TYPES.get(i.item_type, i.item_type), _location_label(i, units, drivers),
        i.quantity, i.reference or "", i.mc_number or "", i.note or "",
        i.created_at.date().isoformat(), i.amount_cents, i.amount_cents * i.quantity,
    ] for i in items]
    rep = {
        "title": "Inventory" + (" (archived)" if tab == "archived" else ""),
        "subtitle": f"{len(rows)} items",
        "summary": [["Items", str(len(rows))],
                    ["Total quantity", f"{sum(r[3] for r in rows):,}"],
                    ["Total amount", f"${sum(r[9] for r in rows) / 100:,.2f}"]],
        "sections": [{
            "heading": "Inventory",
            "columns": [{"h": "Name", "t": "text"}, {"h": "Type", "t": "text"},
                        {"h": "Location", "t": "text"}, {"h": "QTY", "t": "int"},
                        {"h": "Reference", "t": "text"}, {"h": "MC Number", "t": "text"},
                        {"h": "Note", "t": "text"}, {"h": "Date added", "t": "date"},
                        {"h": "Amount", "t": "money"}, {"h": "Total amount", "t": "money"}],
            "rows": rows,
            "totals": ["Total", "", "", sum(r[3] for r in rows), "", "", "", "", "",
                       sum(r[9] for r in rows)],
        }],
    }
    name = f"YourFleet inventory {utcnow().date().isoformat()}.xlsx"
    return Response(content=report_to_xlsx(rep),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- writes

class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    item_type: str = Field(default="other", pattern=TYPE_PATTERN)
    reference: str | None = Field(default=None, max_length=128)
    mc_number: str | None = Field(default=None, max_length=128)
    amount_cents: int = Field(ge=0)
    quantity: int = Field(ge=1, le=1_000_000)
    location_kind: str = Field(default="warehouse", pattern="^(warehouse|vehicle|driver)$")
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=2000)


class ItemUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    item_type: str | None = Field(default=None, pattern=TYPE_PATTERN)
    reference: str | None = Field(default=None, max_length=128)
    mc_number: str | None = Field(default=None, max_length=128)
    amount_cents: int | None = Field(default=None, ge=0)
    quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    note: str | None = Field(default=None, max_length=2000)


@router.post("", status_code=201)
def create_item(body: ItemIn, user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    kind, vid, did = _resolve_location(db, user, body.location_kind, body.vehicle_id, body.driver_id)
    item = InventoryItem(
        owner_user_id=user.id, name=body.name.strip(), item_type=body.item_type,
        reference=_clean(body.reference), mc_number=_clean(body.mc_number),
        amount_cents=body.amount_cents, quantity=body.quantity,
        location_kind=kind, vehicle_id=vid, driver_id=did, note=_clean(body.note),
    )
    db.add(item)
    db.commit()
    units, drivers = _labels(db, user)
    return _item_out(item, units, drivers)


@router.patch("/{item_id}")
def update_item(item_id: uuid.UUID, body: ItemUpdateIn,
                user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    item = _own_item(db, user, item_id)
    data = body.model_dump(exclude_unset=True)
    for key in ("reference", "mc_number", "note"):
        if key in data:
            data[key] = _clean(data[key])
    if "name" in data and data["name"]:
        data["name"] = data["name"].strip()
    for key, val in data.items():
        if val is None and key in ("name", "item_type", "amount_cents", "quantity"):
            continue  # required columns can't be blanked
        setattr(item, key, val)
    db.commit()
    units, drivers = _labels(db, user)
    return _item_out(item, units, drivers)


class MoveIn(BaseModel):
    location_kind: str = Field(pattern="^(warehouse|vehicle|driver)$")
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    quantity: int | None = Field(default=None, ge=1)


@router.post("/{item_id}/move")
def move_item(item_id: uuid.UUID, body: MoveIn,
              user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Give part or all of a row to a truck, a driver or back to the warehouse."""
    item = _own_item(db, user, item_id)
    if item.archived_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Restore the item before moving it")
    kind, vid, did = _resolve_location(db, user, body.location_kind, body.vehicle_id, body.driver_id)
    if (kind, vid, did) == (item.location_kind, item.vehicle_id, item.driver_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "It's already there")
    qty = body.quantity or item.quantity
    if qty > item.quantity:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Only {item.quantity} on this row")

    # Same item already at the destination? Add to it instead of a new row.
    target = db.execute(select(InventoryItem).where(
        InventoryItem.owner_user_id == user.id, InventoryItem.archived_at.is_(None),
        InventoryItem.id != item.id, InventoryItem.name == item.name,
        InventoryItem.item_type == item.item_type,
        InventoryItem.reference.is_not_distinct_from(item.reference),
        InventoryItem.mc_number.is_not_distinct_from(item.mc_number),
        InventoryItem.amount_cents == item.amount_cents,
        InventoryItem.location_kind == kind,
        InventoryItem.vehicle_id.is_not_distinct_from(vid),
        InventoryItem.driver_id.is_not_distinct_from(did),
    )).scalars().first()

    if target is not None:
        target.quantity += qty
        item.quantity -= qty
        result = target
        if item.quantity == 0:
            for doc in db.execute(select(InventoryDocument)
                                  .where(InventoryDocument.item_id == item.id)).scalars():
                doc.item_id = target.id  # keep the paperwork with the stock
            db.delete(item)
    elif qty == item.quantity:
        item.location_kind, item.vehicle_id, item.driver_id = kind, vid, did
        result = item
    else:
        item.quantity -= qty
        result = InventoryItem(
            owner_user_id=user.id, name=item.name, item_type=item.item_type,
            reference=item.reference, mc_number=item.mc_number,
            amount_cents=item.amount_cents, quantity=qty, note=item.note,
            location_kind=kind, vehicle_id=vid, driver_id=did,
        )
        db.add(result)
    db.commit()
    units, drivers = _labels(db, user)
    return _item_out(result, units, drivers)


@router.post("/{item_id}/archive")
def archive_item(item_id: uuid.UUID, user: User = Depends(fleet_user),
                 db: Session = Depends(get_db)):
    item = _own_item(db, user, item_id)
    item.archived_at = item.archived_at or utcnow()
    db.commit()
    units, drivers = _labels(db, user)
    return _item_out(item, units, drivers)


@router.post("/{item_id}/restore")
def restore_item(item_id: uuid.UUID, user: User = Depends(fleet_user),
                 db: Session = Depends(get_db)):
    item = _own_item(db, user, item_id)
    item.archived_at = None
    db.commit()
    units, drivers = _labels(db, user)
    return _item_out(item, units, drivers)


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: uuid.UUID, user: User = Depends(fleet_user),
                db: Session = Depends(get_db)):
    """Permanent delete — only from the archive, so nothing vanishes by accident."""
    item = _own_item(db, user, item_id)
    if item.archived_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Archive the item before deleting it")
    for doc in db.execute(select(InventoryDocument)
                          .where(InventoryDocument.item_id == item.id)).scalars():
        try:
            (_media_dir() / doc.filename).unlink(missing_ok=True)
        except OSError:
            pass
        db.delete(doc)
    db.delete(item)
    db.commit()


# ---------------------------------------------------------------- documents

def _doc_out(doc: InventoryDocument) -> dict:
    return {"id": str(doc.id), "original_name": doc.original_name,
            "content_type": doc.content_type, "created_at": _iso(doc.created_at)}


@router.get("/{item_id}/documents")
def list_documents(item_id: uuid.UUID, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    item = _own_item(db, user, item_id)
    docs = db.execute(select(InventoryDocument).where(InventoryDocument.item_id == item.id)
                      .order_by(InventoryDocument.created_at)).scalars().all()
    return [_doc_out(d) for d in docs]


@router.post("/{item_id}/documents", status_code=201)
async def upload_document(item_id: uuid.UUID, file: UploadFile,
                          user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    item = _own_item(db, user, item_id)
    data = await file.read(MAX_DOC_BYTES + 1)
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "File exceeds 10 MB")
    sniffed = _sniff(data[:16])
    if sniffed is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Only PDF, JPEG, PNG or WebP files are accepted")
    ext, ctype = sniffed
    filename = f"inv-{secrets.token_hex(16)}.{ext}"
    (_media_dir() / filename).write_bytes(data)
    doc = InventoryDocument(item_id=item.id, filename=filename,
                            original_name=file.filename or None, content_type=ctype,
                            uploaded_by=user.id)
    db.add(doc)
    db.commit()
    return _doc_out(doc)


def _own_doc(db: Session, user: User, item_id: uuid.UUID, doc_id: uuid.UUID) -> InventoryDocument:
    item = _own_item(db, user, item_id)
    doc = db.get(InventoryDocument, doc_id)
    if doc is None or doc.item_id != item.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


@router.get("/{item_id}/documents/{doc_id}")
def download_document(item_id: uuid.UUID, doc_id: uuid.UUID,
                      user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    doc = _own_doc(db, user, item_id, doc_id)
    path = _media_dir() / doc.filename
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File is missing")
    return FileResponse(path, media_type=doc.content_type or "application/octet-stream",
                        filename=doc.original_name or doc.filename)


@router.delete("/{item_id}/documents/{doc_id}", status_code=204)
def delete_document(item_id: uuid.UUID, doc_id: uuid.UUID,
                    user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    doc = _own_doc(db, user, item_id, doc_id)
    try:
        (_media_dir() / doc.filename).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(doc)
    db.commit()
