"""Platform-administrator endpoints. All require the admin role."""
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    AuditLog,
    Booking,
    BookingStatus,
    Business,
    BusinessClaim,
    ClaimStatus,
    DuplicateCandidate,
    DuplicateStatus,
    ImportBatch,
    Offer,
    OfferEvent,
    OfferStatus,
    PartnerStatus,
    PlatformSetting,
    Review,
    ReviewStatus,
    User,
    UserRole,
    utcnow,
)
from app.schemas import BookingOut, ClaimOut, DuplicateCandidateOut, OfferOut, ReviewOut
from app.security import require_roles
from app.services.notifications import notify

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)


def _admin(user: User = Depends(require_roles(UserRole.ADMIN))) -> User:
    return user


# ------------------------------------------------------------------ claims

@router.get("/claims", response_model=list[ClaimOut])
def pending_claims(db: Session = Depends(get_db)):
    return db.execute(
        select(BusinessClaim).where(BusinessClaim.status == ClaimStatus.PENDING)
        .order_by(BusinessClaim.created_at)
    ).scalars().all()


class ClaimDecision(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=2000)
    mark_identity_verified: bool = False


@router.post("/claims/{claim_id}/decide", response_model=ClaimOut)
def decide_claim(
    claim_id: uuid.UUID,
    body: ClaimDecision,
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
):
    claim = db.get(BusinessClaim, claim_id)
    if claim is None or claim.status != ClaimStatus.PENDING:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending claim not found")
    business = db.get(Business, claim.business_id)
    if body.approve:
        if business.owner_user_id is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Business already has an owner")
        claim.status = ClaimStatus.APPROVED
        business.owner_user_id = claim.user_id
        if body.mark_identity_verified:
            business.identity_verified_at = utcnow()
    else:
        claim.status = ClaimStatus.REJECTED
    claim.reviewed_by = admin.id
    claim.review_note = body.note
    claim.reviewed_at = utcnow()
    db.add(AuditLog(actor_id=admin.id, action="claim.decide", entity_type="business_claim",
                    entity_id=str(claim.id), data={"approve": body.approve}))
    notify(db, claim.user_id, "claim.decided",
           f"Your claim was {'approved' if body.approve else 'rejected'}",
           f"Business: {business.name}", {"business_id": str(business.id)},
           email=True,
           email_cta=("Manage your shop", "/provider") if body.approve
           else ("See details", "/provider"))
    db.commit()
    return claim


# ------------------------------------------------------------------ partner status

class PartnerStatusIn(BaseModel):
    partner_status: PartnerStatus


