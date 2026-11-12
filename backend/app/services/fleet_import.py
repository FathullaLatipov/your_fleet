"""Bulk import of trucks and trailers from an Excel (.xlsx) or CSV sheet.

Two passes over the same file: `plan_*` validates every row and decides
create / update / error without touching the database; `apply_*` writes
the valid rows. The API runs plan-only for the preview, then plan + apply.

Headers are matched loosely (case, spaces and punctuation ignored) so both
the client's import templates and a full TMS export are accepted.
A row updates the existing unit with the same number; empty cells never
blank existing data.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Trailer, TrailerStatus, User, Vehicle, VehicleStatus, utcnow
from app.services.fleet_links import link_operator, link_trailer

MAX_ROWS = 2000

# Exact template headers, in the client's order (used for the downloadable template).
TRUCK_TEMPLATE = ["Make/Model", "Unit Number", "Plate #", "VIN", "Year", "State",
                  "MC Number", "Driver", "Owner", "Odometer", "Trailer", "Status"]
TRAILER_TEMPLATE = ["Make/Model", "Unit Number", "MC Number", "Plate #", "Type", "VIN",
                    "Year", "Ownership", "State", "Assigned Truck", "Status", "Fleet Status"]

TRUCK_HEADERS = {
    "makemodel": "make_model", "make": "make", "model": "model",
    "unitnumber": "unit", "unit": "unit", "unitno": "unit", "truck": "unit",
    "trucknumber": "unit", "truckunit": "unit",
    "plate": "plate", "platenumber": "plate", "plateno": "plate", "licenseplate": "plate",
    "vin": "vin", "vinnumber": "vin",
    "year": "year",
    "state": "state", "platestate": "state",
    "mcnumber": "mc", "mc": "mc", "carrier": "mc", "mccarrier": "mc",
    "driver": "driver", "operator": "driver", "operatordriver": "driver", "drivername": "driver",
    "owner": "owner", "ownername": "owner",
    "odometer": "odometer", "mileage": "odometer", "miles": "odometer",
    "trailer": "trailer", "trailernumber": "trailer", "trailerunit": "trailer",
    "status": "status",
    "tags": "tags", "notes": "notes",
}
TRAILER_HEADERS = {
    "makemodel": "make_model", "make": "make", "model": "model",
    "unitnumber": "unit", "unit": "unit", "unitno": "unit", "trailer": "unit",
    "trailernumber": "unit", "trailerunit": "unit",
    "mcnumber": "mc", "mc": "mc", "carrier": "mc",
    "plate": "plate", "platenumber": "plate", "plateno": "plate", "licenseplate": "plate",
    "type": "type", "trailertype": "type",
    "vin": "vin", "vinnumber": "vin",
    "year": "year",
    "ownership": "ownership", "owner": "ownership", "ownername": "ownership",
    "state": "state", "platestate": "state",
    "assignedtruck": "truck", "truck": "truck", "truckunit": "truck", "trucknumber": "truck",
    "hookedto": "truck",
    "status": "status", "fleetstatus": "fleet_status",
    "notes": "notes",
}

_STATUS = {
    "active": "active", "in_service": "active",
    "in_repair": "in_repair", "in_shop": "in_repair", "shop": "in_repair",
    "repair": "in_repair", "maintenance": "in_repair",
    "inactive": "inactive", "out_of_service": "inactive", "oos": "inactive",
    "sold": "inactive", "terminated": "inactive",
}
_TRAILER_TYPES = {
    "dryvan": "dry_van", "van": "dry_van", "dry": "dry_van", "53dryvan": "dry_van",
    "reefer": "reefer", "refrigerated": "reefer", "refer": "reefer",
    "flatbed": "flatbed", "flat": "flatbed",
    "stepdeck": "step_deck", "dropdeck": "step_deck",
    "other": "other",
}


class ImportFileError(ValueError):
    """The file as a whole can't be imported (format, size, no unit column)."""


@dataclass
class RowPlan:
    row: int
    unit: str | None
    action: str = "create"            # create | update | error
    messages: list[str] = field(default_factory=list)
    fields: dict = field(default_factory=dict)
    existing_id: object = None

    def out(self) -> dict:
        return {"row": self.row, "unit": self.unit, "action": self.action,
                "messages": self.messages}


