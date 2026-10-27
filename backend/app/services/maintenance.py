"""Maintenance-schedule due logic and notifications.

A schedule is OVERDUE when the mileage or time interval has elapsed since it
was last done; DUE SOON within 500 miles / 14 days. When a schedule becomes
due, the owner gets one in-app notification (re-armed when the service is
logged as done).
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MaintenanceSchedule, Vehicle, utcnow
from app.services.notifications import notify

DUE_SOON_MILES = 500.0
DUE_SOON_DAYS = 14
DAYS_PER_MONTH = 30.44


def schedule_status(s: MaintenanceSchedule, odometer_miles: float | None) -> dict:
    """Compute due state. Unknown inputs (no odometer, never done) are treated
    conservatively: a schedule with no 'last done' baseline is reported as due
    so the owner records a baseline."""
    miles_left: float | None = None
    days_left: float | None = None

    if s.interval_miles is not None:
        if s.last_done_miles is None or odometer_miles is None:
            miles_left = None if odometer_miles is None else 0.0
        else:
            miles_left = (s.last_done_miles + s.interval_miles) - odometer_miles
    if s.interval_months is not None:
        if s.last_done_at is None:
            days_left = 0.0
        else:
            due_at = s.last_done_at + timedelta(days=s.interval_months * DAYS_PER_MONTH)
            days_left = (due_at - utcnow()).total_seconds() / 86400

    candidates = [v for v in (miles_left, days_left) if v is not None]
    if not candidates:
        status = "unknown"
    elif min(candidates) <= 0:
        status = "overdue"
    elif (miles_left is not None and miles_left <= DUE_SOON_MILES) or (
        days_left is not None and days_left <= DUE_SOON_DAYS
    ):
        status = "due_soon"
    else:
        status = "ok"
    return {
        "status": status,
        "miles_left": round(miles_left, 1) if miles_left is not None else None,
        "days_left": round(days_left, 1) if days_left is not None else None,
    }


def check_vehicle_maintenance(db: Session, vehicle: Vehicle) -> int:
    """Notify the owner about newly due schedules. Returns notifications sent."""
    sent = 0
    schedules = db.execute(
        select(MaintenanceSchedule).where(MaintenanceSchedule.vehicle_id == vehicle.id)
    ).scalars().all()
    for s in schedules:
        st = schedule_status(s, vehicle.odometer_miles)
        if st["status"] in ("due_soon", "overdue"):
            if s.notified_at is None:
                detail = []
                if st["miles_left"] is not None:
                    detail.append(f"{int(st['miles_left'])} mi left")
                if st["days_left"] is not None:
                    detail.append(f"{int(st['days_left'])} days left")
                notify(
                    db, vehicle.owner_user_id, "maintenance.due",
                    f"{s.title} {'overdue' if st['status'] == 'overdue' else 'due soon'} — "
                    f"unit {vehicle.unit_number}",
                    ", ".join(detail) or None,
                    {"vehicle_id": str(vehicle.id), "schedule_id": str(s.id)},
                    email=True,
                    email_cta=("Open the truck", f"/fleet/{vehicle.id}"),
                )
                s.notified_at = utcnow()
                sent += 1
        else:
            s.notified_at = None  # re-arm after the service was done
    return sent