@router.post("/businesses/{business_id}/partner-status")
def set_partner_status(
    business_id: uuid.UUID,
    body: PartnerStatusIn,
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if business is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business not found")
    business.partner_status = body.partner_status
    if body.partner_status == PartnerStatus.ACTIVE and business.partner_since is None:
        business.partner_since = utcnow()
    db.add(AuditLog(actor_id=admin.id, action="business.partner_status",
                    entity_type="business", entity_id=str(business.id),
                    data={"status": body.partner_status.value}))
    db.commit()
    return {"id": str(business.id), "partner_status": business.partner_status.value}


# ------------------------------------------------------------------ offers

@router.get("/offers/pending", response_model=list[OfferOut])
def pending_offers(db: Session = Depends(get_db)):
    return db.execute(
        select(Offer).where(Offer.status == OfferStatus.PENDING_APPROVAL)
        .order_by(Offer.created_at)
    ).scalars().all()


class OfferDecision(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=2000)


@router.post("/offers/{offer_id}/decide", response_model=OfferOut)
def decide_offer(
    offer_id: uuid.UUID,
    body: OfferDecision,
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
):
    offer = db.get(Offer, offer_id)
    if offer is None or offer.status != OfferStatus.PENDING_APPROVAL:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending offer not found")
    offer.status = OfferStatus.APPROVED if body.approve else OfferStatus.SUSPENDED
    offer.approved_by = admin.id if body.approve else None
    db.add(OfferEvent(offer_id=offer.id, actor_id=admin.id,
                      event="approved" if body.approve else "rejected",
                      data={"note": body.note}))
    db.add(AuditLog(actor_id=admin.id, action="offer.decide", entity_type="offer",
                    entity_id=str(offer.id), data={"approve": body.approve}))
    db.commit()
    return offer


# ------------------------------------------------------------------ duplicates / imports

@router.get("/duplicates", response_model=list[DuplicateCandidateOut])
def duplicate_candidates(db: Session = Depends(get_db)):
    return db.execute(
        select(DuplicateCandidate)
        .where(DuplicateCandidate.status == DuplicateStatus.PENDING)
        .order_by(DuplicateCandidate.created_at).limit(200)
    ).scalars().all()


class DuplicateDecision(BaseModel):
    action: str = Field(pattern="^(dismiss|merge)$")


@router.post("/duplicates/{candidate_id}/decide", response_model=DuplicateCandidateOut)
def decide_duplicate(
    candidate_id: uuid.UUID,
    body: DuplicateDecision,
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
):
    cand = db.get(DuplicateCandidate, candidate_id)
    if cand is None or cand.status != DuplicateStatus.PENDING:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending candidate not found")
    if body.action == "dismiss":
        cand.status = DuplicateStatus.DISMISSED
    else:
        # Conservative merge: keep A published, unpublish B. Source records stay
        # attached to B for provenance; nothing is deleted.
        cand.status = DuplicateStatus.MERGED
        b = db.get(Business, cand.business_b_id)
        b.is_published = False
    db.add(AuditLog(actor_id=admin.id, action=f"duplicate.{body.action}",
                    entity_type="duplicate_candidate", entity_id=str(cand.id)))
    db.commit()
    return cand


@router.get("/imports")
def import_batches(db: Session = Depends(get_db)):
    batches = db.execute(
        select(ImportBatch).order_by(ImportBatch.started_at.desc()).limit(50)
    ).scalars().all()
    return [
        {"id": str(b.id), "source_file": b.source_file, "dry_run": b.dry_run,
         "started_at": b.started_at, "finished_at": b.finished_at, "report": b.report}
        for b in batches
    ]


# ------------------------------------------------------------------ moderation / disputes

@router.get("/reviews/reported", response_model=list[ReviewOut])
def reported_reviews(db: Session = Depends(get_db)):
    return db.execute(
        select(Review).where(Review.status == ReviewStatus.REPORTED)
        .order_by(Review.created_at)
    ).scalars().all()


class ReviewModeration(BaseModel):
    action: str = Field(pattern="^(restore|remove)$")


@router.post("/reviews/{review_id}/moderate", response_model=ReviewOut)
def moderate_review(
    review_id: uuid.UUID,
    body: ReviewModeration,
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
):
    from app.api.reviews import recompute_rating

    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    review.status = ReviewStatus.PUBLISHED if body.action == "restore" else ReviewStatus.REMOVED
    recompute_rating(db, db.get(Business, review.business_id))
    db.add(AuditLog(actor_id=admin.id, action=f"review.{body.action}",
                    entity_type="review", entity_id=str(review.id)))
    db.commit()
    return review


@router.get("/bookings/disputed", response_model=list[BookingOut])
def disputed_bookings(db: Session = Depends(get_db)):
    return db.execute(
        select(Booking).where(Booking.status == BookingStatus.DISPUTED)
        .order_by(Booking.updated_at)
    ).scalars().all()


# ------------------------------------------------------------------ settings / stats

class CommissionSettingIn(BaseModel):
    model: str = Field(pattern="^(commission|lead_fee|none)$")
    percent: float = Field(ge=0, le=50)


@router.get("/settings/commission")
def get_commission(db: Session = Depends(get_db)):
    from app.services.bookings import get_commission_terms
    return get_commission_terms(db)


@router.put("/settings/commission")
def set_commission(
    body: CommissionSettingIn,
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
):
    setting = db.get(PlatformSetting, "commission")
    value = {"model": body.model, "percent": body.percent}
    if setting is None:
        db.add(PlatformSetting(key="commission", value=value))
    else:
        setting.value = value
    db.add(AuditLog(actor_id=admin.id, action="settings.commission",
                    entity_type="platform_setting", entity_id="commission", data=value))
    db.commit()
    return value


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    def count(q):
        return db.execute(q).scalar_one()

    return {
        "businesses": count(select(func.count(Business.id))),
        "published": count(select(func.count(Business.id)).where(Business.is_published)),
        "claimed": count(select(func.count(Business.id)).where(Business.owner_user_id.isnot(None))),
        "partners": count(select(func.count(Business.id))
                          .where(Business.partner_status == PartnerStatus.ACTIVE)),
        "pending_claims": count(select(func.count(BusinessClaim.id))
                                .where(BusinessClaim.status == ClaimStatus.PENDING)),
        "pending_offers": count(select(func.count(Offer.id))
                                .where(Offer.status == OfferStatus.PENDING_APPROVAL)),
        "pending_duplicates": count(select(func.count(DuplicateCandidate.id))
                                    .where(DuplicateCandidate.status == DuplicateStatus.PENDING)),
        "bookings_total": count(select(func.count(Booking.id))),
        "bookings_disputed": count(select(func.count(Booking.id))
                                   .where(Booking.status == BookingStatus.DISPUTED)),
        "users": count(select(func.count(User.id))),
    }
