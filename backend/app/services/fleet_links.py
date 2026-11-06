"""Keep a truck's operator / trailer text in step with the roster links.

A truck carries free-text operator_name and trailer_unit (typed on the truck
form or imported from a TMS export). Drivers and trailers carry the real
link, assigned_vehicle_id. Work orders and the console read the links, so
whenever the text changes we make the matching roster entry point at the
truck — creating it if the person or trailer isn't on the roster yet.

Only the link the old text represented is undone on a change, so team
drivers assigned on the Drivers page aren't knocked off by a truck edit.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FleetDriver, Trailer, TrailerStatus, Vehicle


def _norm(s: str | None) -> str:
    return (s or "").strip().lower().lstrip("#").strip()


def link_operator(db: Session, v: Vehicle, old_name: str | None) -> None:
    new = (v.operator_name or "").strip()
    owner_drivers = db.execute(
        select(FleetDriver).where(FleetDriver.owner_user_id == v.owner_user_id)
    ).scalars().all()
    if old_name and _norm(old_name) != _norm(new):
        for d in owner_drivers:
            if d.assigned_vehicle_id == v.id and _norm(d.name) == _norm(old_name):
                d.assigned_vehicle_id = None
    if not new:
        return
    named = [d for d in owner_drivers if _norm(d.name) == _norm(new)]
    if any(d.assigned_vehicle_id == v.id for d in named):
        return
    if named:
        named[0].assigned_vehicle_id = v.id
    else:
        db.add(FleetDriver(owner_user_id=v.owner_user_id, name=new, status="active",
                           assigned_vehicle_id=v.id))


def link_trailer(db: Session, v: Vehicle, old_unit: str | None) -> None:
    new = (v.trailer_unit or "").strip()
    owner_trailers = db.execute(
        select(Trailer).where(Trailer.owner_user_id == v.owner_user_id)
    ).scalars().all()
    if old_unit and _norm(old_unit) != _norm(new):
        for t in owner_trailers:
            if t.assigned_vehicle_id == v.id and _norm(t.unit_number) == _norm(old_unit):
                t.assigned_vehicle_id = None
    if not new:
        return
    match = next((t for t in owner_trailers if _norm(t.unit_number) == _norm(new)), None)
    if match is not None:
        match.assigned_vehicle_id = v.id
    else:
        db.add(Trailer(owner_user_id=v.owner_user_id, unit_number=new.lstrip("#").strip(),
                       status=TrailerStatus.ACTIVE, assigned_vehicle_id=v.id))
