"""Fleet / TMS endpoints for carriers: vehicles, maintenance schedules,
per-truck expenses, PTI defects, and defect -> nearby-shop price options."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    AuditLog,
    Booking,
    BookingStatus,
    DefectStatus,
    InspectionDefect,
    MaintenanceSchedule,
    User,
    UserRole,
    Vehicle,
    VehicleExpense,
    VehicleStatus,
    utcnow,
)
from app.schemas import (
    BookingOut,
    BusinessListItem,
    DefectIn,
    DefectOut,
    ExpenseIn,
    ExpenseOut,
    OdometerIn,
    ScheduleDoneIn,
    ScheduleIn,
    ScheduleOut,
    VehicleDetailOut,
    VehicleIn,
    VehicleOut,
    VehicleUpdateIn,
)
from app.security import require_roles
from app.services.fleet_links import link_operator, link_trailer
from app.services.geo import SearchFilters, search_businesses
from app.services.maintenance import check_vehicle_maintenance, schedule_status

router = APIRouter(prefix="/api/fleet", tags=["fleet"])

fleet_user = require_roles(UserRole.DRIVER, UserRole.FLEET_MANAGER, UserRole.ADMIN)

# PTI defect type -> service-catalog slug, for shop/price suggestions.
DEFECT_SERVICE_MAP = [
    ("tire", "tires"), ("wheel", "tires"),
    ("brake", "brakes"),
    ("light", "electrical"), ("electric", "electrical"), ("battery", "electrical"),
    ("engine", "diesel-engine"), ("coolant", "diesel-engine"), ("leak", "diesel-engine"),
    ("oil", "pm-service"), ("pm", "pm-service"),
    ("trailer", "trailer-repair"), ("door", "trailer-repair"),
    ("transmission", "transmission"), ("clutch", "transmission"),
    ("dpf", "aftertreatment"), ("def", "aftertreatment"), ("exhaust", "aftertreatment"),
    ("tow", "towing"),
    ("weld", "welding"), ("frame", "welding"),
]


def suggest_service(defect_type: str) -> str | None:
    t = defect_type.lower()
    for key, slug in DEFECT_SERVICE_MAP:
        if key in t:
            return slug
    return None


def _own_vehicle(vehicle_id: uuid.UUID, user: User, db: Session) -> Vehicle:
    v = db.get(Vehicle, vehicle_id)
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
    if v.owner_user_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your vehicle")
    return v


def vehicle_warnings(v: Vehicle) -> list[str]:
    """Document warnings in the spirit of carrier TMS exports."""
    out: list[str] = []
    now = utcnow()
    for label, dt in (("Insurance", v.insurance_expires_at),
                      ("Inspection", v.inspection_expires_at)):
        if dt is None:
            out.append(f"No {label.lower()} date on file")
        elif dt < now:
            out.append(f"{label} expired {dt.date().isoformat()}")
        elif (dt - now).days <= 30:
            out.append(f"{label} expires in {(dt - now).days} days")
    if not v.vin:
        out.append("No VIN on file")
    return out


def _vehicle_out(db: Session, v: Vehicle) -> VehicleOut:
    out = VehicleOut.model_validate(v)
    out.warnings = vehicle_warnings(v)
    schedules = db.execute(
        select(MaintenanceSchedule).where(MaintenanceSchedule.vehicle_id == v.id)
    ).scalars().all()
    worst = "unknown" if not schedules else "ok"
    rank = {"ok": 0, "unknown": 0, "due_soon": 1, "overdue": 2}
    for s in schedules:
        st = schedule_status(s, v.odometer_miles)["status"]
        if rank.get(st, 0) > rank.get(worst, 0):
            worst = st
    out.maintenance_status = worst
    out.open_defects = db.execute(
        select(func.count(InspectionDefect.id)).where(
            InspectionDefect.vehicle_id == v.id,
            InspectionDefect.status != DefectStatus.RESOLVED)
    ).scalar_one()
    out.expenses_total_cents = db.execute(
        select(func.coalesce(func.sum(VehicleExpense.amount_cents), 0))
        .where(VehicleExpense.vehicle_id == v.id)
    ).scalar_one()
    return out


# ------------------------------------------------------------------ vehicles

@router.get("/vehicles", response_model=list[VehicleOut])
def my_vehicles(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    vehicles = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id).order_by(Vehicle.unit_number)
    ).scalars().all()
    return [_vehicle_out(db, v) for v in vehicles]


@router.post("/vehicles", response_model=VehicleOut, status_code=201)
def create_vehicle(body: VehicleIn, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    dup = db.execute(select(Vehicle).where(
        Vehicle.owner_user_id == user.id, Vehicle.unit_number == body.unit_number
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Unit {body.unit_number} already exists in your fleet")
    v = Vehicle(owner_user_id=user.id, **body.model_dump())
    if v.odometer_miles is not None:
        v.odometer_updated_at = utcnow()
        v.odometer_source = "manual"
    db.add(v)
    db.flush()  # the roster links below need v.id
    link_operator(db, v, None)
    link_trailer(db, v, None)
    db.commit()
    return _vehicle_out(db, v)


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleOut)
def update_vehicle(vehicle_id: uuid.UUID, body: VehicleUpdateIn,
                   user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    data = body.model_dump(exclude_unset=True)
    old_operator, old_trailer = v.operator_name, v.trailer_unit
    for k, val in data.items():
        setattr(v, k, val)
    if "operator_name" in data:
        link_operator(db, v, old_operator)
    if "trailer_unit" in data:
        link_trailer(db, v, old_trailer)
    db.commit()
    return _vehicle_out(db, v)


@router.post("/vehicles/{vehicle_id}/odometer", response_model=VehicleOut)
def update_odometer(vehicle_id: uuid.UUID, body: OdometerIn,
                    user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    if v.odometer_miles is not None and body.odometer_miles < v.odometer_miles:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Odometer can't go backwards")
    v.odometer_miles = body.odometer_miles
    v.odometer_updated_at = utcnow()
    v.odometer_source = "manual"
    check_vehicle_maintenance(db, v)
    db.commit()
    return _vehicle_out(db, v)


@router.get("/vehicles/{vehicle_id}", response_model=VehicleDetailOut)
def vehicle_detail(vehicle_id: uuid.UUID, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    schedules = db.execute(
        select(MaintenanceSchedule).where(MaintenanceSchedule.vehicle_id == v.id)
        .order_by(MaintenanceSchedule.created_at)
    ).scalars().all()
    sched_out = []
    for s in schedules:
        st = schedule_status(s, v.odometer_miles)
        so = ScheduleOut.model_validate(s)
        so.status, so.miles_left, so.days_left = st["status"], st["miles_left"], st["days_left"]
        sched_out.append(so)
    expenses = db.execute(
        select(VehicleExpense).where(VehicleExpense.vehicle_id == v.id)
        .order_by(VehicleExpense.incurred_at.desc()).limit(200)
    ).scalars().all()
    by_cat_rows = db.execute(
        select(VehicleExpense.category, func.sum(VehicleExpense.amount_cents))
        .where(VehicleExpense.vehicle_id == v.id).group_by(VehicleExpense.category)
    ).all()
    defects = db.execute(
        select(InspectionDefect).where(InspectionDefect.vehicle_id == v.id)
        .order_by(InspectionDefect.reported_at.desc()).limit(100)
    ).scalars().all()
    d_out = []
    for d in defects:
        do = DefectOut.model_validate(d)
        do.suggested_service_slug = suggest_service(d.defect_type)
        d_out.append(do)
    bookings = db.execute(
        select(Booking).where(Booking.vehicle_id == v.id)
        .order_by(Booking.created_at.desc()).limit(100)
    ).scalars().all()
    return VehicleDetailOut(
        vehicle=_vehicle_out(db, v),
        schedules=sched_out,
        expenses=[ExpenseOut.model_validate(e) for e in expenses],
        expenses_by_category={c.value: int(total) for c, total in by_cat_rows},
        defects=d_out,
        bookings=[BookingOut.model_validate(b) for b in bookings],
    )


# ------------------------------------------------------------------ schedules

@router.post("/vehicles/{vehicle_id}/schedules", response_model=ScheduleOut, status_code=201)
def create_schedule(vehicle_id: uuid.UUID, body: ScheduleIn,
                    user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    s = MaintenanceSchedule(vehicle_id=v.id, **body.model_dump())
    db.add(s)
    db.commit()
    st = schedule_status(s, v.odometer_miles)
    out = ScheduleOut.model_validate(s)
    out.status, out.miles_left, out.days_left = st["status"], st["miles_left"], st["days_left"]
    return out


@router.post("/schedules/{schedule_id}/done", response_model=ScheduleOut)
def mark_schedule_done(schedule_id: uuid.UUID, body: ScheduleDoneIn,
                       user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    s = db.get(MaintenanceSchedule, schedule_id)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Schedule not found")
    v = _own_vehicle(s.vehicle_id, user, db)
    s.last_done_at = body.done_at or utcnow()
    s.last_done_miles = body.done_miles if body.done_miles is not None else v.odometer_miles
    s.notified_at = None
    db.commit()
    st = schedule_status(s, v.odometer_miles)
    out = ScheduleOut.model_validate(s)
    out.status, out.miles_left, out.days_left = st["status"], st["miles_left"], st["days_left"]
    return out


@router.delete("/schedules/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: uuid.UUID, user: User = Depends(fleet_user),
                    db: Session = Depends(get_db)):
    s = db.get(MaintenanceSchedule, schedule_id)
    if s is None:
        return
    _own_vehicle(s.vehicle_id, user, db)
    db.delete(s)
    db.commit()


# ------------------------------------------------------------------ expenses

@router.post("/vehicles/{vehicle_id}/expenses", response_model=ExpenseOut, status_code=201)
def create_expense(vehicle_id: uuid.UUID, body: ExpenseIn,
                   user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    e = VehicleExpense(vehicle_id=v.id, created_by=user.id,
                       **body.model_dump(exclude_none=True))
    db.add(e)
    db.add(AuditLog(actor_id=user.id, action="fleet.expense.add",
                    entity_type="vehicle", entity_id=str(v.id),
                    data={"amount_cents": body.amount_cents}))
    db.commit()
    return e


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: uuid.UUID, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    e = db.get(VehicleExpense, expense_id)
    if e is None:
        return
    _own_vehicle(e.vehicle_id, user, db)
    if e.booking_id is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Expenses created from completed bookings can't be deleted")
    db.delete(e)
    db.commit()


# ------------------------------------------------------------------ defects / PTI

@router.post("/vehicles/{vehicle_id}/defects", response_model=DefectOut, status_code=201)
def create_defect(vehicle_id: uuid.UUID, body: DefectIn,
                  user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    d = InspectionDefect(vehicle_id=v.id, **body.model_dump())
    db.add(d)
    db.commit()
    out = DefectOut.model_validate(d)
    out.suggested_service_slug = suggest_service(d.defect_type)
    return out


@router.post("/defects/{defect_id}/resolve", response_model=DefectOut)
def resolve_defect(defect_id: uuid.UUID, user: User = Depends(fleet_user),
                   db: Session = Depends(get_db)):
    d = db.get(InspectionDefect, defect_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Defect not found")
    _own_vehicle(d.vehicle_id, user, db)
    d.status = DefectStatus.RESOLVED
    d.resolved_at = utcnow()
    db.commit()
    out = DefectOut.model_validate(d)
    out.suggested_service_slug = suggest_service(d.defect_type)
    return out


@router.get("/defects/{defect_id}/shop-options")
def defect_shop_options(
    defect_id: uuid.UUID,
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_miles: float = Query(default=100, ge=1, le=300),
    user: User = Depends(fleet_user),
    db: Session = Depends(get_db),
):
    """Shops that can fix this defect, nearest first, with their published
    price for the matching service when one exists. Falls back to the truck's
    last known (Samsara) location when no coordinates are passed."""
    d = db.get(InspectionDefect, defect_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Defect not found")
    v = _own_vehicle(d.vehicle_id, user, db)
    slug = suggest_service(d.defect_type)
    if lat is None and v.last_lat is not None:
        lat, lng = v.last_lat, v.last_lng
    rows, total = search_businesses(db, SearchFilters(
        lat=lat, lng=lng, radius_miles=radius_miles,
        service_slug=slug, sort="distance" if lat is not None else "rating",
        limit=10,
    ))
    return {
        "defect_id": str(d.id),
        "suggested_service_slug": slug,
        "used_location": {"lat": lat, "lng": lng} if lat is not None else None,
        "total": total,
        "options": [BusinessListItem(**r) for r in rows],
    }


# ------------------------------------------------------------------ analytics

ACTIVE_BOOKING_STATUSES = (
    BookingStatus.REQUESTED, BookingStatus.QUOTED, BookingStatus.ACCEPTED,
    BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.DISPUTED,
)

# Defect type -> dashboard issue bucket (history profile, independent of the
# service-catalog mapping above).
_ISSUE_BUCKETS = [
    (("tire", "wheel"), "Tires / wheels"),
    (("brake",), "Brakes"),
    (("engine", "coolant", "leak", "oil"), "Engine"),
    (("light", "electric", "battery"), "Electrical"),
    (("trailer", "door"), "Trailer"),
    (("transmission", "clutch"), "Transmission"),
    (("dpf", "def", "exhaust"), "Aftertreatment"),
]


def _issue_label(defect_type: str) -> str:
    t = defect_type.lower()
    for keys, label in _ISSUE_BUCKETS:
        if any(k in t for k in keys):
            return label
    return "Other"


def _last_months(now, n: int = 6) -> list[str]:
    """Last n calendar months as YYYY-MM, oldest first, inclusive of current."""
    y, m = now.year, now.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out[::-1]


@router.get("/analytics")
def fleet_analytics(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Fleet-wide dashboard: KPI counters, 6-month spend trend, spend by
    category, recurring issue buckets, upcoming maintenance deadlines, and
    the freshest open defects / active repair requests."""
    now = utcnow()
    vehicles = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)
    ).scalars().all()
    vehicle_ids = [v.id for v in vehicles]
    units = {v.id: v.unit_number for v in vehicles}
    odometers = {v.id: v.odometer_miles for v in vehicles}

    defects: list[InspectionDefect] = []
    expenses: list[VehicleExpense] = []
    schedules: list[MaintenanceSchedule] = []
    if vehicle_ids:
        defects = db.execute(select(InspectionDefect).where(
            InspectionDefect.vehicle_id.in_(vehicle_ids))).scalars().all()
        expenses = db.execute(select(VehicleExpense).where(
            VehicleExpense.vehicle_id.in_(vehicle_ids))).scalars().all()
        schedules = db.execute(select(MaintenanceSchedule).where(
            MaintenanceSchedule.vehicle_id.in_(vehicle_ids))).scalars().all()
    active_bookings = db.execute(
        select(Booking).where(Booking.driver_id == user.id,
                              Booking.status.in_(ACTIVE_BOOKING_STATUSES))
        .order_by(Booking.created_at.desc())
    ).scalars().all()

    open_defects = [d for d in defects if d.status != DefectStatus.RESOLVED]

    # Maintenance: counters + the deadline board (overdue/due_soon only).
    overdue = due_soon = 0
    deadlines = []
    for s in schedules:
        st = schedule_status(s, odometers.get(s.vehicle_id))
        if st["status"] == "overdue":
            overdue += 1
        elif st["status"] == "due_soon":
            due_soon += 1
        else:
            continue
        deadlines.append({
            "vehicle_id": str(s.vehicle_id),
            "unit_number": units.get(s.vehicle_id, ""),
            "title": s.title,
            "status": st["status"],
            "miles_left": st["miles_left"],
            "days_left": st["days_left"],
        })

    def deadline_key(d: dict):
        left = [x for x in (d["days_left"], d["miles_left"]) if x is not None]
        return (0 if d["status"] == "overdue" else 1, min(left) if left else 0.0)

    deadlines.sort(key=deadline_key)

    # Spend: trend is bucketed in Python (tiny data volume, no dialect tricks).
    period_start = now - timedelta(days=90)
    months = _last_months(now)
    trend = {m: 0 for m in months}
    by_category: dict[str, int] = {}
    spend_total = spend_period = 0
    for e in expenses:
        spend_total += e.amount_cents
        if e.incurred_at >= period_start:
            spend_period += e.amount_cents
        key = e.incurred_at.strftime("%Y-%m")
        if key in trend:
            trend[key] += e.amount_cents
        by_category[e.category.value] = by_category.get(e.category.value, 0) + e.amount_cents

    # Issue history: ALL defects regardless of status.
    issue_counts: dict[str, int] = {}
    for d in defects:
        label = _issue_label(d.defect_type)
        issue_counts[label] = issue_counts.get(label, 0) + 1
    top_issues = sorted(issue_counts.items(), key=lambda kv: -kv[1])[:6]

    open_sorted = sorted(open_defects, key=lambda d: d.reported_at, reverse=True)

    return {
        "kpis": {
            "trucks": len(vehicles),
            "trucks_in_repair": sum(1 for v in vehicles
                                    if v.status == VehicleStatus.IN_REPAIR),
            "open_defects": len(open_defects),
            "major_defects": sum(1 for d in open_defects if d.severity == "major"),
            "active_requests": len(active_bookings),
            "maintenance_overdue": overdue,
            "maintenance_due_soon": due_soon,
            "document_warnings": sum(len(vehicle_warnings(v)) for v in vehicles),
            "spend_total_cents": spend_total,
            "spend_period_cents": spend_period,
        },
        "spend_trend": [{"month": m, "total_cents": trend[m]} for m in months],
        "spend_by_category": [
            {"category": c, "total_cents": t}
            for c, t in sorted(by_category.items(), key=lambda kv: -kv[1]) if t > 0
        ],
        "top_issues": [{"label": label, "count": n} for label, n in top_issues],
        "deadlines": deadlines[:8],
        "open_defect_list": [{
            "id": str(d.id),
            "vehicle_id": str(d.vehicle_id),
            "unit_number": units.get(d.vehicle_id, ""),
            "defect_type": d.defect_type,
            "severity": d.severity,
            "reported_at": d.reported_at.isoformat(),
        } for d in open_sorted[:6]],
        "active_request_list": [{
            "id": str(b.id),
            "status": b.status.value,
            "issue_description": b.issue_description,
            "created_at": b.created_at.isoformat(),
            "unit_number": units.get(b.vehicle_id) if b.vehicle_id else None,
        } for b in active_bookings[:6]],
    }
