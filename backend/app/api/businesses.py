import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.config import get_settings
from app.db import get_db
from app.models import (
    AuditLog,
    Business,
    BusinessPhoto,
    BusinessService,
    Offer,
    OfferStatus,
    PartnerStatus,
    Review,
    ReviewStatus,
    Service,
    User,
    UserRole,
)
from app.schemas import (
    BusinessDetailOut,
    BusinessListItem,
    BusinessPhotoOut,
    BusinessServiceIn,
    BusinessUpdateIn,
    OfferPublicOut,
    ReviewOut,
    ServiceOut,
)
from app.security import get_current_user
from app.services.geo import SearchFilters, locate_area, search_businesses

router = APIRouter(prefix="/api", tags=["businesses"])


@router.get("/services", response_model=list[ServiceOut])
def list_services(db: Session = Depends(get_db)):
    return db.execute(select(Service).order_by(Service.name)).scalars().all()


@router.get("/stats/public")
def public_stats(db: Session = Depends(get_db)):
    """Honest marketplace numbers for the homepage. Savings are computed only
    from completed bookings against offers with a documented regular price;
    with no such bookings the figure is 0 and the UI hides it."""
    from sqlalchemy import func, text

    from app.models import Booking, BookingStatus

    businesses = db.execute(
        select(func.count(Business.id)).where(Business.is_published)
    ).scalar_one()
    partners = db.execute(
        select(func.count(Business.id)).where(
            Business.is_published, Business.partner_status == PartnerStatus.ACTIVE)
    ).scalar_one()
    states = db.execute(
        select(func.count(func.distinct(Business.state))).where(
            Business.is_published, Business.state.isnot(None))
    ).scalar_one()
    completed = db.execute(
        select(func.count(Booking.id)).where(Booking.status == BookingStatus.COMPLETED)
    ).scalar_one()
    savings = db.execute(text(
        "SELECT coalesce(sum(o.standard_price_cents - bk.final_price_cents), 0) "
        "FROM bookings bk JOIN offers o ON bk.offer_id = o.id "
        "WHERE bk.status = 'completed' AND bk.final_price_cents IS NOT NULL "
        "AND o.standard_price_cents IS NOT NULL "
        "AND o.standard_price_cents > bk.final_price_cents"
    )).scalar_one()
    return {
        "businesses": businesses,
        "partners": partners,
        "states": states,
        "completed_bookings": completed,
        "driver_savings_cents": int(savings),
    }


