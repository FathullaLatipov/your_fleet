"""Booking state machine, concurrency control, and commission snapshotting.

Every transition is validated server-side against (current status, target
status, actor role). Writes require the caller to present the booking's
current version; a stale version raises ConflictError (handled as HTTP 409).
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.models import (
    AuditLog,
    Booking,
    BookingEvent,
    BookingStatus,
    Business,
    CommissionModel,
    PlatformSetting,
    User,
    UserRole,
    utcnow,
)
from app.services.notifications import notify

S = BookingStatus


class TransitionError(Exception):
    """Invalid transition or insufficient permissions."""


class ConflictError(Exception):
    """Concurrent update detected (version mismatch)."""


# (from, to) -> set of actor kinds allowed to perform it.
# "driver" = the booking's driver; "provider" = owner of the booked business.
TRANSITIONS: dict[tuple[S, S], set[str]] = {
    (S.REQUESTED, S.QUOTED): {"provider"},
    (S.REQUESTED, S.ACCEPTED): {"provider"},
    (S.REQUESTED, S.CANCELLED): {"driver", "provider", "admin"},
    (S.QUOTED, S.QUOTED): {"provider"},          # provider revises the quote
    (S.QUOTED, S.CONFIRMED): {"driver"},         # driver accepts the quote
    (S.QUOTED, S.CANCELLED): {"driver", "provider", "admin"},
    (S.ACCEPTED, S.CONFIRMED): {"driver"},
    (S.ACCEPTED, S.CANCELLED): {"driver", "provider", "admin"},
    (S.CONFIRMED, S.IN_PROGRESS): {"provider"},
    (S.CONFIRMED, S.CANCELLED): {"driver", "provider", "admin"},
    (S.IN_PROGRESS, S.COMPLETED): {"provider"},
    (S.IN_PROGRESS, S.DISPUTED): {"driver", "provider"},
    (S.COMPLETED, S.DISPUTED): {"driver"},
    (S.DISPUTED, S.COMPLETED): {"admin"},
    (S.DISPUTED, S.CANCELLED): {"admin"},
}

DEFAULT_COMMISSION = {"model": "commission", "percent": 10.0}


def actor_kind(user: User, booking: Booking, business: Business) -> str | None:
    if user.role == UserRole.ADMIN:
        return "admin"
    if booking.driver_id == user.id:
        return "driver"
    if business.owner_user_id == user.id:
        return "provider"
    return None


def get_commission_terms(db: Session) -> dict:
    setting = db.get(PlatformSetting, "commission")
    return setting.value if setting else dict(DEFAULT_COMMISSION)


def transition(
    db: Session,
    booking: Booking,
    actor: User,
    to_status: S,
    *,
    expected_version: int,
    note: str | None = None,
    quoted_price_cents: int | None = None,
    final_price_cents: int | None = None,
) -> Booking:
    business = db.get(Business, booking.business_id)
    kind = actor_kind(actor, booking, business)
    if kind is None:
        raise TransitionError("You are not a party to this booking")

    from_status = booking.status
    allowed = TRANSITIONS.get((from_status, to_status))
    if allowed is None or kind not in allowed:
        raise TransitionError(
            f"Transition {from_status.value} -> {to_status.value} not allowed for {kind}"
        )
    if booking.version != expected_version:
        raise ConflictError("Booking was modified concurrently; reload and retry")

    if to_status == S.QUOTED:
        if quoted_price_cents is None:
            raise TransitionError("A quote requires quoted_price_cents")
        booking.quoted_price_cents = quoted_price_cents
        booking.quote_note = note

    if to_status == S.CONFIRMED:
        # Snapshot the commercial terms in force right now.
        terms = get_commission_terms(db)
        booking.commission_model = CommissionModel(terms.get("model", "commission"))
        booking.commission_percent = float(terms.get("percent", 0.0))

    if to_status == S.COMPLETED and kind != "admin":
        if final_price_cents is None:
            raise TransitionError("Completion requires final_price_cents")
        booking.final_price_cents = final_price_cents
        _apply_commission(booking)
    elif to_status == S.COMPLETED and booking.final_price_cents is not None:
        _apply_commission(booking)  # admin resolving a dispute

    booking.status = to_status
    _sync_fleet_side_effects(db, booking, actor, from_status, to_status)
    db.add(BookingEvent(
        booking_id=booking.id, actor_id=actor.id,
        from_status=from_status.value, to_status=to_status.value, note=note,
        data={"quoted_price_cents": quoted_price_cents,
              "final_price_cents": final_price_cents},
    ))
    db.add(AuditLog(
        actor_id=actor.id, action=f"booking.{to_status.value}",
        entity_type="booking", entity_id=str(booking.id),
    ))
    _notify_parties(db, booking, business, kind, from_status, to_status)

    try:
        db.flush()
    except StaleDataError:
        raise ConflictError("Booking was modified concurrently; reload and retry")
    return booking


def _sync_fleet_side_effects(db, booking, actor, from_status, to_status) -> None:
    """Keep the TMS in sync: vehicle status, defect lifecycle, auto-expense."""
    from app.models import (
        DefectStatus,
        ExpenseCategory,
        InspectionDefect,
        Vehicle,
        VehicleExpense,
        VehicleStatus,
    )
    from sqlalchemy import select

    if booking.vehicle_id is None:
        return
    vehicle = db.get(Vehicle, booking.vehicle_id)
    if vehicle is None:
        return
    if to_status == S.IN_PROGRESS:
        vehicle.status = VehicleStatus.IN_REPAIR
    elif to_status in (S.COMPLETED, S.CANCELLED) and vehicle.status == VehicleStatus.IN_REPAIR:
        vehicle.status = VehicleStatus.ACTIVE

    defect = db.execute(
        select(InspectionDefect).where(InspectionDefect.booking_id == booking.id)
    ).scalar_one_or_none()
    if defect is not None:
        if to_status == S.COMPLETED:
            defect.status = DefectStatus.RESOLVED
            defect.resolved_at = utcnow()
        elif to_status == S.CANCELLED and defect.status == DefectStatus.IN_REPAIR:
            defect.status = DefectStatus.OPEN

    if to_status == S.COMPLETED and booking.final_price_cents is not None:
        already = db.execute(
            select(VehicleExpense).where(VehicleExpense.booking_id == booking.id)
        ).scalar_one_or_none()
        if already is None:
            db.add(VehicleExpense(
                vehicle_id=vehicle.id, booking_id=booking.id,
                business_id=booking.business_id,
                category=ExpenseCategory.REPAIR,
                description=booking.issue_description[:255],
                amount_cents=booking.final_price_cents,
                odometer_miles=vehicle.odometer_miles,
                created_by=actor.id,
            ))


def _apply_commission(booking: Booking) -> None:
    """Commission is computed only from terms snapshotted on the booking."""
    if booking.final_price_cents is None:
        return
    if booking.commission_model == CommissionModel.COMMISSION and booking.commission_percent:
        booking.commission_amount_cents = round(
            booking.final_price_cents * booking.commission_percent / 100
        )
    else:
        booking.commission_amount_cents = 0
    booking.provider_payout_cents = booking.final_price_cents - booking.commission_amount_cents


_STATUS_LABEL = {
    S.QUOTED: "You received a quote",
    S.ACCEPTED: "Your request was accepted",
    S.CONFIRMED: "Booking confirmed",
    S.IN_PROGRESS: "Repair in progress",
    S.COMPLETED: "Repair completed",
    S.CANCELLED: "Booking cancelled",
    S.DISPUTED: "Booking disputed",
}


def _notify_parties(db, booking, business, actor_kind_, from_status, to_status):
    title = _STATUS_LABEL.get(to_status, f"Booking {to_status.value}")
    data = {"booking_id": str(booking.id), "business_id": str(business.id)}
    if actor_kind_ != "driver":
        notify(db, booking.driver_id, f"booking.{to_status.value}", title,
               f"{business.name}: {from_status.value} -> {to_status.value}", data)
    if actor_kind_ != "provider" and business.owner_user_id:
        notify(db, business.owner_user_id, f"booking.{to_status.value}", title,
               f"Booking {str(booking.id)[:8]}: {from_status.value} -> {to_status.value}", data)


def review_eligible(db: Session, booking_id: uuid.UUID, driver_id: uuid.UUID) -> Booking | None:
    """A review is allowed only for the driver's own COMPLETED booking."""
    booking = db.execute(
        select(Booking).where(
            Booking.id == booking_id,
            Booking.driver_id == driver_id,
            Booking.status == S.COMPLETED,
        )
    ).scalar_one_or_none()
    return booking