# ---------------------------------------------------------------- reading

def _norm_header(h: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(h or "").lower())


def _cell(v: object) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, datetime):
        v = v.date().isoformat()
    elif isinstance(v, date):
        v = v.isoformat()
    s = str(v).strip()
    return s or None


def read_table(data: bytes, filename: str) -> tuple[list[str], list[tuple[int, list]]]:
    """Header row + (spreadsheet row number, values) for every non-empty row."""
    name = (filename or "").lower()
    if name.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(text)))
    elif name.endswith(".xlsx") or data[:2] == b"PK":
        import openpyxl
        try:
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as e:  # noqa: BLE001 - any parse failure is a bad file
            raise ImportFileError("Couldn't read the Excel file — save it as .xlsx and try again") from e
        rows = [list(r) for r in wb.worksheets[0].iter_rows(values_only=True)]
    else:
        raise ImportFileError("Upload an Excel (.xlsx) or CSV file")
    # First non-empty row is the header.
    start = next((i for i, r in enumerate(rows) if any(_cell(c) for c in r)), None)
    if start is None:
        raise ImportFileError("The file is empty")
    header = [str(c or "").strip() for c in rows[start]]
    body = [(i + 1, list(r)) for i, r in enumerate(rows) if i > start and any(_cell(c) for c in r)]
    if len(body) > MAX_ROWS:
        raise ImportFileError(f"Up to {MAX_ROWS} rows per file")
    return header, body


def _map_columns(header: list[str], aliases: dict) -> tuple[dict[str, int], list[str]]:
    cols: dict[str, int] = {}
    ignored: list[str] = []
    for i, h in enumerate(header):
        key = aliases.get(_norm_header(h))
        if key and key not in cols:
            cols[key] = i
        elif h:
            ignored.append(h)
    if "unit" not in cols:
        raise ImportFileError("No 'Unit Number' column found — use the template headers")
    return cols, ignored


# ---------------------------------------------------------------- value parsing

def _get(values: list, cols: dict, key: str) -> str | None:
    i = cols.get(key)
    return _cell(values[i]) if i is not None and i < len(values) else None


def _split_make_model(values: list, cols: dict) -> tuple[str | None, str | None]:
    make, model = _get(values, cols, "make"), _get(values, cols, "model")
    combined = _get(values, cols, "make_model")
    if combined and not (make or model):
        parts = re.split(r"\s*/\s*", combined, maxsplit=1) if "/" in combined \
            else combined.split(None, 1)
        make = parts[0] or None
        model = parts[1] if len(parts) > 1 and parts[1] else None
    return make, model


def _year(s: str | None, msgs: list[str]) -> int | None:
    if not s:
        return None
    try:
        y = int(float(s))
    except ValueError:
        msgs.append(f"Year '{s}' isn't a number — skipped")
        return None
    if not 1950 <= y <= 2050:
        msgs.append(f"Year {y} is out of range — skipped")
        return None
    return y


def _vin(s: str | None, msgs: list[str]) -> str | None:
    if not s:
        return None
    v = re.sub(r"\s", "", s).upper()
    if not 11 <= len(v) <= 17:
        msgs.append(f"VIN '{s}' must be 11–17 characters — skipped")
        return None
    return v


def _odometer(s: str | None, msgs: list[str]) -> float | None:
    if not s:
        return None
    digits = re.sub(r"[^\d.]", "", s)
    try:
        n = float(digits)
    except ValueError:
        msgs.append(f"Odometer '{s}' isn't a number — skipped")
        return None
    if n > 5_000_000:
        msgs.append(f"Odometer {s} looks wrong — skipped")
        return None
    return n


def _fit(s: str | None, limit: int, label: str, msgs: list[str]) -> str | None:
    if s and len(s) > limit:
        msgs.append(f"{label} cut to {limit} characters")
        return s[:limit]
    return s


def _status_slug(s: str) -> str:
    return re.sub(r"[\s\-]+", "_", s.strip().lower())


# ---------------------------------------------------------------- trucks

