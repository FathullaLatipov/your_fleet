"""Database models.

Design notes:
- Listing trust levels are modeled as separate, non-interchangeable facts:
  1. imported listing      -> business has source_records (provenance)
  2. claimed business      -> approved BusinessClaim sets Business.owner_user_id
  3. identity-verified     -> Business.identity_verified_at set by an admin
  4. active partner        -> Business.partner_status == ACTIVE
  5. partner with offer    -> partner + an APPROVED, unexpired Offer (derived at query time)
- Commercial amounts are integer cents; never floats.
- Commission terms are snapshotted onto the booking when it is confirmed, so later
  changes to platform settings never rewrite history.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    type_annotation_map = {dict: JSON().with_variant(JSONB(), "postgresql")}


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def str_enum(e: type[enum.Enum]) -> Enum:
    # Stored as VARCHAR with a check constraint: simpler migrations than native PG enums.
    return Enum(e, native_enum=False, length=32, values_callable=lambda x: [m.value for m in x])


# ---------------------------------------------------------------- users

class UserRole(str, enum.Enum):
    DRIVER = "driver"
    PROVIDER = "provider"
    FLEET_MANAGER = "fleet_manager"
    ADMIN = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[UserRole] = mapped_column(str_enum(UserRole), default=UserRole.DRIVER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------- businesses

class BusinessCategory(str, enum.Enum):
    TRUCK_TRAILER = "truck_trailer"
    PICKUP_AUTO = "pickup_auto"
    TIRE = "tire"
    TOWING = "towing"
    MOBILE_MECHANIC = "mobile_mechanic"
    OTHER = "other"


class PartnerStatus(str, enum.Enum):
    NONE = "none"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(String(255))
    normalized_name: Mapped[str] = mapped_column(String(255), index=True)
    category: Mapped[BusinessCategory] = mapped_column(
        str_enum(BusinessCategory), default=BusinessCategory.OTHER, index=True
    )
    address_raw: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(128), index=True)
    state: Mapped[str | None] = mapped_column(String(2), index=True)
    zip_code: Mapped[str | None] = mapped_column(String(10), index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    phone_normalized: Mapped[str | None] = mapped_column(String(16), index=True)
    website: Mapped[str | None] = mapped_column(String(512))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    description: Mapped[str | None] = mapped_column(Text)
    # hours: {"mon": [["07:00","19:00"]], ...}; None = unknown (never shown as "open now")
    hours: Mapped[dict | None] = mapped_column()
    is_mobile_service: Mapped[bool | None] = mapped_column(Boolean)  # None = unknown
    accepts_emergency: Mapped[bool | None] = mapped_column(Boolean)  # None = unknown

    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    identity_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    partner_status: Mapped[PartnerStatus] = mapped_column(
        str_enum(PartnerStatus), default=PartnerStatus.NONE, index=True
    )
    partner_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    rating_avg: Mapped[float | None] = mapped_column(Float)
    rating_count: Mapped[int] = mapped_column(Integer, default=0)

    # Third-party (Google) rating data. Populated only from licensed sources
    # (Places API with attribution, or a dataset that includes them) — never
    # scraped or invented. Null means "not available", and the UI says so.
    google_rating: Mapped[float | None] = mapped_column(Float)
    google_rating_count: Mapped[int | None] = mapped_column(Integer)
    google_place_url: Mapped[str | None] = mapped_column(String(512))
    # Place IDs may be stored indefinitely per Google's policy; rating data is
    # refreshed via `cli enrich-google --stale-days N` runs.
    google_place_id: Mapped[str | None] = mapped_column(String(128))
    # Google's own business type, e.g. "Tire shop", "Towing service" (licensed
    # Places data, refreshed together with the rating).
    google_primary_type: Mapped[str | None] = mapped_column(String(64))
    google_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    is_published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    services: Mapped[list[BusinessService]] = relationship(back_populates="business")

    __table_args__ = (
        CheckConstraint("lat >= -90 AND lat <= 90", name="ck_business_lat"),
        CheckConstraint("lng >= -180 AND lng <= 180", name="ck_business_lng"),
        Index("ix_businesses_lat_lng", "lat", "lng"),
    )


class Service(Base):
    """Catalog of service types (diesel engine, tires, towing, reefer, ...)."""

    __tablename__ = "services"

    id: Mapped[uuid.UUID] = pk()
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128))


class BusinessService(Base):
    __tablename__ = "business_services"

    id: Mapped[uuid.UUID] = pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    service_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("services.id"), index=True)
    # Documented standard price, if the provider has published one. None = quote-based.
    standard_price_cents: Mapped[int | None] = mapped_column(Integer)
    price_note: Mapped[str | None] = mapped_column(String(255))

    business: Mapped[Business] = relationship(back_populates="services")
    service: Mapped[Service] = relationship()

    __table_args__ = (UniqueConstraint("business_id", "service_id", name="uq_business_service"),)


class BusinessPhoto(Base):
    """Photos uploaded by the verified owner (or admins). Stored on disk under
    MEDIA_DIR with generated names; originals' filenames are never trusted."""

    __tablename__ = "business_photos"

    id: Mapped[uuid.UUID] = pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    filename: Mapped[str] = mapped_column(String(128), unique=True)
    caption: Mapped[str | None] = mapped_column(String(255))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ClaimStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class BusinessClaim(Base):
    __tablename__ = "business_claims"

    id: Mapped[uuid.UUID] = pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[ClaimStatus] = mapped_column(str_enum(ClaimStatus), default=ClaimStatus.PENDING)
    evidence: Mapped[str | None] = mapped_column(Text)  # how the claimant proves ownership
    contact_phone: Mapped[str | None] = mapped_column(String(32))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    review_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------- fleet / TMS

