"""Fleet asset registry: trailers and the driver roster.

Same conventions as fleet.py: everything scoped to the authenticated owner,
document warnings in the TMS-export style, plain dict responses.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.fleet import fleet_user
from app.db import get_db
from app.models import FleetDriver, Trailer, TrailerStatus, User, Vehicle, utcnow

router = APIRouter(prefix="/api/fleet", tags=["fleet"])


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
    if data.get("assigned_vehicle_id") is not None:
        _assignable_vehicle(data["assigned_vehicle_id"], user, db)
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
