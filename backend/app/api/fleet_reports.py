"""Fleet reports: pick a report, filter by truck/period, download XLSX/PDF.

Every number comes from data the carrier entered or the marketplace recorded —
nothing is estimated. format=json returns the same report for the preview UI.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.fleet import fleet_user
from app.api.fleet_finance import _my_loans, monthly_costs
from app.api.fleet_ops import _collect_service_records, my_deadlines
from app.db import get_db
from app.models import (
    FleetDriver,
    User,
    Vehicle,
    WorkOrder,
    WorkOrderStatus,
    utcnow,
)
from app.services.loans import amortization
from app.services.report_export import report_to_pdf, report_to_xlsx

router = APIRouter(prefix="/api/fleet/reports", tags=["fleet"])

PERIODS = {"ytd": "This year", "90": "Last 90 days", "30": "Last 30 days", "all": "All time"}

SERVICE_TYPE_LABELS = {
    "repair": "Repair", "pm": "PM", "inspection": "Inspection",
    "roadside": "Roadside service", "towing": "Towing", "parking": "Parking",
    "truck_wash": "Truck wash", "order_parts": "Order parts",
}

CATALOG = [
    {"key": "loan", "name": "Loan schedule",
     "desc": "Monthly payment, principal, interest and balance for each financed truck.",
     "filters": ["truck"]},
    {"key": "maint", "name": "Service records",
     "desc": "Every repair and service by truck, with shop and cost.",
     "filters": ["truck", "period"]},
    {"key": "workorders", "name": "Work orders",
     "desc": "Closed work orders by service type: shop, payment method, discount and final amount.",
     "filters": ["period", "service_type"]},
    {"key": "cost", "name": "Monthly fleet cost",
     "desc": "Repairs, truck loans and trailer leases, month by month.",
     "filters": []},
    {"key": "compliance", "name": "Deadlines & compliance",
     "desc": "Inspections, insurance, registrations, CDLs and medical cards due in the next 90 days.",
     "filters": []},
    {"key": "drivers", "name": "Driver summary",
     "desc": "Contact, assigned truck, CDL and medical card dates for every driver.",
     "filters": []},
]


def _period_start(period: str) -> datetime | None:
    now = utcnow()
    if period == "ytd":
        return datetime(now.year, 1, 1, tzinfo=timezone.utc)
    if period in ("90", "30"):
        return now - timedelta(days=int(period))
    return None


def _own_unit(db: Session, user: User, vehicle_id: uuid.UUID | None) -> Vehicle | None:
    if vehicle_id is None:
        return None
    v = db.get(Vehicle, vehicle_id)
    if v is None or v.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
    return v


def _col(h: str, t: str = "text", w: float = 1.0) -> dict:
    return {"h": h, "t": t, "w": w}


def _money(c: int | None) -> str:
    return f"${(c or 0) / 100:,.2f}"


# ---------------------------------------------------------------- builders

def build_loan(db: Session, user: User, one: Vehicle | None) -> dict:
    loans = _my_loans(db, user)
    if one is not None:
        loans = [(loan, v) for loan, v in loans if v.id == one.id]
    if not loans:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "No loans to report on" if one is None else "No loan on this truck")
    schedules = [(loan, v, amortization(loan)) for loan, v in loans]
    overview_rows = [
        [f"#{v.unit_number}", loan.lender, f"{loan.apr}%", a["payment_cents"],
         f"{a['paid_count']} of {loan.term_months}", a["remaining_cents"], a["payoff_date"]]
        for loan, v, a in schedules
    ]
    sections = [{
        "heading": "Loans overview",
        "columns": [_col("Truck", w=.6), _col("Lender", w=1.8), _col("APR", w=.5),
                    _col("Monthly", "money", .8), _col("Paid", w=.8),
                    _col("Balance", "money", .9), _col("Payoff", "date", .8)],
        "rows": overview_rows,
        "totals": ["Total", "", "", sum(r[3] for r in overview_rows), "",
                   sum(r[5] for r in overview_rows), ""],
    }]
    for loan, v, a in schedules:
        sections.append({
            "heading": f"Truck #{v.unit_number} - {loan.lender} "
                       f"({loan.apr}% APR, {loan.term_months} months from {loan.start_date.date().isoformat()})",
            "columns": [_col("#", "int", .4), _col("Due date", "date", .9),
                        _col("Payment", "money", .9), _col("Principal", "money", .9),
                        _col("Interest", "money", .9), _col("Balance", "money", 1.0),
                        _col("Status", w=.8)],
            "rows": [[r["i"], r["due"], r["payment_cents"], r["principal_cents"],
                      r["interest_cents"], r["balance_cents"],
                      "Paid" if r["paid"] else ("Due next" if r["due"] == a["next_due"] else "Upcoming")]
                     for r in a["rows"]],
            "totals": ["", "Total", sum(r["payment_cents"] for r in a["rows"]),
                       loan.principal_cents, a["interest_total_cents"], "", ""],
        })
    total_balance = sum(a["remaining_cents"] for _, _, a in schedules)
    total_monthly = sum(a["payment_cents"] for _, _, a in schedules)
    return {
        "title": "Loan schedule" + (f" - Truck #{one.unit_number}" if one else ""),
        "subtitle": f"{len(schedules)} financed truck{'s' if len(schedules) != 1 else ''}"
                    " - payments count as made once their due date passes",
        "summary": [["Trucks financed", str(len(schedules))],
                    ["Monthly payments", _money(total_monthly)],
                    ["Balance left", _money(total_balance)],
                    ["Total interest", _money(sum(a["interest_total_cents"] for _, _, a in schedules))]],
        "sections": sections,
    }


def build_maint(db: Session, user: User, one: Vehicle | None, period: str) -> dict:
    records = _collect_service_records(db, user, one.id if one else None,
                                       date_from=_period_start(period))
    rows = [[
        (r["date"] or "")[:10],
        f"#{r['unit_number']}" if r.get("unit_number") else "",
        "Marketplace" if r["kind"] == "marketplace" else (r.get("category") or "logged").replace("_", " "),
        r.get("description") or "",
        r.get("shop_name") or ("Logged manually" if r["kind"] == "logged" else ""),
        round(r["odometer_miles"]) if r.get("odometer_miles") is not None else "",
        r["amount_cents"] or 0,
    ] for r in records]
    total = sum(r[6] for r in rows)
    return {
        "title": "Service records" + (f" - Truck #{one.unit_number}" if one else ""),
        "subtitle": f"{'Truck #' + one.unit_number if one else 'All trucks'} - {PERIODS[period]}",
        "summary": [["Records", str(len(rows))], ["Total cost", _money(total)],
                    ["Trucks", str(len({r[1] for r in rows if r[1]}))],
                    ["Period", PERIODS[period]]],
        "sections": [{
            "heading": "Repairs and service",
            "columns": [_col("Date", "date", .8), _col("Truck", w=.55), _col("Type", w=.9),
                        _col("Description", w=2.2), _col("Where", w=1.6),
                        _col("Odometer (mi)", "int", .9), _col("Amount", "money", .8)],
            "rows": rows,
            "totals": ["Total", "", "", "", "", "", total],
        }],
    }


def build_workorders(db: Session, user: User, period: str,
                     service_type: str | None = None) -> dict:
    q = select(WorkOrder).where(WorkOrder.owner_user_id == user.id,
                                WorkOrder.status == WorkOrderStatus.CLOSED)
    start = _period_start(period)
    if start is not None:
        q = q.where(WorkOrder.closed_at >= start)
    if service_type:
        q = q.where(WorkOrder.service_type == service_type)
    orders = db.execute(q.order_by(WorkOrder.closed_at.desc())).scalars().all()
    units = {v.id: v.unit_number for v in db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)).scalars()}
    pay_labels = {"driver_paid": "Paid by Driver", "efs": "EFS", "comchek": "Comchek",
                  "zelle": "Zelle", "ach": "ACH"}
    # Column order follows the client's layout:
    # WO # | Closed | Truck | Shop | Service type | Description | Payment | Discount | Final | Notes
    TYPE, DISCOUNT, FINAL = 4, 7, 8
    rows = [[
        f"WO-{wo.wo_number}",
        wo.closed_at.date().isoformat() if wo.closed_at else "",
        f"#{units.get(wo.vehicle_id, '')}" if wo.vehicle_id else "",
        wo.shop_name or "",
        SERVICE_TYPE_LABELS.get(wo.service_type.value, wo.service_type.value),
        (wo.description or "")[:120],
        pay_labels.get(wo.payment_method.value if wo.payment_method else "", ""),
        wo.discount_cents or 0,
        wo.final_amount_cents or 0,
        (wo.closing_notes or "").strip(),
    ] for wo in orders]
    total = sum(r[FINAL] for r in rows)

    by_type: dict[str, list[int]] = {}
    for r in rows:
        agg = by_type.setdefault(r[TYPE], [0, 0])
        agg[0] += 1
        agg[1] += r[FINAL]
    type_rows = [[label, n, cents] for label, (n, cents) in
                 sorted(by_type.items(), key=lambda kv: -kv[1][1])]

    scope = SERVICE_TYPE_LABELS[service_type] if service_type else "All service types"
    sections = [{
        "heading": "Closed work orders",
        "columns": [_col("WO #", w=.55), _col("Closed", "date", .75), _col("Truck", w=.5),
                    _col("Shop", w=1.2), _col("Service type", w=.95),
                    _col("Description", w=1.6), _col("Payment", w=.75),
                    _col("Discount", "money", .7), _col("Final", "money", .7),
                    _col("Notes", w=1.4)],
        "rows": rows,
        "totals": ["Total", "", "", "", "", "", "", sum(r[DISCOUNT] for r in rows), total, ""],
    }]
    if not service_type and type_rows:
        sections.append({
            "heading": "By service type",
            "columns": [_col("Service type", w=1.4), _col("Orders", "int", .7),
                        _col("Total paid", "money", 1.0)],
            "rows": type_rows,
            "totals": ["Total", len(rows), total],
        })
    return {
        "title": "Work orders",
        "subtitle": f"Closed work orders - {scope} - {PERIODS[period]}",
        "summary": [["Closed orders", str(len(rows))], ["Total paid", _money(total)],
                    ["Discounts", _money(sum(r[7] for r in rows))],
                    ["Service type", scope]],
        "sections": sections,
    }


def build_cost(db: Session, user: User) -> dict:
    data = monthly_costs(user=user, db=db)
    rows = [[m["month"], m["repairs_cents"], m["loans_cents"], m["leases_cents"], m["total_cents"]]
            for m in data["months"]]
    return {
        "title": "Monthly fleet cost",
        "subtitle": "Last 6 months - loan and lease columns are current monthly commitments",
        "summary": [["6-month total", _money(sum(r[4] for r in rows))],
                    ["Fixed costs / month", _money(data["loan_monthly_cents"] + data["lease_monthly_cents"])],
                    ["Financed trucks", str(data["financed_trucks"])],
                    ["Leased trailers", str(data["leased_trailers"])]],
        "sections": [{
            "heading": "By month",
            "columns": [_col("Month", w=.9), _col("Repairs", "money"), _col("Truck loans", "money"),
                        _col("Trailer leases", "money"), _col("Total", "money")],
            "rows": rows,
            "totals": ["Total", sum(r[1] for r in rows), sum(r[2] for r in rows),
                       sum(r[3] for r in rows), sum(r[4] for r in rows)],
        }],
    }


def build_compliance(db: Session, user: User) -> dict:
    items = my_deadlines(user=user, db=db)
    status_label = {"overdue": "Overdue", "due_soon": "Due soon", "upcoming": "Upcoming"}
    rows = [[
        x["kind"].replace("_", " "),
        x["ref"],
        x["label"],
        x["days_left"] if x["days_left"] is not None else "",
        status_label.get(x["status"], x["status"]),
    ] for x in items]
    return {
        "title": "Deadlines & compliance",
        "subtitle": "Documents, inspections and renewals due in the next 90 days, plus anything overdue",
        "summary": [["Overdue", str(sum(1 for r in rows if r[4] == "Overdue"))],
                    ["Due in 30 days", str(sum(1 for r in rows if r[4] == "Due soon"))],
                    ["Upcoming", str(sum(1 for r in rows if r[4] == "Upcoming"))],
                    ["Items", str(len(rows))]],
        "sections": [{
            "heading": "Deadlines",
            "columns": [_col("Type", w=1.1), _col("Unit / driver", w=1.0), _col("Item", w=2.0),
                        _col("Days left", "int", .6), _col("Status", w=.7)],
            "rows": rows,
            "totals": None,
        }],
    }


def build_drivers(db: Session, user: User) -> dict:
    drivers = db.execute(
        select(FleetDriver).where(FleetDriver.owner_user_id == user.id)
        .order_by(FleetDriver.name)
    ).scalars().all()
    units = {v.id: v.unit_number for v in db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)).scalars()}
    rows = [[
        d.name, d.phone or "", f"#{units.get(d.assigned_vehicle_id, '')}" if d.assigned_vehicle_id else "",
        d.status, d.cdl_number or "",
        d.cdl_expires_at.date().isoformat() if d.cdl_expires_at else "",
        d.medical_card_expires_at.date().isoformat() if d.medical_card_expires_at else "",
        d.hired_at.date().isoformat() if d.hired_at else "",
    ] for d in drivers]
    now = utcnow()
    due = sum(1 for d in drivers for dt in (d.cdl_expires_at, d.medical_card_expires_at)
              if dt is not None and (dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt)
              <= now + timedelta(days=30))
    return {
        "title": "Driver summary",
        "subtitle": f"{len(rows)} drivers on the roster",
        "summary": [["Drivers", str(len(rows))],
                    ["Active", str(sum(1 for d in drivers if d.status == "active"))],
                    ["Docs due in 30 days", str(due)]],
        "sections": [{
            "heading": "Drivers",
            "columns": [_col("Driver", w=1.4), _col("Phone", w=1.0), _col("Truck", w=.55),
                        _col("Status", w=.7), _col("CDL #", w=1.0),
                        _col("CDL expires", "date", .9), _col("Medical expires", "date", .95),
                        _col("Hired", "date", .8)],
            "rows": rows,
            "totals": None,
        }],
    }


# ---------------------------------------------------------------- endpoints

@router.get("")
def report_catalog(user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    vehicles = db.execute(
        select(Vehicle).where(Vehicle.owner_user_id == user.id)
        .order_by(Vehicle.unit_number)
    ).scalars().all()
    financed = {loan.vehicle_id for loan, _ in _my_loans(db, user)}
    return {
        "reports": CATALOG,
        "periods": [{"key": k, "label": v} for k, v in PERIODS.items()],
        "service_types": [{"key": k, "label": v} for k, v in SERVICE_TYPE_LABELS.items()],
        "trucks": [{"vehicle_id": str(v.id), "unit_number": v.unit_number,
                    "financed": v.id in financed} for v in vehicles],
    }


@router.get("/{key}")
def get_report(key: str,
               format: str = Query(default="json", pattern="^(json|xlsx|pdf)$"),
               vehicle_id: uuid.UUID | None = Query(default=None),
               period: str = Query(default="ytd", pattern="^(ytd|90|30|all)$"),
               service_type: str | None = Query(
                   default=None,
                   pattern="^(repair|pm|inspection|roadside|towing|parking|truck_wash|order_parts)$"),
               user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    one = _own_unit(db, user, vehicle_id)
    if key == "loan":
        rep = build_loan(db, user, one)
    elif key == "maint":
        rep = build_maint(db, user, one, period)
    elif key == "workorders":
        rep = build_workorders(db, user, period, service_type)
    elif key == "cost":
        rep = build_cost(db, user)
    elif key == "compliance":
        rep = build_compliance(db, user)
    elif key == "drivers":
        rep = build_drivers(db, user)
    else:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown report")

    if format == "json":
        return rep
    stamp = utcnow().date().isoformat()
    safe_title = rep["title"].replace("&", "and").replace("#", "")
    if format == "xlsx":
        data = report_to_xlsx(rep)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        name = f"YourFleet {safe_title} {stamp}.xlsx"
    else:
        data = report_to_pdf(rep)
        media = "application/pdf"
        name = f"YourFleet {safe_title} {stamp}.pdf"
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
