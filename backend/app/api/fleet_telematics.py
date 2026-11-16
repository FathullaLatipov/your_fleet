"""Telematics read endpoints: Fuel page and engine fault codes.

Values come straight from the Samsara sync; nothing is estimated. A field the
gateway doesn't report stays null and the UI shows it as "not reported".
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.fleet import _own_vehicle, fleet_user
from app.db import get_db
from app.models import FleetDriver, User, Vehicle, VehicleEngineFault

router = APIRouter(prefix="/api/fleet", tags=["fleet"])


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _fault_out(f: VehicleEngineFault) -> dict:
    return {
        "id": str(f.id),
        "protocol": f.protocol,
        "spn": f.spn,
        "fmi": f.fmi,
        "tx_id": f.tx_id,
        "source_name": f.source_name,
        "spn_description": f.spn_description,
        "fmi_description": f.fmi_description,
        "occurrence_count": f.occurrence_count,
        "mil_status": f.mil_status,
        "check_engine_light": f.check_engine_light,
        "is_active": f.is_active,
        "first_seen_at": _iso(f.first_seen_at),
        "last_seen_at": _iso(f.last_seen_at),
        "cleared_at": _iso(f.cleared_at),
    }


@router.get("/fuel")
def fuel_overview(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Odometer, fuel level and engine hours per truck, plus a GPS fix and
    whether the truck is connected to Samsara."""
    vehicles = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)
        .order_by(Vehicle.unit_number)
    ).scalars().all()
    drivers = {d.id: d.name for d in db.execute(
        select(FleetDriver).where(FleetDriver.owner_user_id == user.id)).scalars()}
    # Active fault count per truck, one query.
    fault_counts = dict(db.execute(
        select(VehicleEngineFault.vehicle_id, func.count())
        .join(Vehicle, Vehicle.id == VehicleEngineFault.vehicle_id)
        .where(Vehicle.owner_user_id == user.id, VehicleEngineFault.is_active.is_(True))
        .group_by(VehicleEngineFault.vehicle_id)
    ).all())

    driver_by_vehicle = {}
    for d in db.execute(select(FleetDriver).where(
            FleetDriver.owner_user_id == user.id,
            FleetDriver.assigned_vehicle_id.is_not(None))).scalars():
        driver_by_vehicle[d.assigned_vehicle_id] = d.name

    items = [{
        "id": str(v.id),
        "unit_number": v.unit_number,
        "driver": driver_by_vehicle.get(v.id) or v.operator_name,
        "connected": v.samsara_vehicle_id is not None,
        "odometer_miles": v.odometer_miles,
        "odometer_source": v.odometer_source,
        "odometer_updated_at": _iso(v.odometer_updated_at),
        "fuel_percent": v.fuel_percent,
        "fuel_updated_at": _iso(v.fuel_updated_at),
        "engine_hours": v.engine_hours,
        "engine_hours_updated_at": _iso(v.engine_hours_updated_at),
        "last_lat": v.last_lat,
        "last_lng": v.last_lng,
        "last_location_at": _iso(v.last_location_at),
        "active_faults": fault_counts.get(v.id, 0),
    } for v in vehicles]

    connected = [i for i in items if i["connected"]]
    fuels = [i["fuel_percent"] for i in connected if i["fuel_percent"] is not None]
    return {
        "items": items,
        "summary": {
            "trucks": len(items),
            "connected": len(connected),
            "reporting_fuel": len(fuels),
            "avg_fuel_percent": round(sum(fuels) / len(fuels), 1) if fuels else None,
            "trucks_with_faults": sum(1 for i in items if i["active_faults"] > 0),
        },
    }


@router.get("/positions")
def fleet_positions(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Live truck positions for the map: unit, driver, GPS, heading, speed."""
    vehicles = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)
        .order_by(Vehicle.unit_number)
    ).scalars().all()
    driver_by_vehicle = {}
    for d in db.execute(select(FleetDriver).where(
            FleetDriver.owner_user_id == user.id,
            FleetDriver.assigned_vehicle_id.is_not(None))).scalars():
        driver_by_vehicle[d.assigned_vehicle_id] = d.name
    items = [{
        "id": str(v.id),
        "unit_number": v.unit_number,
        "driver": driver_by_vehicle.get(v.id) or v.operator_name,
        "lat": v.last_lat,
        "lng": v.last_lng,
        "heading": v.last_heading,
        "speed_mph": v.last_speed_mph,
        "located_at": _iso(v.last_location_at),
        "connected": v.samsara_vehicle_id is not None,
    } for v in vehicles if v.last_lat is not None]
    return {"items": items}


@router.get("/faults")
def fleet_faults(active: bool = Query(default=True),
                 user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Engine fault codes across the fleet, newest first, with the truck unit."""
    q = (select(VehicleEngineFault, Vehicle.unit_number)
         .join(Vehicle, Vehicle.id == VehicleEngineFault.vehicle_id)
         .where(Vehicle.owner_user_id == user.id))
    if active:
        q = q.where(VehicleEngineFault.is_active.is_(True))
    rows = db.execute(q.order_by(VehicleEngineFault.last_seen_at.desc()).limit(500)).all()
    return [{**_fault_out(f), "vehicle_id": str(f.vehicle_id), "unit_number": unit}
            for f, unit in rows]


@router.get("/vehicles/{vehicle_id}/faults")
def vehicle_faults(vehicle_id: uuid.UUID,
                   user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Active and recently-cleared engine faults for one truck."""
    v = _own_vehicle(vehicle_id, user, db)
    rows = db.execute(
        select(VehicleEngineFault).where(VehicleEngineFault.vehicle_id == v.id)
        .order_by(VehicleEngineFault.is_active.desc(), VehicleEngineFault.last_seen_at.desc())
        .limit(200)
    ).scalars().all()
    return {
        "active": [_fault_out(f) for f in rows if f.is_active],
        "cleared": [_fault_out(f) for f in rows if not f.is_active][:50],
    }