class VehicleStatus(str, enum.Enum):
    ACTIVE = "active"
    IN_REPAIR = "in_repair"
    INACTIVE = "inactive"


class Vehicle(Base):
    """A carrier's truck. Odometer/location come from manual entry or Samsara."""

    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = pk()
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    unit_number: Mapped[str] = mapped_column(String(32))
    name: Mapped[str | None] = mapped_column(String(128))
    vin: Mapped[str | None] = mapped_column(String(17), index=True)
    make: Mapped[str | None] = mapped_column(String(64))
    model: Mapped[str | None] = mapped_column(String(64))
    year: Mapped[int | None] = mapped_column(Integer)
    license_plate: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[VehicleStatus] = mapped_column(
        str_enum(VehicleStatus), default=VehicleStatus.ACTIVE
    )
    odometer_miles: Mapped[float | None] = mapped_column(Float)
    odometer_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    odometer_source: Mapped[str | None] = mapped_column(String(16))  # manual | samsara
    samsara_vehicle_id: Mapped[str | None] = mapped_column(String(64), index=True)
    last_lat: Mapped[float | None] = mapped_column(Float)
    last_lng: Mapped[float | None] = mapped_column(Float)
    last_location_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("owner_user_id", "unit_number", name="uq_vehicle_unit"),
    )


class MaintenanceSchedule(Base):
    """Recurring service plan (e.g. oil change every 15,000 mi or 6 months)."""

    __tablename__ = "maintenance_schedules"

    id: Mapped[uuid.UUID] = pk()
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"), index=True)
    title: Mapped[str] = mapped_column(String(128))
    service_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("services.id"))
    interval_miles: Mapped[int | None] = mapped_column(Integer)
    interval_months: Mapped[int | None] = mapped_column(Integer)
    last_done_miles: Mapped[float | None] = mapped_column(Float)
    last_done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when a due/overdue notification was sent; cleared when serviced.
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        CheckConstraint(
            "interval_miles IS NOT NULL OR interval_months IS NOT NULL",
            name="ck_schedule_has_interval",
        ),
    )


class ExpenseCategory(str, enum.Enum):
    REPAIR = "repair"
    PARTS = "parts"
    OIL_SERVICE = "oil_service"
    TIRES = "tires"
    FUEL = "fuel"
    TOLLS = "tolls"
    OTHER = "other"