def plan_trucks(db: Session, user: User, data: bytes, filename: str) -> tuple[list[RowPlan], list[str]]:
    header, body = read_table(data, filename)
    cols, ignored = _map_columns(header, TRUCK_HEADERS)
    existing = {v.unit_number.strip().lower(): v for v in db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)).scalars()}
    seen: dict[str, int] = {}
    plans: list[RowPlan] = []
    for rownum, values in body:
        unit = _get(values, cols, "unit")
        p = RowPlan(row=rownum, unit=unit)
        plans.append(p)
        if not unit:
            p.action, p.messages = "error", ["Unit Number is empty"]
            continue
        if len(unit) > 32:
            p.action, p.messages = "error", ["Unit Number is longer than 32 characters"]
            continue
        key = unit.lower()
        if key in seen:
            p.action, p.messages = "error", [f"Same unit as row {seen[key]} — skipped"]
            continue
        seen[key] = rownum
        msgs = p.messages
        f: dict = {}
        make, model = _split_make_model(values, cols)
        f["make"] = _fit(make, 64, "Make", msgs)
        f["model"] = _fit(model, 64, "Model", msgs)
        f["license_plate"] = _fit(_get(values, cols, "plate"), 32, "Plate", msgs)
        f["vin"] = _vin(_get(values, cols, "vin"), msgs)
        f["year"] = _year(_get(values, cols, "year"), msgs)
        f["state"] = _fit(_get(values, cols, "state"), 32, "State", msgs)
        f["mc_number"] = _fit(_get(values, cols, "mc"), 64, "MC Number", msgs)
        f["operator_name"] = _fit(_get(values, cols, "driver"), 128, "Driver", msgs)
        f["trailer_unit"] = _fit(_get(values, cols, "trailer"), 32, "Trailer", msgs)
        f["tags"] = _fit(_get(values, cols, "tags"), 255, "Tags", msgs)
        f["notes"] = _get(values, cols, "notes")
        owner = _get(values, cols, "owner")
        if owner:
            low = owner.strip().lower()
            if low in ("owner", "owned", "company", "company owned"):
                f["ownership"] = "Owner"
            elif any(w in low for w in ("rental", "rent", "lease", "leasing")):
                f["ownership"], f["owner_name"] = "Leased", _fit(owner, 128, "Owner", msgs)
            else:
                f["ownership"], f["owner_name"] = "Owner-operator", _fit(owner, 128, "Owner", msgs)
        status = _get(values, cols, "status")
        if status:
            slug = _status_slug(status)
            if slug in _STATUS:
                f["status"] = VehicleStatus(_STATUS[slug])
            else:
                f["dispatch_status"] = slug[:32]
        odo = _odometer(_get(values, cols, "odometer"), msgs)
        f = {k: v for k, v in f.items() if v is not None}

        match = existing.get(key)
        if match is not None:
            p.action, p.existing_id = "update", match.id
            if odo is not None and match.odometer_miles is not None and odo < match.odometer_miles:
                msgs.append(f"Odometer {odo:,.0f} is below the current {match.odometer_miles:,.0f} — kept current")
                odo = None
        if odo is not None:
            f["odometer_miles"] = odo
        p.fields = f
    return plans, ignored


def apply_trucks(db: Session, user: User, plans: list[RowPlan]) -> None:
    for p in plans:
        if p.action == "error":
            continue
        f = dict(p.fields)
        if p.action == "update":
            v = db.get(Vehicle, p.existing_id)
            old_op, old_tr = v.operator_name, v.trailer_unit
        else:
            v = Vehicle(owner_user_id=user.id, unit_number=p.unit)
            db.add(v)
            db.flush()
            old_op = old_tr = None
        odo = f.pop("odometer_miles", None)
        for k, val in f.items():
            setattr(v, k, val)
        if odo is not None:
            v.odometer_miles = odo
            v.odometer_updated_at = utcnow()
            v.odometer_source = "import"
        if "operator_name" in f:
            link_operator(db, v, old_op)
        if "trailer_unit" in f:
            link_trailer(db, v, old_tr)
        db.flush()


# ---------------------------------------------------------------- trailers

