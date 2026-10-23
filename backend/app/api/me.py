"""Endpoints for the signed-in user's own data: notifications, favorites,
and the businesses they manage."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Business, FavoriteShop, Notification, User, utcnow
from app.schemas import BusinessListItem, NotificationOut
from app.security import get_current_user

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.execute(
        select(Notification).where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc()).limit(50)
    ).scalars().all()


@router.post("/notifications/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    if n.read_at is None:
        n.read_at = utcnow()
        db.commit()


@router.get("/favorites", response_model=list[BusinessListItem])
def favorites(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Business).join(FavoriteShop, FavoriteShop.business_id == Business.id)
        .where(FavoriteShop.user_id == user.id)
    ).scalars().all()
    return [
        BusinessListItem.model_validate(b, update={
            "is_claimed": b.owner_user_id is not None,
            "is_verified": b.identity_verified_at is not None,
        })
        for b in rows
    ]


@router.put("/favorites/{business_id}", status_code=204)
def add_favorite(
    business_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.get(Business, business_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business not found")
    existing = db.execute(
        select(FavoriteShop).where(
            FavoriteShop.user_id == user.id, FavoriteShop.business_id == business_id)
    ).scalar_one_or_none()
    if existing is None:
        db.add(FavoriteShop(user_id=user.id, business_id=business_id))
        db.commit()


@router.delete("/favorites/{business_id}", status_code=204)
def remove_favorite(
    business_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = db.execute(
        select(FavoriteShop).where(
            FavoriteShop.user_id == user.id, FavoriteShop.business_id == business_id)
    ).scalar_one_or_none()
    if existing is not None:
        db.delete(existing)
        db.commit()


@router.get("/businesses", response_model=list[BusinessListItem])
def my_businesses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Business).where(Business.owner_user_id == user.id)).scalars().all()
    return [
        BusinessListItem.model_validate(b, update={
            "is_claimed": True,
            "is_verified": b.identity_verified_at is not None,
        })
        for b in rows
    ]
