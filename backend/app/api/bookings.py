import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Booking,
    BookingEvent,
    BookingStatus,
    Business,
    Offer,
    OfferStatus,
    User,
    UserRole,
    utcnow,
)
from app.rate_limit import rate_limit
from app.schemas import BookingEventOut, BookingIn, BookingOut, BookingTransitionIn
from app.security import get_current_user, require_roles
from app.services.bookings import ConflictError, TransitionError, actor_kind, transition
from app.services.notifications import notify

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.post("", response_model=BookingOut, status_code=201)
def create_booking(
    body: BookingIn,
    request: Request,
    user: User = Depends(require_roles(UserRole.DRIVER, UserRole.FLEET_MANAGER)),
    db: Session = Depends(get_db),
):
    rate_limit(request, "bookings", limit=20, window_s=3600)
    business = db.get(Business, body.business_id)
    if business is None or not business.is_published:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business not found")
    if body.offer_id is not None:
        offer = db.get(Offer, body.offer_id)
        if (
            offer is None
            or offer.business_id != business.id
            or offer.status != OfferStatus.APPROVED
            or (offer.expires_at is not None and offer.expires_at <= utcnow())
        ):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Offer is not active for this business")

    # Prevent accidental duplicate submissions: identical open request within 10 min.
    recent = db.execute(
        select(Booking).where(
            Booking.driver_id == user.id,
            Booking.business_id == business.id,
            Booking.status == BookingStatus.REQUESTED,
            Booking.created_at > utcnow() - timedelta(minutes=10),
        )
    ).scalars().all()
    if any(b.issue_description == body.issue_description for b in recent):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "An identical request was just submitted")

    booking = Booking(driver_id=user.id, **body.model_dump())
    db.add(booking)
    db.flush()
    db.add(BookingEvent(booking_id=booking.id, actor_id=user.id,
                        from_status=None, to_status=BookingStatus.REQUESTED.value))
    if business.owner_user_id:
        notify(db, business.owner_user_id, "booking.requested",
               "New repair request",
               f"{'EMERGENCY — ' if body.urgency.value == 'emergency' else ''}"
               f"New request for {business.name}",
               {"booking_id": str(booking.id)})
    db.commit()
    return booking


@router.get("/mine", response_model=list[BookingOut])
def my_bookings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.execute(
        select(Booking).where(Booking.driver_id == user.id).order_by(Booking.created_at.desc())
    ).scalars().all()


@router.get("/business/{business_id}", response_model=list[BookingOut])
def business_bookings(
    business_id: uuid.UUID,
    user: User = Depends(require_roles(UserRole.PROVIDER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business not found")
    if user.role != UserRole.ADMIN and business.owner_user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not manage this business")
    return db.execute(
        select(Booking).where(Booking.business_id == business_id)
        .order_by(Booking.created_at.desc())
    ).scalars().all()


def _party_booking(booking_id: uuid.UUID, user: User, db: Session) -> Booking:
    booking = db.get(Booking, booking_id)
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    business = db.get(Business, booking.business_id)
    if actor_kind(user, booking, business) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a party to this booking")
    return booking


@router.get("/{booking_id}", response_model=BookingOut)
def booking_detail(
    booking_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _party_booking(booking_id, user, db)


@router.get("/{booking_id}/events", response_model=list[BookingEventOut])
def booking_events(
    booking_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _party_booking(booking_id, user, db)
    return db.execute(
        select(BookingEvent).where(BookingEvent.booking_id == booking_id)
        .order_by(BookingEvent.created_at)
    ).scalars().all()


@router.post("/{booking_id}/transition", response_model=BookingOut)
def transition_booking(
    booking_id: uuid.UUID,
    body: BookingTransitionIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.get(Booking, booking_id)
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    try:
        transition(
            db, booking, user, body.to_status,
            expected_version=body.version, note=body.note,
            quoted_price_cents=body.quoted_price_cents,
            final_price_cents=body.final_price_cents,
        )
        db.commit()
    except TransitionError as e:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    except ConflictError as e:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    db.refresh(booking)
    return booking