def plan_trailers(db: Session, user: User, data: bytes, filename: str) -> tuple[list[RowPlan], list[str]]:
    header, body = read_table(data, filename)
    cols, ignored = _map_columns(header, TRAILER_HEADERS)
    existing = {t.unit_number.strip().lower(): t for t in db.execute(
        select(Trailer).where(Trailer.owner_user_id == user.id)).scalars()}
    trucks = {v.unit_number.strip().lower().lstrip("#"): v for v in db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)).scalars()}
    seen: dict[str, int] = {}
    plans: list[RowPlan] = []
    for rownum, values in body:
        unit = _get(values, cols, "unit")
        p = RowPlan(row=rownum, unit=unit)
        plans.append(p)
        if not unit:
            p.action, p.messages = "error", ["Unit Number is empty"]
            continue
        if len(unit) > 32:
            p.action, p.messages = "error", ["Unit Number is longer than 32 characters"]
            continue
        key = unit.lower()
        if key in seen:
            p.action, p.messages = "error", [f"Same unit as row {seen[key]} — skipped"]
            continue
        seen[key] = rownum
        msgs = p.messages
        f: dict = {}
        make, model = _split_make_model(values, cols)
        f["make"] = _fit(make, 64, "Make", msgs)
        f["model"] = _fit(model, 64, "Model", msgs)
        f["mc_number"] = _fit(_get(values, cols, "mc"), 64, "MC Number", msgs)
        f["license_plate"] = _fit(_get(values, cols, "plate"), 32, "Plate", msgs)
        f["vin"] = _vin(_get(values, cols, "vin"), msgs)
        f["year"] = _year(_get(values, cols, "year"), msgs)
        f["state"] = _fit(_get(values, cols, "state"), 32, "State", msgs)
        f["fleet_status"] = _fit(_get(values, cols, "fleet_status"), 64, "Fleet Status", msgs)
        f["notes"] = _get(values, cols, "notes")
        ttype = _get(values, cols, "type")
        if ttype:
            f["trailer_type"] = _TRAILER_TYPES.get(_norm_header(ttype), ttype.strip()[:32])
        own = _get(values, cols, "ownership")
        if own:
            low = own.strip().lower()
            if any(w in low for w in ("lease", "rent")):
                f["ownership"] = "leased"
            elif low in ("owned", "own", "owner", "company", "company owned"):
                f["ownership"] = "owned"
            else:
                msgs.append(f"Ownership '{own}' isn't Owned or Leased — skipped")
        status = _get(values, cols, "status")
        if status:
            slug = _status_slug(status)
            if slug in _STATUS:
                f["status"] = TrailerStatus(_STATUS[slug])
            else:
                f["dispatch_status"] = slug[:32]
        truck = _get(values, cols, "truck")
        if truck:
            v = trucks.get(truck.strip().lower().lstrip("#"))
            if v is None:
                msgs.append(f"Truck '{truck}' isn't in your fleet — left unassigned")
            else:
                f["assigned_vehicle_id"] = v.id
        p.fields = {k: v for k, v in f.items() if v is not None}
        match = existing.get(key)
        if match is not None:
            p.action, p.existing_id = "update", match.id
    return plans, ignored


def apply_trailers(db: Session, user: User, plans: list[RowPlan]) -> None:
    for p in plans:
        if p.action == "error":
            continue
        if p.action == "update":
            t = db.get(Trailer, p.existing_id)
        else:
            t = Trailer(owner_user_id=user.id, unit_number=p.unit, status=TrailerStatus.ACTIVE)
            db.add(t)
        for k, val in p.fields.items():
            setattr(t, k, val)
        if "assigned_vehicle_id" in p.fields:
            # The truck card and work orders show the hooked trailer.
            truck = db.get(Vehicle, p.fields["assigned_vehicle_id"])
            if truck is not None:
                truck.trailer_unit = t.unit_number
        db.flush()


def template_xlsx(kind: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    headers = TRUCK_TEMPLATE if kind == "trucks" else TRAILER_TEMPLATE
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(headers)
    for i, h in enumerate(headers, start=1):
        ws.cell(row=1, column=i).font = Font(bold=True)
        ws.column_dimensions[get_column_letter(i)].width = max(12, len(h) + 4)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
