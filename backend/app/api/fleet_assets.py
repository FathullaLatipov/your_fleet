"""Fleet asset registry: trailers and the driver roster.

Same conventions as fleet.py: everything scoped to the authenticated owner,
document warnings in the TMS-export style, plain dict responses.
"""
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.fleet import fleet_user
from app.api.work_orders import _media_dir, _sniff
from app.db import get_db
from app.models import (
    FleetDriver, Trailer, TrailerStatus, User, Vehicle, VehicleDocument, utcnow,
)

router = APIRouter(prefix="/api/fleet", tags=["fleet"])

MAX_DOC_BYTES = 10 * 1024 * 1024


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def doc_warnings(pairs: list[tuple[str, datetime | None]]) -> list[str]:
    """Mirror of fleet.vehicle_warnings for arbitrary (label, date) pairs."""
    out: list[str] = []
    now = utcnow()
    for label, dt in pairs:
        dt = _aware(dt)
        low = label if label.isupper() else label.lower()
        if dt is None:
            out.append(f"No {low} date on file")
        elif dt < now:
            out.append(f"{label} expired {dt.date().isoformat()}")
        elif (dt - now).days <= 30:
            out.append(f"{label} expires in {(dt - now).days} days")
    return out


def _unit_map(db: Session, user: User) -> dict[uuid.UUID, str]:
    rows = db.execute(
        select(Vehicle.id, Vehicle.unit_number).where(Vehicle.owner_user_id == user.id)
    ).all()
    return {vid: unit for vid, unit in rows}


def _assignable_vehicle(vehicle_id: uuid.UUID, user: User, db: Session) -> Vehicle:
    v = db.get(Vehicle, vehicle_id)
    if v is None or v.owner_user_id != user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "assigned_vehicle_id is not one of your vehicles")
    return v


# ------------------------------------------------------------------ trailers

class TrailerIn(BaseModel):
    unit_number: str = Field(min_length=1, max_length=32)
    trailer_type: str | None = Field(default=None, max_length=32)
    year: int | None = Field(default=None, ge=1950, le=2050)
    vin: str | None = Field(default=None, min_length=11, max_length=17)
    license_plate: str | None = Field(default=None, max_length=32)
    state: str | None = Field(default=None, max_length=32)
    inspection_expires_at: datetime | None = None
    registration_expires_at: datetime | None = None
    ownership: str | None = Field(default=None, pattern="^(owned|leased)$")
    lease_cents_monthly: int | None = Field(default=None, ge=0)
    tires_condition: str | None = Field(default=None, pattern="^(good|fair|replace_soon)$")
    notes: str | None = None

    @field_validator("vin")
    @classmethod
    def upper_vin(cls, v: str | None) -> str | None:
        return v.upper() if v else v


class TrailerUpdateIn(BaseModel):
    unit_number: str | None = Field(default=None, min_length=1, max_length=32)
    trailer_type: str | None = Field(default=None, max_length=32)
    year: int | None = Field(default=None, ge=1950, le=2050)
    vin: str | None = Field(default=None, min_length=11, max_length=17)
    license_plate: str | None = Field(default=None, max_length=32)
    state: str | None = Field(default=None, max_length=32)
    status: TrailerStatus | None = None
    assigned_vehicle_id: uuid.UUID | None = None
    inspection_expires_at: datetime | None = None
    registration_expires_at: datetime | None = None
    ownership: str | None = Field(default=None, pattern="^(owned|leased)$")
    lease_cents_monthly: int | None = Field(default=None, ge=0)
    tires_condition: str | None = Field(default=None, pattern="^(good|fair|replace_soon)$")
    notes: str | None = None

    @field_validator("vin")
    @classmethod
    def upper_vin(cls, v: str | None) -> str | None:
        return v.upper() if v else v


def trailer_warnings(t: Trailer) -> list[str]:
    return doc_warnings([("Inspection", t.inspection_expires_at),
                         ("Registration", t.registration_expires_at)])