class VehicleExpense(Base):
    """Monday.com-style per-truck cost ledger. Completed marketplace repairs
    are appended automatically; manual receipts can be added too."""

    __tablename__ = "vehicle_expenses"

    id: Mapped[uuid.UUID] = pk()
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"), index=True)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bookings.id"))
    business_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("businesses.id"))
    category: Mapped[ExpenseCategory] = mapped_column(
        str_enum(ExpenseCategory), default=ExpenseCategory.OTHER
    )
    description: Mapped[str] = mapped_column(String(255))
    amount_cents: Mapped[int] = mapped_column(Integer)
    odometer_miles: Mapped[float | None] = mapped_column(Float)
    incurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (CheckConstraint("amount_cents >= 0", name="ck_expense_amount"),)


class DefectStatus(str, enum.Enum):
    OPEN = "open"
    IN_REPAIR = "in_repair"
    RESOLVED = "resolved"


class InspectionDefect(Base):
    """PTI/DVIR defect: entered manually or pulled from Samsara DVIRs."""

    __tablename__ = "inspection_defects"

    id: Mapped[uuid.UUID] = pk()
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"), index=True)
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | samsara_dvir
    samsara_defect_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    defect_type: Mapped[str] = mapped_column(String(64))  # tires, brakes, lights, engine, ...
    comment: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[str | None] = mapped_column(String(16))  # minor | major
    status: Mapped[DefectStatus] = mapped_column(
        str_enum(DefectStatus), default=DefectStatus.OPEN, index=True
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bookings.id"))
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------- import provenance

class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[uuid.UUID] = pk()
    source_file: Mapped[str] = mapped_column(String(512))
    file_sha256: Mapped[str] = mapped_column(String(64))
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    report: Mapped[dict | None] = mapped_column()


class SourceAction(str, enum.Enum):
    CREATED = "created"
    UPDATED = "updated"
    SKIPPED = "skipped"
    DUPLICATE = "duplicate"
    INVALID = "invalid"


class SourceRecord(Base):
    """One placemark from a source file, with its mapping to a canonical business."""

    __tablename__ = "source_records"

    id: Mapped[uuid.UUID] = pk()
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batches.id"), index=True)
    # Stable identity of the source content; makes re-imports idempotent.
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    raw: Mapped[dict] = mapped_column()
    business_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("businesses.id"), index=True)
    action: Mapped[SourceAction] = mapped_column(str_enum(SourceAction))
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DuplicateStatus(str, enum.Enum):
    PENDING = "pending"
    MERGED = "merged"
    DISMISSED = "dismissed"


class DuplicateCandidate(Base):
    """Probable duplicates flagged for human review — never auto-merged."""

    __tablename__ = "duplicate_candidates"

    id: Mapped[uuid.UUID] = pk()
    business_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    business_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    reason: Mapped[str] = mapped_column(String(255))
    status: Mapped[DuplicateStatus] = mapped_column(
        str_enum(DuplicateStatus), default=DuplicateStatus.PENDING
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("business_a_id", "business_b_id", name="uq_duplicate_pair"),
    )


# ---------------------------------------------------------------- offers

class OfferType(str, enum.Enum):
    FIXED_AMOUNT = "fixed_amount"       # marketplace price for a service
    PERCENTAGE = "percentage"           # % off the documented standard price
    NEGOTIATED_RATE = "negotiated_rate" # e.g. negotiated hourly labor rate
    QUOTE_BASED = "quote_based"         # discount applied to an individual quote


class OfferStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    SUSPENDED = "suspended"
    EXPIRED = "expired"


