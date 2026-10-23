from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Business, Review, ReviewStatus, User, UserRole
from app.rate_limit import rate_limit
from app.schemas import ReviewIn, ReviewOut
from app.security import require_roles
from app.services.bookings import review_eligible

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def recompute_rating(db: Session, business: Business) -> None:
    avg, count = db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(
            Review.business_id == business.id,
            Review.status == ReviewStatus.PUBLISHED,
        )
    ).one()
    business.rating_avg = round(float(avg), 2) if avg is not None else None
    business.rating_count = count


@router.post("", response_model=ReviewOut, status_code=201)
def create_review(
    body: ReviewIn,
    request: Request,
    user: User = Depends(require_roles(UserRole.DRIVER, UserRole.FLEET_MANAGER)),
    db: Session = Depends(get_db),
):
    rate_limit(request, "reviews", limit=10, window_s=3600)
    booking = review_eligible(db, body.booking_id, user.id)
    if booking is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Reviews are only allowed for your own completed bookings",
        )
    existing = db.execute(
        select(Review).where(Review.booking_id == body.booking_id)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "This booking is already reviewed")
    review = Review(
        booking_id=body.booking_id, business_id=booking.business_id,
        driver_id=user.id, rating=body.rating, text=body.text,
    )
    db.add(review)
    business = db.get(Business, booking.business_id)
    db.flush()
    recompute_rating(db, business)
    db.commit()
    return review


@router.post("/{review_id}/report", status_code=204)
def report_review(review_id: str, user: User = Depends(require_roles(
        UserRole.DRIVER, UserRole.PROVIDER, UserRole.FLEET_MANAGER)),
        db: Session = Depends(get_db)):
    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    if review.status == ReviewStatus.PUBLISHED:
        review.status = ReviewStatus.REPORTED
        db.commit()