def _trailer_out(t: Trailer, units: dict[uuid.UUID, str]) -> dict:
    return {
        "id": str(t.id),
        "unit_number": t.unit_number,
        "trailer_type": t.trailer_type,
        "year": t.year,
        "vin": t.vin,
        "license_plate": t.license_plate,
        "state": t.state,
        "status": t.status.value,
        "assigned_vehicle_id": str(t.assigned_vehicle_id) if t.assigned_vehicle_id else None,
        "assigned_unit": units.get(t.assigned_vehicle_id) if t.assigned_vehicle_id else None,
        "inspection_expires_at": _iso(t.inspection_expires_at),
        "registration_expires_at": _iso(t.registration_expires_at),
        "ownership": t.ownership,
        "lease_cents_monthly": t.lease_cents_monthly,
        "tires_condition": t.tires_condition,
        "notes": t.notes,
        "warnings": trailer_warnings(t),
    }


def _own_trailer(trailer_id: uuid.UUID, user: User, db: Session) -> Trailer:
    t = db.get(Trailer, trailer_id)
    if t is None or t.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trailer not found")
    return t


@router.get("/trailers")
def my_trailers(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    trailers = db.execute(
        select(Trailer).where(Trailer.owner_user_id == user.id)
        .order_by(Trailer.unit_number)
    ).scalars().all()
    units = _unit_map(db, user)
    return [_trailer_out(t, units) for t in trailers]


@router.post("/trailers", status_code=201)
def create_trailer(body: TrailerIn, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    dup = db.execute(select(Trailer).where(
        Trailer.owner_user_id == user.id, Trailer.unit_number == body.unit_number
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Trailer {body.unit_number} already exists in your fleet")
    t = Trailer(owner_user_id=user.id, **body.model_dump())
    db.add(t)
    db.commit()
    return _trailer_out(t, _unit_map(db, user))


@router.patch("/trailers/{trailer_id}")
def update_trailer(trailer_id: uuid.UUID, body: TrailerUpdateIn,
                   user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    t = _own_trailer(trailer_id, user, db)
    data = body.model_dump(exclude_unset=True)
    hooked_to = None
    if data.get("assigned_vehicle_id") is not None:
        hooked_to = _assignable_vehicle(data["assigned_vehicle_id"], user, db)
    # Unhooking clears the old truck's trailer text if it named this trailer.
    if "assigned_vehicle_id" in data and t.assigned_vehicle_id is not None \
            and t.assigned_vehicle_id != data["assigned_vehicle_id"]:
        prev = db.get(Vehicle, t.assigned_vehicle_id)
        if prev is not None and (prev.trailer_unit or "").strip().lstrip("#") == t.unit_number:
            prev.trailer_unit = None
    if "unit_number" in data and data["unit_number"] != t.unit_number:
        dup = db.execute(select(Trailer).where(
            Trailer.owner_user_id == user.id,
            Trailer.unit_number == data["unit_number"],
            Trailer.id != t.id,
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"Trailer {data['unit_number']} already exists in your fleet")
    for k, val in data.items():
        setattr(t, k, val)
    if hooked_to is not None:
        # The truck card and work orders show the hooked trailer.
        hooked_to.trailer_unit = t.unit_number
    db.commit()
    return _trailer_out(t, _unit_map(db, user))


@router.delete("/trailers/{trailer_id}", status_code=204)
def delete_trailer(trailer_id: uuid.UUID, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    t = db.get(Trailer, trailer_id)
    if t is None:
        return
    if t.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trailer not found")
    db.delete(t)
    db.commit()


# ------------------------------------------------------------------ drivers

class DriverIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    cdl_number: str | None = Field(default=None, max_length=32)
    cdl_class: str | None = Field(default=None, max_length=8)
    cdl_expires_at: datetime | None = None
    medical_card_expires_at: datetime | None = None
    hired_at: datetime | None = None
    notes: str | None = None


class DriverUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    cdl_number: str | None = Field(default=None, max_length=32)
    cdl_class: str | None = Field(default=None, max_length=8)
    cdl_expires_at: datetime | None = None
    medical_card_expires_at: datetime | None = None
    status: str | None = Field(default=None, pattern="^(active|inactive)$")
    assigned_vehicle_id: uuid.UUID | None = None
    hired_at: datetime | None = None
    notes: str | None = None


def driver_warnings(d: FleetDriver) -> list[str]:
    return doc_warnings([("CDL", d.cdl_expires_at),
                         ("Medical card", d.medical_card_expires_at)])


def _driver_out(d: FleetDriver, units: dict[uuid.UUID, str]) -> dict:
    return {
        "id": str(d.id),
        "name": d.name,
        "phone": d.phone,
        "email": d.email,
        "cdl_number": d.cdl_number,
        "cdl_class": d.cdl_class,
        "cdl_expires_at": _iso(d.cdl_expires_at),
        "medical_card_expires_at": _iso(d.medical_card_expires_at),
        "status": d.status,
        "assigned_vehicle_id": str(d.assigned_vehicle_id) if d.assigned_vehicle_id else None,
        "assigned_unit": units.get(d.assigned_vehicle_id) if d.assigned_vehicle_id else None,
        "hired_at": _iso(d.hired_at),
        "notes": d.notes,
        "warnings": driver_warnings(d),
    }


def _own_driver(driver_id: uuid.UUID, user: User, db: Session) -> FleetDriver:
    d = db.get(FleetDriver, driver_id)
    if d is None or d.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Driver not found")
    return d


@router.get("/drivers")
def my_drivers(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    drivers = db.execute(
        select(FleetDriver).where(FleetDriver.owner_user_id == user.id)
        .order_by(FleetDriver.name)
    ).scalars().all()
    units = _unit_map(db, user)
    return [_driver_out(d, units) for d in drivers]


@router.post("/drivers", status_code=201)
def create_driver(body: DriverIn, user: User = Depends(fleet_user),
                  db: Session = Depends(get_db)):
    d = FleetDriver(owner_user_id=user.id, **body.model_dump())
    db.add(d)
    db.commit()
    return _driver_out(d, _unit_map(db, user))


@router.patch("/drivers/{driver_id}")
def update_driver(driver_id: uuid.UUID, body: DriverUpdateIn,
                  user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    d = _own_driver(driver_id, user, db)
    data = body.model_dump(exclude_unset=True)
    vehicle = None
    if data.get("assigned_vehicle_id") is not None:
        vehicle = _assignable_vehicle(data["assigned_vehicle_id"], user, db)
    # Moving the driver off a truck clears that truck's operator text if it was them.
    if "assigned_vehicle_id" in data and d.assigned_vehicle_id is not None \
            and d.assigned_vehicle_id != data["assigned_vehicle_id"]:
        prev = db.get(Vehicle, d.assigned_vehicle_id)
        if prev is not None and (prev.operator_name or "").strip().lower() == d.name.strip().lower():
            prev.operator_name = None
    for k, val in data.items():
        setattr(d, k, val)
    if vehicle is not None:
        # Convenience sync: the truck card shows the assigned driver's name.
        vehicle.operator_name = d.name
    db.commit()
    return _driver_out(d, _unit_map(db, user))


@router.delete("/drivers/{driver_id}", status_code=204)
def delete_driver(driver_id: uuid.UUID, user: User = Depends(fleet_user),
                  db: Session = Depends(get_db)):
    d = db.get(FleetDriver, driver_id)
    if d is None:
        return
    if d.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Driver not found")
    db.delete(d)
    db.commit()


# ------------------------------------------------------------------ vehicle documents

DOC_KINDS = {
    "registration": "IRP registration / cab card",
    "insurance": "Certificate of insurance",
    "annual_inspection": "DOT annual inspection",
    "ifta": "IFTA license & decals",
    "hvut_2290": "Form 2290 (HVUT) Schedule 1",
    "title": "Certificate of title",
    "other": "Other document",
}


def _doc_status(expires_at: datetime | None) -> str:
    if expires_at is None:
        return "no_expiry"
    now = utcnow()
    dt = _aware(expires_at)
    if dt < now:
        return "overdue"
    if (dt - now).days <= 30:
        return "due_soon"
    return "valid"


def _doc_out(doc: VehicleDocument) -> dict:
    return {
        "id": str(doc.id),
        "kind": doc.kind,
        "label": doc.title or DOC_KINDS.get(doc.kind, doc.kind),
        "expires_at": _iso(doc.expires_at),
        "status": _doc_status(doc.expires_at),
        "has_file": doc.filename is not None,
        "original_name": doc.original_name,
        "content_type": doc.content_type,
        "created_at": _iso(doc.created_at),
    }


def _own_vehicle_here(vehicle_id: uuid.UUID, user: User, db: Session) -> Vehicle:
    v = db.get(Vehicle, vehicle_id)
    if v is None or v.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
    return v


def _own_doc(db: Session, user: User, vehicle_id: uuid.UUID,
             doc_id: uuid.UUID) -> VehicleDocument:
    _own_vehicle_here(vehicle_id, user, db)
    doc = db.get(VehicleDocument, doc_id)
    if doc is None or doc.vehicle_id != vehicle_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


@router.get("/vehicles/{vehicle_id}/documents")
def list_documents(vehicle_id: uuid.UUID, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    _own_vehicle_here(vehicle_id, user, db)
    docs = db.execute(
        select(VehicleDocument).where(VehicleDocument.vehicle_id == vehicle_id)
        .order_by(VehicleDocument.created_at)
    ).scalars().all()
    return {"documents": [_doc_out(d) for d in docs],
            "kinds": [{"kind": k, "label": v} for k, v in DOC_KINDS.items()]}


class DocumentIn(BaseModel):
    kind: str = Field(pattern="^(registration|insurance|annual_inspection|ifta|hvut_2290|title|other)$")
    title: str | None = Field(default=None, max_length=128)
    expires_at: datetime | None = None


@router.post("/vehicles/{vehicle_id}/documents", status_code=201)
def create_document(vehicle_id: uuid.UUID, body: DocumentIn,
                    user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    _own_vehicle_here(vehicle_id, user, db)
    doc = VehicleDocument(vehicle_id=vehicle_id, kind=body.kind,
                          title=(body.title or None), expires_at=body.expires_at)
    db.add(doc)
    db.commit()
    return _doc_out(doc)


class DocumentUpdateIn(BaseModel):
    title: str | None = Field(default=None, max_length=128)
    expires_at: datetime | None = None


@router.patch("/vehicles/{vehicle_id}/documents/{doc_id}")
def update_document(vehicle_id: uuid.UUID, doc_id: uuid.UUID, body: DocumentUpdateIn,
                    user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    doc = _own_doc(db, user, vehicle_id, doc_id)
    data = body.model_dump(exclude_unset=True)
    if "title" in data:
        doc.title = data["title"] or None
    if "expires_at" in data:
        doc.expires_at = data["expires_at"]
    db.commit()
    return _doc_out(doc)


@router.delete("/vehicles/{vehicle_id}/documents/{doc_id}", status_code=204)
def delete_document(vehicle_id: uuid.UUID, doc_id: uuid.UUID,
                    user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    doc = _own_doc(db, user, vehicle_id, doc_id)
    if doc.filename:
        try:
            (_media_dir() / doc.filename).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(doc)
    db.commit()


@router.post("/vehicles/{vehicle_id}/documents/{doc_id}/file")
async def upload_document_file(vehicle_id: uuid.UUID, doc_id: uuid.UUID,
                               file: UploadFile,
                               user: User = Depends(fleet_user),
                               db: Session = Depends(get_db)):
    doc = _own_doc(db, user, vehicle_id, doc_id)
    data = await file.read(MAX_DOC_BYTES + 1)
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "File exceeds 10 MB")
    sniffed = _sniff(data[:16])
    if sniffed is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Only PDF, JPEG, PNG or WebP files are accepted")
    ext, ctype = sniffed
    if doc.filename:  # replace the old file
        try:
            (_media_dir() / doc.filename).unlink(missing_ok=True)
        except OSError:
            pass
    filename = f"doc-{secrets.token_hex(16)}.{ext}"
    (_media_dir() / filename).write_bytes(data)
    doc.filename = filename
    doc.original_name = file.filename or None
    doc.content_type = ctype
    doc.uploaded_by = user.id
    db.commit()
    return _doc_out(doc)


@router.get("/vehicles/{vehicle_id}/documents/{doc_id}/file")
def download_document_file(vehicle_id: uuid.UUID, doc_id: uuid.UUID,
                           user: User = Depends(fleet_user),
                           db: Session = Depends(get_db)):
    doc = _own_doc(db, user, vehicle_id, doc_id)
    if not doc.filename:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No file on this document")
    path = _media_dir() / doc.filename
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File is missing")
    return FileResponse(path, media_type=doc.content_type or "application/octet-stream",
                        filename=doc.original_name or doc.filename)