class Offer(Base):
    __tablename__ = "offers"

    id: Mapped[uuid.UUID] = pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    service_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("services.id"))
    title: Mapped[str] = mapped_column(String(255))
    offer_type: Mapped[OfferType] = mapped_column(str_enum(OfferType))
    # Standard price must be documented by the provider to show a "savings" figure.
    standard_price_cents: Mapped[int | None] = mapped_column(Integer)
    marketplace_price_cents: Mapped[int | None] = mapped_column(Integer)
    discount_percent: Mapped[float | None] = mapped_column(Float)
    conditions: Mapped[str | None] = mapped_column(Text)
    min_charge_cents: Mapped[int | None] = mapped_column(Integer)
    exclusions: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[OfferStatus] = mapped_column(
        str_enum(OfferStatus), default=OfferStatus.DRAFT, index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    __table_args__ = (
        CheckConstraint(
            "discount_percent IS NULL OR (discount_percent > 0 AND discount_percent < 100)",
            name="ck_offer_discount_percent",
        ),
    )


class OfferEvent(Base):
    __tablename__ = "offer_events"

    id: Mapped[uuid.UUID] = pk()
    offer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offers.id"), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    event: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------- bookings

class BookingStatus(str, enum.Enum):
    REQUESTED = "requested"
    QUOTED = "quoted"
    ACCEPTED = "accepted"
    CONFIRMED = "confirmed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DISPUTED = "disputed"


class BookingUrgency(str, enum.Enum):
    SCHEDULED = "scheduled"
    EMERGENCY = "emergency"


class CommissionModel(str, enum.Enum):
    COMMISSION = "commission"
    LEAD_FEE = "lead_fee"
    NONE = "none"


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[uuid.UUID] = pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    offer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("offers.id"))
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vehicles.id"), index=True)
    status: Mapped[BookingStatus] = mapped_column(
        str_enum(BookingStatus), default=BookingStatus.REQUESTED, index=True
    )
    urgency: Mapped[BookingUrgency] = mapped_column(
        str_enum(BookingUrgency), default=BookingUrgency.SCHEDULED
    )
    issue_description: Mapped[str] = mapped_column(Text)
    truck_info: Mapped[dict | None] = mapped_column()  # {make, model, year, vin, unit}
    location_text: Mapped[str | None] = mapped_column(String(512))
    location_lat: Mapped[float | None] = mapped_column(Float)
    location_lng: Mapped[float | None] = mapped_column(Float)
    # Driver consents to sharing their contact/location with THIS provider.
    share_contact_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    preferred_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    quoted_price_cents: Mapped[int | None] = mapped_column(Integer)
    quote_note: Mapped[str | None] = mapped_column(Text)
    final_price_cents: Mapped[int | None] = mapped_column(Integer)

    # Commercial terms snapshotted at confirmation; never recomputed from live settings.
    commission_model: Mapped[CommissionModel | None] = mapped_column(str_enum(CommissionModel))
    commission_percent: Mapped[float | None] = mapped_column(Float)
    commission_amount_cents: Mapped[int | None] = mapped_column(Integer)
    provider_payout_cents: Mapped[int | None] = mapped_column(Integer)

    # Optimistic-concurrency token: every state change must carry the current version.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    __mapper_args__ = {"version_id_col": version}


class BookingEvent(Base):
    __tablename__ = "booking_events"

    id: Mapped[uuid.UUID] = pk()
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id"), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str | None] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------- reviews

class ReviewStatus(str, enum.Enum):
    PUBLISHED = "published"
    REPORTED = "reported"
    REMOVED = "removed"


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[uuid.UUID] = pk()
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id"), unique=True)
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ReviewStatus] = mapped_column(
        str_enum(ReviewStatus), default=ReviewStatus.PUBLISHED, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (CheckConstraint("rating >= 1 AND rating <= 5", name="ck_review_rating"),)


# ---------------------------------------------------------------- notifications / favorites / audit

class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column()
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FavoriteShop(Base):
    __tablename__ = "favorite_shops"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (UniqueConstraint("user_id", "business_id", name="uq_favorite"),)


class AuditLog(Base):
    """Audit trail for administrative and commercial actions."""

    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = pk()
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    data: Mapped[dict | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlatformSetting(Base):
    """Configurable platform settings (e.g. default commission terms)."""

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
