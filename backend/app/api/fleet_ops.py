"""Fleet operations: tasks, communication log, issue board, deadline board,
merged service history, expense ledger and per-truck cost insights.

Same conventions as fleet.py: owner-scoped, plain dict responses, Python
aggregation over simple selects (tiny per-user volumes).
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.fleet import _last_months, _own_vehicle, fleet_user, suggest_service
from app.db import get_db
from app.models import (
    Booking,
    BookingStatus,
    Business,
    CommLogEntry,
    DefectStatus,
    ExpenseCategory,
    FleetDriver,
    FleetTask,
    InspectionDefect,
    MaintenanceSchedule,
    TaskStatus,
    Trailer,
    User,
    Vehicle,
    VehicleDocument,
    VehicleExpense,
    utcnow,
)
from app.services.maintenance import schedule_status

router = APIRouter(prefix="/api/fleet", tags=["fleet"])


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _my_vehicles(db: Session, user: User) -> dict[uuid.UUID, str]:
    rows = db.execute(
        select(Vehicle.id, Vehicle.unit_number).where(Vehicle.owner_user_id == user.id)
    ).all()
    return {vid: unit for vid, unit in rows}


def _my_drivers(db: Session, user: User) -> dict[uuid.UUID, str]:
    rows = db.execute(
        select(FleetDriver.id, FleetDriver.name)
        .where(FleetDriver.owner_user_id == user.id)
    ).all()
    return {did: name for did, name in rows}


def _check_links(db: Session, user: User,
                 vehicle_id: uuid.UUID | None, driver_id: uuid.UUID | None) -> None:
    if vehicle_id is not None:
        v = db.get(Vehicle, vehicle_id)
        if v is None or v.owner_user_id != user.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "vehicle_id is not one of your vehicles")
    if driver_id is not None:
        d = db.get(FleetDriver, driver_id)
        if d is None or d.owner_user_id != user.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "driver_id is not one of your drivers")


# -------------------------------------------------------------------- tasks

class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    details: str | None = None
    priority: str = Field(default="medium", pattern="^(low|medium|high)$")
    due_at: datetime | None = None
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None


class TaskUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    details: str | None = None
    priority: str | None = Field(default=None, pattern="^(low|medium|high)$")
    status: TaskStatus | None = None
    due_at: datetime | None = None


def _task_out(t: FleetTask, units: dict, drivers: dict, now: datetime) -> dict:
    due = _aware(t.due_at)
    return {
        "id": str(t.id),
        "title": t.title,
        "details": t.details,
        "priority": t.priority,
        "status": t.status.value,
        "due_at": _iso(t.due_at),
        "vehicle_id": str(t.vehicle_id) if t.vehicle_id else None,
        "unit_number": units.get(t.vehicle_id) if t.vehicle_id else None,
        "driver_id": str(t.driver_id) if t.driver_id else None,
        "driver_name": drivers.get(t.driver_id) if t.driver_id else None,
        "created_at": _iso(t.created_at),
        "completed_at": _iso(t.completed_at),
        "overdue": due is not None and due < now and t.status != TaskStatus.DONE,
    }


@router.get("/tasks")
def my_tasks(
    status_filter: str = Query(default="active", alias="status",
                               pattern="^(open|in_progress|done|active)$"),
    user: User = Depends(fleet_user),
    db: Session = Depends(get_db),
):
    q = select(FleetTask).where(FleetTask.owner_user_id == user.id)
    if status_filter == "active":
        q = q.where(FleetTask.status != TaskStatus.DONE)
    else:
        q = q.where(FleetTask.status == TaskStatus(status_filter))
    tasks = db.execute(q).scalars().all()

    far_future = datetime.max.replace(tzinfo=timezone.utc)
    epoch = datetime.min.replace(tzinfo=timezone.utc)

    def sort_key(t: FleetTask):
        if t.status == TaskStatus.DONE:
            # done last, newest completion first
            done_at = _aware(t.completed_at) or _aware(t.created_at) or epoch
            return (1, 0, -done_at.timestamp())
        due = _aware(t.due_at)
        created = _aware(t.created_at) or epoch
        return (0, 0 if due is not None else 1,
                (due or far_future).timestamp(), created.timestamp())

    tasks.sort(key=sort_key)
    units = _my_vehicles(db, user)
    drivers = _my_drivers(db, user)
    now = utcnow()
    return [_task_out(t, units, drivers, now) for t in tasks[:200]]


@router.post("/tasks", status_code=201)
def create_task(body: TaskIn, user: User = Depends(fleet_user),
                db: Session = Depends(get_db)):
    _check_links(db, user, body.vehicle_id, body.driver_id)
    t = FleetTask(owner_user_id=user.id, **body.model_dump())
    db.add(t)
    db.commit()
    return _task_out(t, _my_vehicles(db, user), _my_drivers(db, user), utcnow())


@router.patch("/tasks/{task_id}")
def update_task(task_id: uuid.UUID, body: TaskUpdateIn,
                user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    t = db.get(FleetTask, task_id)
    if t is None or t.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    data = body.model_dump(exclude_unset=True)
    new_status = data.get("status")
    for k, val in data.items():
        setattr(t, k, val)
    if new_status is not None:
        if new_status == TaskStatus.DONE:
            if t.completed_at is None:
                t.completed_at = utcnow()
        else:
            t.completed_at = None
    db.commit()
    return _task_out(t, _my_vehicles(db, user), _my_drivers(db, user), utcnow())


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, user: User = Depends(fleet_user),
                db: Session = Depends(get_db)):
    t = db.get(FleetTask, task_id)
    if t is None:
        return
    if t.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    db.delete(t)
    db.commit()


# ----------------------------------------------------------------- comm log

class CommLogIn(BaseModel):
    kind: str = Field(default="note", pattern="^(call|email|text|note)$")
    subject: str = Field(min_length=1, max_length=255)
    body: str | None = None
    contact_name: str | None = Field(default=None, max_length=128)
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    booking_id: uuid.UUID | None = None
    happened_at: datetime | None = None


def _comm_out(e: CommLogEntry, units: dict, drivers: dict) -> dict:
    return {
        "id": str(e.id),
        "kind": e.kind,
        "subject": e.subject,
        "body": e.body,
        "contact_name": e.contact_name,
        "vehicle_id": str(e.vehicle_id) if e.vehicle_id else None,
        "unit_number": units.get(e.vehicle_id) if e.vehicle_id else None,
        "driver_id": str(e.driver_id) if e.driver_id else None,
        "driver_name": drivers.get(e.driver_id) if e.driver_id else None,
        "booking_id": str(e.booking_id) if e.booking_id else None,
        "happened_at": _iso(e.happened_at),
    }


@router.get("/comm-log")
def comm_log(limit: int = Query(default=100, ge=1, le=500),
             user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    entries = db.execute(
        select(CommLogEntry).where(CommLogEntry.owner_user_id == user.id)
        .order_by(CommLogEntry.happened_at.desc()).limit(limit)
    ).scalars().all()
    units = _my_vehicles(db, user)
    drivers = _my_drivers(db, user)
    return [_comm_out(e, units, drivers) for e in entries]


@router.post("/comm-log", status_code=201)
def create_comm_entry(body: CommLogIn, user: User = Depends(fleet_user),
                      db: Session = Depends(get_db)):
    _check_links(db, user, body.vehicle_id, body.driver_id)
    if body.booking_id is not None:
        b = db.get(Booking, body.booking_id)
        if b is None or b.driver_id != user.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "booking_id is not one of your bookings")
    data = body.model_dump()
    if data.get("happened_at") is None:
        data["happened_at"] = utcnow()
    e = CommLogEntry(owner_user_id=user.id, **data)
    db.add(e)
    db.commit()
    return _comm_out(e, _my_vehicles(db, user), _my_drivers(db, user))


@router.delete("/comm-log/{entry_id}", status_code=204)
def delete_comm_entry(entry_id: uuid.UUID, user: User = Depends(fleet_user),
                      db: Session = Depends(get_db)):
    e = db.get(CommLogEntry, entry_id)
    if e is None:
        return
    if e.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    db.delete(e)
    db.commit()


# ------------------------------------------------------------------- issues

@router.get("/issues")
def my_issues(
    status_filter: str = Query(default="active", alias="status",
                               pattern="^(active|open|in_repair|resolved|all)$"),
    user: User = Depends(fleet_user),
    db: Session = Depends(get_db),
):
    units = _my_vehicles(db, user)
    if not units:
        return []
    q = select(InspectionDefect).where(InspectionDefect.vehicle_id.in_(units.keys()))
    if status_filter == "active":
        q = q.where(InspectionDefect.status != DefectStatus.RESOLVED)
    elif status_filter != "all":
        q = q.where(InspectionDefect.status == DefectStatus(status_filter))
    defects = db.execute(
        q.order_by(InspectionDefect.reported_at.desc()).limit(200)
    ).scalars().all()
    return [{
        "id": str(d.id),
        "vehicle_id": str(d.vehicle_id),
        "unit_number": units.get(d.vehicle_id, ""),
        "defect_type": d.defect_type,
        "comment": d.comment,
        "severity": d.severity,
        "status": d.status.value,
        "source": d.source,
        "reported_at": _iso(d.reported_at),
        "resolved_at": _iso(d.resolved_at),
        "booking_id": str(d.booking_id) if d.booking_id else None,
        "suggested_service_slug": suggest_service(d.defect_type),
    } for d in defects]


# ---------------------------------------------------------------- deadlines

def _date_deadline(kind: str, label: str, ref: str, href_id: uuid.UUID,
                   dt: datetime | None, now: datetime) -> dict | None:
    """Date-based deadline entry, or None when far out / no date on file."""
    dt = _aware(dt)
    if dt is None:
        return None  # missing dates live in each entity's warnings instead
    days_left = round((dt - now).days)
    if dt < now:
        st = "overdue"
    elif days_left <= 30:
        st = "due_soon"
    elif days_left <= 90:
        st = "upcoming"
    else:
        return None
    return {"kind": kind, "label": label, "ref": ref, "href_id": str(href_id),
            "status": st, "days_left": days_left, "miles_left": None}


@router.get("/deadlines")
def my_deadlines(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    now = utcnow()
    vehicles = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)
    ).scalars().all()
    trailers = db.execute(
        select(Trailer).where(Trailer.owner_user_id == user.id)
    ).scalars().all()
    drivers = db.execute(
        select(FleetDriver).where(FleetDriver.owner_user_id == user.id)
    ).scalars().all()
    units = {v.id: v.unit_number for v in vehicles}
    odometers = {v.id: v.odometer_miles for v in vehicles}

    out: list[dict] = []

    if vehicles:
        schedules = db.execute(select(MaintenanceSchedule).where(
            MaintenanceSchedule.vehicle_id.in_(units.keys()))).scalars().all()
        for s in schedules:
            st = schedule_status(s, odometers.get(s.vehicle_id))
            if st["status"] not in ("overdue", "due_soon"):
                continue
            out.append({
                "kind": "maintenance", "label": s.title,
                "ref": f"Unit {units.get(s.vehicle_id, '')}",
                "href_id": str(s.vehicle_id), "status": st["status"],
                "days_left": st["days_left"], "miles_left": st["miles_left"],
            })

    for v in vehicles:
        ref = f"Unit {v.unit_number}"
        for kind, label, dt in (
            ("vehicle_insurance", "Insurance", v.insurance_expires_at),
            ("vehicle_inspection", "Inspection", v.inspection_expires_at),
        ):
            entry = _date_deadline(kind, label, ref, v.id, dt, now)
            if entry:
                out.append(entry)

    if vehicles:
        from app.api.fleet_assets import DOC_KINDS
        docs = db.execute(select(VehicleDocument).where(
            VehicleDocument.vehicle_id.in_(units.keys()),
            VehicleDocument.expires_at.is_not(None),
        )).scalars().all()
        for doc in docs:
            label = doc.title or DOC_KINDS.get(doc.kind, doc.kind)
            entry = _date_deadline("vehicle_document", label,
                                   f"Unit {units.get(doc.vehicle_id, '')}",
                                   doc.vehicle_id, doc.expires_at, now)
            if entry:
                out.append(entry)

    for t in trailers:
        ref = f"Trailer {t.unit_number}"
        for kind, label, dt in (
            ("trailer_inspection", "Inspection", t.inspection_expires_at),
            ("trailer_registration", "Registration", t.registration_expires_at),
        ):
            entry = _date_deadline(kind, label, ref, t.id, dt, now)
            if entry:
                out.append(entry)

    for d in drivers:
        for kind, label, dt in (
            ("driver_cdl", "CDL", d.cdl_expires_at),
            ("driver_medical", "Medical card", d.medical_card_expires_at),
        ):
            entry = _date_deadline(kind, label, d.name, d.id, dt, now)
            if entry:
                out.append(entry)

    group = {"overdue": 0, "due_soon": 1, "upcoming": 2}

    def key(e: dict):
        left = e["days_left"] if e["days_left"] is not None else (
            e["miles_left"] if e["miles_left"] is not None else 0)
        return (group.get(e["status"], 3), left)

    out.sort(key=key)
    return out


# ------------------------------------------------------------ service records

LOGGED_SERVICE_CATEGORIES = (
    ExpenseCategory.REPAIR, ExpenseCategory.PARTS,
    ExpenseCategory.OIL_SERVICE, ExpenseCategory.TIRES,
)


def _collect_service_records(
    db: Session,
    user: User,
    vehicle_id: uuid.UUID | None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[dict]:
    units = _my_vehicles(db, user)
    records: list[dict] = []

    bq = select(Booking).where(Booking.driver_id == user.id,
                               Booking.status == BookingStatus.COMPLETED)
    if vehicle_id is not None:
        bq = bq.where(Booking.vehicle_id == vehicle_id)
    if date_from is not None:
        bq = bq.where(Booking.updated_at >= date_from)
    if date_to is not None:
        bq = bq.where(Booking.updated_at <= date_to)
    bookings = db.execute(bq).scalars().all()
    biz_ids = {b.business_id for b in bookings}
    biz_names: dict[uuid.UUID, str] = {}
    if biz_ids:
        rows = db.execute(select(Business.id, Business.name)
                          .where(Business.id.in_(biz_ids))).all()
        biz_names = {bid: name for bid, name in rows}
    for b in bookings:
        records.append({
            "date": _iso(b.updated_at),
            "vehicle_id": str(b.vehicle_id) if b.vehicle_id else None,
            "unit_number": units.get(b.vehicle_id) if b.vehicle_id else None,
            "kind": "marketplace",
            "description": b.issue_description,
            "category": None,
            "amount_cents": b.final_price_cents,
            "odometer_miles": None,
            "booking_id": str(b.id),
            "expense_id": None,
            "shop_name": biz_names.get(b.business_id),
        })

    if units:
        eq = select(VehicleExpense).where(
            VehicleExpense.vehicle_id.in_(units.keys()),
            VehicleExpense.category.in_(LOGGED_SERVICE_CATEGORIES),
            VehicleExpense.booking_id.is_(None),
        )
        if vehicle_id is not None:
            eq = eq.where(VehicleExpense.vehicle_id == vehicle_id)
        if date_from is not None:
            eq = eq.where(VehicleExpense.incurred_at >= date_from)
        if date_to is not None:
            eq = eq.where(VehicleExpense.incurred_at <= date_to)
        for e in db.execute(eq).scalars().all():
            records.append({
                "date": _iso(e.incurred_at),
                "vehicle_id": str(e.vehicle_id),
                "unit_number": units.get(e.vehicle_id),
                "kind": "logged",
                "description": e.description,
                "category": e.category.value,
                "amount_cents": e.amount_cents,
                "odometer_miles": e.odometer_miles,
                "booking_id": None,
                "expense_id": str(e.id),
                "shop_name": None,
            })

    records.sort(key=lambda r: r["date"] or "", reverse=True)
    return records


@router.get("/service-records")
def service_records(vehicle_id: uuid.UUID | None = Query(default=None),
                    user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    return _collect_service_records(db, user, vehicle_id)[:300]


@router.get("/service-records/export")
def service_records_export(
    format: str = Query(default="xlsx", pattern="^(xlsx|pdf)$"),
    vehicle_id: uuid.UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    booking_id: uuid.UUID | None = Query(default=None),
    expense_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(fleet_user),
    db: Session = Depends(get_db),
):
    """Download the service history as a spreadsheet or a PDF report."""
    from fastapi.responses import Response

    from app.services.service_export import records_to_pdf, records_to_xlsx

    # Make naive query params comparable with tz-aware columns.
    if date_from and date_from.tzinfo is None:
        date_from = date_from.replace(tzinfo=timezone.utc)
    if date_to and date_to.tzinfo is None:
        date_to = date_to.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)

    records = _collect_service_records(db, user, vehicle_id, date_from, date_to)
    # Single-record download ("receipt" for one line of the history).
    if booking_id is not None:
        records = [r for r in records if r.get("booking_id") == str(booking_id)]
    if expense_id is not None:
        records = [r for r in records if r.get("expense_id") == str(expense_id)]
    period = (
        f"{date_from.date().isoformat() if date_from else 'start'}"
        f"_{date_to.date().isoformat() if date_to else 'today'}"
    )
    unit = None
    if vehicle_id is not None:
        unit = _my_vehicles(db, user).get(vehicle_id)
    title_period = (
        f"{date_from.date().isoformat() if date_from else '...'} - "
        f"{date_to.date().isoformat() if date_to else 'today'}"
    )

    if format == "xlsx":
        data = records_to_xlsx(records, period=title_period, unit=unit)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ext = "xlsx"
    else:
        data = records_to_pdf(records, period=title_period, unit=unit)
        media = "application/pdf"
        ext = "pdf"
    filename = f"service-records_{period}.{ext}"
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ----------------------------------------------------------------- expenses

class FleetExpenseIn(BaseModel):
    vehicle_id: uuid.UUID
    category: ExpenseCategory = ExpenseCategory.OTHER
    description: str = Field(min_length=2, max_length=255)
    amount_cents: int = Field(ge=0, le=100_000_000)
    odometer_miles: float | None = Field(default=None, ge=0)
    incurred_at: datetime | None = None


def _month_start(months: list[str]) -> datetime:
    y, m = months[0].split("-")
    return datetime(int(y), int(m), 1, tzinfo=timezone.utc)


def _expense_out(e: VehicleExpense, units: dict) -> dict:
    return {
        "id": str(e.id),
        "vehicle_id": str(e.vehicle_id),
        "unit_number": units.get(e.vehicle_id),
        "category": e.category.value,
        "description": e.description,
        "amount_cents": e.amount_cents,
        "odometer_miles": e.odometer_miles,
        "incurred_at": _iso(e.incurred_at),
        "booking_id": str(e.booking_id) if e.booking_id else None,
    }


@router.get("/expenses")
def fleet_expenses(
    vehicle_id: uuid.UUID | None = Query(default=None),
    category: ExpenseCategory | None = Query(default=None),
    months: int = Query(default=6, ge=1, le=24),
    user: User = Depends(fleet_user),
    db: Session = Depends(get_db),
):
    units = _my_vehicles(db, user)
    month_keys = _last_months(utcnow(), months)
    window_start = _month_start(month_keys)

    expenses: list[VehicleExpense] = []
    if units:
        q = select(VehicleExpense).where(
            VehicleExpense.vehicle_id.in_(units.keys()),
            VehicleExpense.incurred_at >= window_start,
        )
        if vehicle_id is not None:
            q = q.where(VehicleExpense.vehicle_id == vehicle_id)
        if category is not None:
            q = q.where(VehicleExpense.category == category)
        expenses = db.execute(
            q.order_by(VehicleExpense.incurred_at.desc()).limit(500)
        ).scalars().all()

    total = 0
    by_category: dict[str, int] = {}
    monthly = {m: 0 for m in month_keys}
    for e in expenses:
        total += e.amount_cents
        by_category[e.category.value] = by_category.get(e.category.value, 0) + e.amount_cents
        key = _aware(e.incurred_at).strftime("%Y-%m")
        if key in monthly:
            monthly[key] += e.amount_cents

    return {
        "items": [_expense_out(e, units) for e in expenses],
        "total_cents": total,
        "totals_by_category": {c: t for c, t in by_category.items() if t > 0},
        "monthly": [{"month": m, "total_cents": monthly[m]} for m in month_keys],
    }


@router.post("/expenses", status_code=201)
def create_fleet_expense(body: FleetExpenseIn, user: User = Depends(fleet_user),
                         db: Session = Depends(get_db)):
    v = _own_vehicle(body.vehicle_id, user, db)
    data = body.model_dump(exclude_none=True)
    data.pop("vehicle_id")
    e = VehicleExpense(vehicle_id=v.id, created_by=user.id, **data)
    db.add(e)
    db.commit()
    return _expense_out(e, {v.id: v.unit_number})


# ----------------------------------------------------------------- insights

@router.get("/insights")
def fleet_insights(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    now = utcnow()
    period_start = now - timedelta(days=90)
    vehicles = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)
    ).scalars().all()
    vehicle_ids = [v.id for v in vehicles]
    expenses: list[VehicleExpense] = []
    if vehicle_ids:
        expenses = db.execute(select(VehicleExpense).where(
            VehicleExpense.vehicle_id.in_(vehicle_ids))).scalars().all()

    by_vehicle: dict[uuid.UUID, list[VehicleExpense]] = {v.id: [] for v in vehicles}
    for e in expenses:
        by_vehicle.setdefault(e.vehicle_id, []).append(e)

    per_truck = []
    for v in vehicles:
        rows = by_vehicle.get(v.id, [])
        total = sum(e.amount_cents for e in rows)
        period = sum(e.amount_cents for e in rows
                     if _aware(e.incurred_at) >= period_start)
        odos = [e.odometer_miles for e in rows if e.odometer_miles is not None]
        cpm = None
        if odos:
            span = max(odos) - min(odos)
            if span >= 500:
                cpm = round(total / span)
        per_truck.append({
            "vehicle_id": str(v.id),
            "unit_number": v.unit_number,
            "total_cents": total,
            "period_cents": period,
            "expenses_count": len(rows),
            "cost_per_mile_cents": cpm,
        })
    per_truck.sort(key=lambda r: -r["total_cents"])

    month_keys = _last_months(now, 6)
    monthly: dict[str, dict[str, int]] = {m: {} for m in month_keys}
    for e in expenses:
        key = _aware(e.incurred_at).strftime("%Y-%m")
        if key in monthly:
            cats = monthly[key]
            cats[e.category.value] = cats.get(e.category.value, 0) + e.amount_cents

    return {
        "per_truck": per_truck,
        "monthly_by_category": [
            {"month": m, "categories": monthly[m]} for m in month_keys
        ],
    }
