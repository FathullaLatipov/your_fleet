import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Business, Offer, OfferEvent, OfferStatus, User, UserRole
from app.schemas import OfferIn, OfferOut
from app.security import require_roles

router = APIRouter(prefix="/api/offers", tags=["offers"])


def _owned_business(business_id: uuid.UUID, user: User, db: Session) -> Business:
    business = db.get(Business, business_id)
    if business is None or business.owner_user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not manage this business")
    return business


@router.post("", response_model=OfferOut, status_code=201)
def create_offer(
    body: OfferIn,
    user: User = Depends(require_roles(UserRole.PROVIDER)),
    db: Session = Depends(get_db),
):
    _owned_business(body.business_id, user, db)
    offer = Offer(
        **body.model_dump(),
        status=OfferStatus.PENDING_APPROVAL,
        created_by=user.id,
    )
    db.add(offer)
    db.flush()
    db.add(OfferEvent(offer_id=offer.id, actor_id=user.id, event="submitted",
                      data={"title": offer.title}))
    db.commit()
    return offer


@router.get("/business/{business_id}", response_model=list[OfferOut])
def offers_for_business(
    business_id: uuid.UUID,
    user: User = Depends(require_roles(UserRole.PROVIDER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    if user.role != UserRole.ADMIN:
        _owned_business(business_id, user, db)
    return db.execute(
        select(Offer).where(Offer.business_id == business_id).order_by(Offer.created_at.desc())
    ).scalars().all()


@router.post("/{offer_id}/suspend", response_model=OfferOut)
def suspend_own_offer(
    offer_id: uuid.UUID,
    user: User = Depends(require_roles(UserRole.PROVIDER)),
    db: Session = Depends(get_db),
):
    offer = db.get(Offer, offer_id)
    if offer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    _owned_business(offer.business_id, user, db)
    offer.status = OfferStatus.SUSPENDED
    db.add(OfferEvent(offer_id=offer.id, actor_id=user.id, event="suspended_by_provider"))
    db.commit()
    return offer
