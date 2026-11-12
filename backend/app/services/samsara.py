"""Samsara telematics sync.

Pulls vehicles (VIN-matched), odometer + GPS, and open DVIR (PTI) defects into
the TMS. Runs only with SAMSARA_API_TOKEN set; the HTTP layer is injectable so
the sync logic is unit-tested without the live API. Field names follow the
Samsara v2 REST API (api.samsara.com); verify against the live account on
first run — tenant configs vary.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import InspectionDefect, User, Vehicle, utcnow
from app.services.fleet_links import link_operator
from app.services.maintenance import check_vehicle_maintenance
from app.services.notifications import notify

BASE = "https://api.samsara.com"
METERS_PER_MILE = 1609.344


@dataclass
class SamsaraVehicle:
    id: str
    name: str | None
    vin: str | None


@dataclass
class SamsaraStats:
    vehicle_id: str
    odometer_meters: float | None
    lat: float | None
    lng: float | None
    located_at: datetime | None


@dataclass
class SamsaraDefect:
    id: str
    vehicle_id: str
    defect_type: str
    comment: str | None
    resolved: bool


class SamsaraClient:
    """Thin REST wrapper; every method returns plain dataclasses."""

    def __init__(self, token: str):
        self._http = httpx.Client(
            base_url=BASE, timeout=30,
            headers={"Authorization": f"Bearer {token}"},
        )

    def _paged(self, path: str, params: dict) -> list[dict]:
        out: list[dict] = []
        after: str | None = None
        for _ in range(50):
            p = dict(params)
            if after:
                p["after"] = after
            resp = self._http.get(path, params=p)
            resp.raise_for_status()
            body = resp.json()
            out.extend(body.get("data", []))
            pag = body.get("pagination", {})
            if not pag.get("hasNextPage"):
                break
            after = pag.get("endCursor")
        return out

    def vehicles(self) -> list[SamsaraVehicle]:
        rows = self._paged("/fleet/vehicles", {"limit": 512})
        return [SamsaraVehicle(id=str(r["id"]), name=r.get("name"),
                               vin=(r.get("vin") or r.get("externalIds", {}).get("samsara.vin")))
                for r in rows]

    def stats(self) -> list[SamsaraStats]:
        rows = self._paged("/fleet/vehicles/stats",
                           {"types": "gps,obdOdometerMeters", "limit": 512})
        out = []
        for r in rows:
            gps = r.get("gps") or {}
            odo = r.get("obdOdometerMeters") or {}
            ts = gps.get("time")
            out.append(SamsaraStats(
                vehicle_id=str(r["id"]),
                odometer_meters=odo.get("value"),
                lat=gps.get("latitude"), lng=gps.get("longitude"),
                located_at=datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None,
            ))
        return out

    def open_defects(self) -> list[SamsaraDefect]:
        # /fleet/defects/history carries the defect type as a readable label
        # (the newer /defects/stream only has a type id). Window max 30 days.
        # Needs the "Read Defects" scope and a Samsara license that includes DVIRs.
        now = datetime.now(timezone.utc)
        fmt = "%Y-%m-%dT%H:%M:%SZ"
        rows = self._paged("/fleet/defects/history", {
            "startTime": (now - timedelta(days=30)).strftime(fmt),
            "endTime": now.strftime(fmt),
            "isResolved": "false",
            "limit": 512,
        })
        out = []
        for r in rows:
            vehicle = r.get("vehicle") or {}
            dtype = r.get("defectType") or "other"
            out.append(SamsaraDefect(
                id=str(r["id"]),
                vehicle_id=str(vehicle.get("id", "")),
                defect_type=(dtype.get("label") if isinstance(dtype, dict) else str(dtype)) or "other",
                comment=r.get("comment"),
                resolved=bool(r.get("isResolved")),
            ))
        return out


_UNIT_AND_DRIVER = re.compile(r"^\s*(\d[\w\-/]*)\s+([A-Za-z].*?)\s*$")


def split_vehicle_name(name: str) -> tuple[str, str | None]:
    """Carriers often name a Samsara vehicle "<unit> <driver>":
    "043 AZIZBEK ABDUGAFUROV" -> ("043", "AZIZBEK ABDUGAFUROV").
    Anything else (a bare number, a gateway serial) is the unit as is."""
    m = _UNIT_AND_DRIVER.match(name or "")
    if m:
        return m.group(1), m.group(2)
    return (name or "").strip(), None


@dataclass
class SyncReport:
    vehicles_matched: int = 0
    vehicles_created: int = 0
    odometers_updated: int = 0
    defects_created: int = 0
    maintenance_notifications: int = 0
    defects_note: str | None = None
    dry_run: bool = False
    created_units: list[str] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return self.__dict__ | {"unmatched": self.unmatched[:20],
                                "created_units": self.created_units[:50]}


def sync_samsara(
    db: Session,
    owner: User,
    *,
    vehicles_fn: Callable[[], list[SamsaraVehicle]],
    stats_fn: Callable[[], list[SamsaraStats]],
    defects_fn: Callable[[], list[SamsaraDefect]],
    create_missing: bool = False,
    dry_run: bool = False,
) -> SyncReport:
    """Match Samsara vehicles to the owner's trucks (Samsara id, then VIN,
    then unit number = Samsara name), update odometer/GPS, add open DVIR
    defects. dry_run reports what would change and writes / notifies nothing."""
    report = SyncReport(dry_run=dry_run)
    ours = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == owner.id)
    ).scalars().all()
    by_samsara_id = {v.samsara_vehicle_id: v for v in ours if v.samsara_vehicle_id}
    by_vin = {v.vin.upper(): v for v in ours if v.vin}
    by_unit = {v.unit_number.strip().lower(): v for v in ours}

    for sv in vehicles_fn():
        unit, driver = split_vehicle_name(sv.name or sv.id)
        v = (by_samsara_id.get(sv.id)
             or (by_vin.get(sv.vin.upper()) if sv.vin else None)
             or (by_unit.get(sv.name.strip().lower()) if sv.name else None)
             or by_unit.get(unit.lower()))
        if v is None:
            if create_missing:
                v = Vehicle(
                    owner_user_id=owner.id, unit_number=unit[:32],
                    name=sv.name, vin=sv.vin, samsara_vehicle_id=sv.id,
                    operator_name=driver,
                )
                db.add(v)
                db.flush()
                if driver:
                    link_operator(db, v, None)
                by_unit[v.unit_number.strip().lower()] = v
                if sv.vin:
                    by_vin[sv.vin.upper()] = v
                report.vehicles_created += 1
                report.created_units.append(v.unit_number + (f" ({driver})" if driver else ""))
            else:
                report.unmatched.append(f"{sv.name or sv.id} (vin={sv.vin or '—'})")
                continue
        else:
            if v.samsara_vehicle_id is None:
                v.samsara_vehicle_id = sv.id
            if sv.vin and not v.vin:
                v.vin = sv.vin
            report.vehicles_matched += 1
        by_samsara_id[sv.id] = v

    for st in stats_fn():
        v = by_samsara_id.get(st.vehicle_id)
        if v is None:
            continue
        # Several Samsara records can point at one truck (a replaced gateway
        # keeps its old record). Never let an older reading overwrite a newer one.
        last = v.last_location_at
        if last is not None and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if st.located_at is not None and last is not None and st.located_at < last:
            continue
        if st.located_at is not None:
            v.samsara_vehicle_id = st.vehicle_id  # follow the device that reports now
        if st.odometer_meters is not None:
            v.odometer_miles = round(st.odometer_meters / METERS_PER_MILE, 1)
            v.odometer_updated_at = utcnow()
            v.odometer_source = "samsara"
            report.odometers_updated += 1
        if st.lat is not None:
            v.last_lat, v.last_lng = st.lat, st.lng
            v.last_location_at = st.located_at or utcnow()
        if not dry_run:  # sends notifications / emails
            report.maintenance_notifications += check_vehicle_maintenance(db, v)

    # Defects are optional: a plan without the DVIR license (403) or a token
    # without "Read Defects" must not cost the odometer/GPS update.
    try:
        defects = defects_fn()
    except httpx.HTTPStatusError as e:
        defects = []
        code = e.response.status_code
        try:
            msg = e.response.json().get("message", "")
        except ValueError:
            msg = ""
        report.defects_note = f"DVIR defects not available (HTTP {code}{': ' + msg if msg else ''})"

    existing_defects = set(db.execute(
        select(InspectionDefect.samsara_defect_id)
        .where(InspectionDefect.samsara_defect_id.isnot(None))
    ).scalars())
    for d in defects:
        if d.resolved or d.id in existing_defects:
            continue
        v = by_samsara_id.get(d.vehicle_id)
        if v is None:
            continue
        db.add(InspectionDefect(
            vehicle_id=v.id, source="samsara_dvir", samsara_defect_id=d.id,
            defect_type=d.defect_type[:64], comment=d.comment,
        ))
        if not dry_run:
            notify(db, owner.id, "defect.detected",
                   f"PTI defect on unit {v.unit_number}: {d.defect_type}",
                   d.comment, {"vehicle_id": str(v.id)})
        report.defects_created += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report


def make_client() -> SamsaraClient:
    token = os.environ.get("SAMSARA_API_TOKEN", "")
    if not token:
        raise RuntimeError(
            "SAMSARA_API_TOKEN is not set. Add it to the environment (backend/.env "
            "locally, /opt/yourfleet/.env + docker-compose on the server) to enable "
            "Samsara sync. Nothing is synced or invented without it."
        )
    return SamsaraClient(token)
