"""Fleet import from a carrier TMS xlsx export.

Expected header row (case-insensitive, order-independent; extra columns are
ignored): Make, Model, Unit number, Plate number, Vin, Year, State, MC number,
Operator (driver), Owner name, Odometer, Trailer, Status, Fleet Status, Tags,
Notes. Matches the common Data Track / TMS "trucks" export.

Upsert by unit number per owner; computed columns (Aging days, Warnings) are
ignored — warnings are derived live from stored document dates.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, Vehicle, VehicleStatus, utcnow

HEADER_MAP = {
    "make": "make",
    "model": "model",
    "unit number": "unit_number",
    "unit": "unit_number",
    "plate number": "license_plate",
    "plate": "license_plate",
    "vin": "vin",
    "year": "year",
    "state": "state",
    "mc number": "mc_number",
    "operator (driver)": "operator_name",
    "operator": "operator_name",
    "driver": "operator_name",
    "owner name": "ownership",
    "ownership": "ownership",
    "odometer": "odometer_miles",
    "trailer": "trailer_unit",
    "status": "dispatch_status",
    "fleet status": "fleet_status",
    "tags": "tags",
    "notes": "notes",
}


def _clean(value) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    # The exports carry junk placeholders like ",,..,,.." or "TEmp.."
    if not s or not any(ch.isalnum() for ch in s):
        return None
    return s


def import_vehicles_xlsx(db: Session, owner: User, path: str, dry_run: bool = False) -> dict:
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = next(rows, None)
    if not header:
        return {"error": "empty sheet"}
    cols: dict[int, str] = {}
    for i, h in enumerate(header):
        key = HEADER_MAP.get(str(h).strip().lower()) if h else None
        if key:
            cols[i] = key
    if "unit_number" not in cols.values():
        return {"error": "no 'Unit number' column found", "header": [str(h) for h in header]}

    existing = {
        v.unit_number: v
        for v in db.execute(select(Vehicle).where(Vehicle.owner_user_id == owner.id)).scalars()
    }
    report = {"created": 0, "updated": 0, "skipped": 0, "dry_run": dry_run, "issues": []}

    for row in rows:
        data: dict = {}
        for i, key in cols.items():
            data[key] = _clean(row[i]) if i < len(row) else None
        unit = data.pop("unit_number", None)
        if not unit:
            report["skipped"] += 1
            continue
        fleet_status = (data.pop("fleet_status", None) or "").lower()
        if data.get("year"):
            try:
                data["year"] = int(float(data["year"]))
            except ValueError:
                report["issues"].append(f"unit {unit}: bad year {data['year']!r}")
                data["year"] = None
        if data.get("odometer_miles") is not None:
            try:
                data["odometer_miles"] = float(data["odometer_miles"])
            except ValueError:
                data["odometer_miles"] = None
        if data.get("vin"):
            data["vin"] = data["vin"].upper()
            if len(data["vin"]) not in (11, 17) and not (11 <= len(data["vin"]) <= 17):
                report["issues"].append(f"unit {unit}: VIN looks off ({data['vin']})")

        v = existing.get(unit)
        if v is None:
            v = Vehicle(owner_user_id=owner.id, unit_number=unit)
            db.add(v)
            existing[unit] = v
            report["created"] += 1
        else:
            report["updated"] += 1
        odo = data.pop("odometer_miles", None)
        for key, value in data.items():
            if value is not None:
                setattr(v, key, value)
        # Odometer only moves forward; 0 in exports means "not tracked".
        if odo and (v.odometer_miles is None or odo > v.odometer_miles):
            v.odometer_miles = odo
            v.odometer_updated_at = utcnow()
            v.odometer_source = "import"
        if fleet_status and fleet_status != "active" and v.status in (None, VehicleStatus.ACTIVE):
            v.status = VehicleStatus.INACTIVE
        elif fleet_status == "active" and v.status == VehicleStatus.INACTIVE:
            v.status = VehicleStatus.ACTIVE

    if dry_run:
        db.rollback()
    else:
        db.commit()
    report["issues"] = report["issues"][:20]
    return report
