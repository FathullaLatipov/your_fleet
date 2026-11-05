"""Fleet finance: truck loans with derived amortization schedules, trailer
leases, and the monthly cost roll-up (repairs + loan payments + leases).

Owner-scoped like the rest of the fleet API. Money is integer cents.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.fleet import _last_months, _own_vehicle, fleet_user
from app.db import get_db
from app.models import (
    Booking,
    BookingStatus,
    Trailer,
    User,
    Vehicle,
    VehicleExpense,
    VehicleLoan,
    utcnow,
)
from app.services.loans import amortization

router = APIRouter(prefix="/api/fleet", tags=["fleet"])


def _my_loans(db: Session, user: User) -> list[tuple[VehicleLoan, Vehicle]]:
    rows = db.execute(
        select(VehicleLoan, Vehicle)
        .join(Vehicle, VehicleLoan.vehicle_id == Vehicle.id)
        .where(Vehicle.owner_user_id == user.id)
        .order_by(Vehicle.unit_number)
    ).all()
    return [(loan, v) for loan, v in rows]


def _loan_out(loan: VehicleLoan, v: Vehicle, schedule: bool = False) -> dict:
    a = amortization(loan)
    out = {
        "vehicle_id": str(v.id),
        "unit_number": v.unit_number,
        "truck": f"{v.year or ''} {v.make or ''} {v.model or ''}".strip(),
        "lender": loan.lender,
        "purchase_price_cents": loan.purchase_price_cents,
        "down_payment_cents": loan.down_payment_cents,
        "principal_cents": loan.principal_cents,
        "apr": loan.apr,
        "term_months": loan.term_months,
        "start_date": loan.start_date.date().isoformat(),
        "note": loan.note,
        "payment_cents": a["payment_cents"],
        "paid_count": a["paid_count"],
        "interest_total_cents": a["interest_total_cents"],
        "next_due": a["next_due"],
        "next_payment_cents": a["next_payment_cents"],
        "remaining_cents": a["remaining_cents"],
        "payoff_date": a["payoff_date"],
    }
    if schedule:
        out["schedule"] = a["rows"]
    return out


@router.get("/loans")
def list_loans(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    loans = _my_loans(db, user)
    items = [_loan_out(loan, v) for loan, v in loans]
    financed_ids = {loan.vehicle_id for loan, _ in loans}
    unfinanced = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)
        .order_by(Vehicle.unit_number)
    ).scalars().all()
    return {
        "loans": items,
        "totals": {
            "balance_cents": sum(x["remaining_cents"] for x in items),
            "monthly_cents": sum(x["payment_cents"] for x in items),
        },
        "unfinanced_units": [
            {"vehicle_id": str(v.id), "unit_number": v.unit_number}
            for v in unfinanced if v.id not in financed_ids
        ],
    }


@router.get("/vehicles/{vehicle_id}/loan")
def get_loan(vehicle_id: uuid.UUID, user: User = Depends(fleet_user),
             db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    loan = db.execute(
        select(VehicleLoan).where(VehicleLoan.vehicle_id == v.id)
    ).scalars().first()
    if loan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No loan on this truck")
    return _loan_out(loan, v, schedule=True)


class LoanIn(BaseModel):
    lender: str = Field(min_length=2, max_length=128)
    purchase_price_cents: int | None = Field(default=None, ge=0)
    down_payment_cents: int | None = Field(default=None, ge=0)
    principal_cents: int = Field(gt=0)
    apr: float = Field(ge=0, le=100)
    term_months: int = Field(ge=1, le=600)
    start_date: datetime
    note: str | None = Field(default=None, max_length=2000)


@router.put("/vehicles/{vehicle_id}/loan")
def upsert_loan(vehicle_id: uuid.UUID, body: LoanIn,
                user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    start = body.start_date
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    loan = db.execute(
        select(VehicleLoan).where(VehicleLoan.vehicle_id == v.id)
    ).scalars().first()
    if loan is None:
        loan = VehicleLoan(vehicle_id=v.id, lender=body.lender.strip(),
                           principal_cents=body.principal_cents, apr=body.apr,
                           term_months=body.term_months, start_date=start)
        db.add(loan)
    loan.lender = body.lender.strip()
    loan.purchase_price_cents = body.purchase_price_cents
    loan.down_payment_cents = body.down_payment_cents
    loan.principal_cents = body.principal_cents
    loan.apr = body.apr
    loan.term_months = body.term_months
    loan.start_date = start
    loan.note = body.note
    db.commit()
    return _loan_out(loan, v, schedule=True)


@router.delete("/vehicles/{vehicle_id}/loan", status_code=204)
def delete_loan(vehicle_id: uuid.UUID, user: User = Depends(fleet_user),
                db: Session = Depends(get_db)):
    v = _own_vehicle(vehicle_id, user, db)
    loan = db.execute(
        select(VehicleLoan).where(VehicleLoan.vehicle_id == v.id)
    ).scalars().first()
    if loan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No loan on this truck")
    db.delete(loan)
    db.commit()


# ---------------------------------------------------------------- monthly costs

def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/finance/monthly")
def monthly_costs(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    """Last 6 months: repair/service spend, loan payments and trailer leases.

    Loan and lease figures are the CURRENT monthly commitments applied to each
    month shown (no payment history is stored), and the UI labels them so.
    """
    now = utcnow()
    months = _last_months(now, 6)
    repairs = {m: 0 for m in months}

    my_vehicles = {
        vid for (vid,) in db.execute(
            select(Vehicle.id).where(Vehicle.owner_user_id == user.id)
        ).all()
    }
    for e in db.execute(select(VehicleExpense)).scalars():
        if e.vehicle_id not in my_vehicles:
            continue
        m = _aware(e.incurred_at).strftime("%Y-%m")
        if m in repairs:
            repairs[m] += e.amount_cents
    # Marketplace repairs that were completed but never logged as an expense
    # are already mirrored into vehicle_expenses on completion, so bookings
    # are only counted when no expense row exists (avoid double counting).
    booked = db.execute(
        select(Booking).where(Booking.driver_id == user.id,
                              Booking.status == BookingStatus.COMPLETED)
    ).scalars().all()
    expensed_bookings = {
        b for (b,) in db.execute(
            select(VehicleExpense.booking_id).where(VehicleExpense.booking_id.is_not(None))
        ).all()
    }
    for b in booked:
        if b.id in expensed_bookings or b.final_price_cents is None:
            continue
        m = _aware(b.updated_at).strftime("%Y-%m")
        if m in repairs:
            repairs[m] += b.final_price_cents

    loans = _my_loans(db, user)
    loan_monthly = sum(amortization(loan)["payment_cents"] for loan, _ in loans)
    leases = db.execute(
        select(Trailer).where(Trailer.owner_user_id == user.id,
                              Trailer.lease_cents_monthly.is_not(None))
    ).scalars().all()
    lease_monthly = sum(t.lease_cents_monthly or 0 for t in leases)

    return {
        "months": [{
            "month": m,
            "repairs_cents": repairs[m],
            "loans_cents": loan_monthly,
            "leases_cents": lease_monthly,
            "total_cents": repairs[m] + loan_monthly + lease_monthly,
        } for m in months],
        "loan_monthly_cents": loan_monthly,
        "lease_monthly_cents": lease_monthly,
        "financed_trucks": len(loans),
        "leased_trailers": len(leases),
    }