@router.get("/search")
def search(
    db: Session = Depends(get_db),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    location: str | None = Query(default=None, max_length=128,
                                 description="ZIP or 'City, ST' when no coordinates"),
    radius_miles: float = Query(default=50, ge=1, le=300),
    q: str | None = Query(default=None, max_length=128),
    category: str | None = None,
    state: str | None = Query(default=None, max_length=2),
    partner_only: bool = False,
    verified_only: bool = False,
    has_offer: bool = False,
    mobile_only: bool = False,
    emergency_only: bool = False,
    min_rating: float | None = Query(default=None, ge=1, le=5),
    open_now: bool = False,
    sort: str = Query(default="distance", pattern="^(distance|rating|price)$"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    resolved_from_location = None
    if (lat is None or lng is None) and location:
        point = locate_area(db, location)
        if point:
            lat, lng = point
            resolved_from_location = {"lat": lat, "lng": lng}
    filters = SearchFilters(
        lat=lat, lng=lng, radius_miles=radius_miles, q=q, category=category,
        state=state, partner_only=partner_only, verified_only=verified_only,
        has_offer=has_offer, mobile_only=mobile_only, emergency_only=emergency_only,
        min_rating=min_rating, open_now=open_now,
        sort=sort, limit=limit, offset=offset,
    )
    rows, total = search_businesses(db, filters)
    return {
        "total": total,
        "items": [BusinessListItem(**r) for r in rows],
        "resolved_location": resolved_from_location,
    }


def _active_offers(db: Session, business: Business) -> list[Offer]:
    if business.partner_status != PartnerStatus.ACTIVE:
        return []
    now = datetime.now(timezone.utc)
    return db.execute(
        select(Offer).where(
            Offer.business_id == business.id,
            Offer.status == OfferStatus.APPROVED,
            (Offer.starts_at.is_(None)) | (Offer.starts_at <= now),
            (Offer.expires_at.is_(None)) | (Offer.expires_at > now),
        )
    ).scalars().all()


@router.get("/businesses/{business_id}", response_model=BusinessDetailOut)
def business_detail(business_id: uuid.UUID, db: Session = Depends(get_db)):
    business = db.execute(
        select(Business)
        .options(joinedload(Business.services).joinedload(BusinessService.service))
        .where(Business.id == business_id, Business.is_published.is_(True))
    ).unique().scalar_one_or_none()
    if business is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business not found")
    out = BusinessDetailOut.model_validate(business)
    out.is_claimed = business.owner_user_id is not None
    out.is_verified = business.identity_verified_at is not None
    out.offers = [OfferPublicOut.model_validate(o) for o in _active_offers(db, business)]
    photos = db.execute(
        select(BusinessPhoto).where(BusinessPhoto.business_id == business.id)
        .order_by(BusinessPhoto.sort, BusinessPhoto.created_at)
    ).scalars().all()
    out.photos = [
        BusinessPhotoOut(id=p.id, path=f"/media/{p.filename}", caption=p.caption)
        for p in photos
    ]
    return out


@router.get("/businesses/{business_id}/reviews", response_model=list[ReviewOut])
def business_reviews(
    business_id: uuid.UUID,
    db: Session = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return db.execute(
        select(Review)
        .where(Review.business_id == business_id, Review.status == ReviewStatus.PUBLISHED)
        .order_by(Review.created_at.desc())
        .limit(limit).offset(offset)
    ).scalars().all()


def _owned_business(business_id: uuid.UUID, user: User, db: Session) -> Business:
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business not found")
    if business.owner_user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not manage this business")
    return business


@router.patch("/businesses/{business_id}", response_model=BusinessDetailOut)
def update_business(
    business_id: uuid.UUID,
    body: BusinessUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = _owned_business(business_id, user, db)
    changed = body.model_dump(exclude_unset=True)
    for field, value in changed.items():
        setattr(business, field, value)
    db.add(AuditLog(actor_id=user.id, action="business.update", entity_type="business",
                    entity_id=str(business.id), data={"fields": sorted(changed)}))
    db.commit()
    return business_detail(business_id, db)


# ------------------------------------------------------------------ photos

MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_PHOTOS = 8


def _sniff_image(head: bytes) -> str | None:
    """Return a safe extension from file magic bytes, or None if not an
    accepted image type. The client's filename/content-type are never trusted."""
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def media_dir() -> Path:
    d = Path(get_settings().media_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/businesses/{business_id}/photos", response_model=BusinessPhotoOut,
             status_code=201)
async def upload_photo(
    business_id: uuid.UUID,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business not found")
    if business.owner_user_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not manage this business")
    count = len(db.execute(
        select(BusinessPhoto.id).where(BusinessPhoto.business_id == business_id)
    ).scalars().all())
    if count >= MAX_PHOTOS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Maximum {MAX_PHOTOS} photos per business")
    data = await file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Photo exceeds 5 MB")
    ext = _sniff_image(data[:16])
    if ext is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Only JPEG, PNG or WebP images are accepted")
    filename = f"{secrets.token_hex(16)}.{ext}"
    (media_dir() / filename).write_bytes(data)
    photo = BusinessPhoto(business_id=business_id, filename=filename,
                          uploaded_by=user.id, sort=count)
    db.add(photo)
    db.add(AuditLog(actor_id=user.id, action="business.photo.upload",
                    entity_type="business", entity_id=str(business_id)))
    db.commit()
    return BusinessPhotoOut(id=photo.id, path=f"/media/{photo.filename}", caption=photo.caption)


@router.delete("/businesses/{business_id}/photos/{photo_id}", status_code=204)
def delete_photo(
    business_id: uuid.UUID,
    photo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    photo = db.get(BusinessPhoto, photo_id)
    if business is None or photo is None or photo.business_id != business_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    if business.owner_user_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not manage this business")
    try:
        (media_dir() / photo.filename).unlink(missing_ok=True)
    except OSError:
        pass  # DB row is removed regardless; orphan files are harmless
    db.delete(photo)
    db.add(AuditLog(actor_id=user.id, action="business.photo.delete",
                    entity_type="business", entity_id=str(business_id)))
    db.commit()


@router.put("/businesses/{business_id}/services", response_model=BusinessDetailOut)
def set_business_services(
    business_id: uuid.UUID,
    body: list[BusinessServiceIn],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = _owned_business(business_id, user, db)
    if len(body) > 50:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Too many services")
    valid_ids = set(db.execute(select(Service.id)).scalars())
    for item in body:
        if item.service_id not in valid_ids:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"Unknown service: {item.service_id}")
    existing = db.execute(
        select(BusinessService).where(BusinessService.business_id == business.id)
    ).scalars().all()
    for bs in existing:
        db.delete(bs)
    for item in body:
        db.add(BusinessService(
            business_id=business.id, service_id=item.service_id,
            standard_price_cents=item.standard_price_cents, price_note=item.price_note,
        ))
    db.add(AuditLog(actor_id=user.id, action="business.services.set", entity_type="business",
                    entity_id=str(business.id), data={"count": len(body)}))
    db.commit()
    return business_detail(business_id, db)
