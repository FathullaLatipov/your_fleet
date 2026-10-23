from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AuditLog, Business, BusinessClaim, ClaimStatus, User, UserRole
from app.rate_limit import rate_limit
from app.schemas import ClaimIn, ClaimOut
from app.security import get_current_user, require_roles
from app.services.notifications import notify

router = APIRouter(prefix="/api/claims", tags=["claims"])


@router.post("", response_model=ClaimOut, status_code=201)
def submit_claim(
    body: ClaimIn,
    request: Request,
    user: User = Depends(require_roles(UserRole.PROVIDER)),
    db: Session = Depends(get_db),
):
    rate_limit(request, "claims", limit=10, window_s=3600)
    business = db.get(Business, body.business_id)
    if business is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business not found")
    if business.owner_user_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Business is already claimed")
    open_claim = db.execute(
        select(BusinessClaim).where(
            BusinessClaim.business_id == body.business_id,
            BusinessClaim.user_id == user.id,
            BusinessClaim.status == ClaimStatus.PENDING,
        )
    ).scalar_one_or_none()
    if open_claim:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a pending claim")
    claim = BusinessClaim(
        business_id=body.business_id, user_id=user.id,
        evidence=body.evidence, contact_phone=body.contact_phone,
    )
    db.add(claim)
    db.add(AuditLog(actor_id=user.id, action="claim.submit", entity_type="business_claim",
                    entity_id=str(business.id)))
    db.commit()
    return claim


@router.get("/mine", response_model=list[ClaimOut])
def my_claims(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.execute(
        select(BusinessClaim).where(BusinessClaim.user_id == user.id)
        .order_by(BusinessClaim.created_at.desc())
    ).scalars().all()
