"""Pydantic request/response schemas."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from app.models import (
    BookingStatus,
    BookingUrgency,
    BusinessCategory,
    ClaimStatus,
    DefectStatus,
    DuplicateStatus,
    ExpenseCategory,
    OfferStatus,
    OfferType,
    PartnerStatus,
    ReviewStatus,
    UserRole,
    VehicleStatus,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ auth

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    role: UserRole = UserRole.DRIVER

    @field_validator("role")
    @classmethod
    def no_self_service_admin(cls, v: UserRole) -> UserRole:
        if v == UserRole.ADMIN:
            raise ValueError("Cannot self-register as admin")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(ORMModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    phone: str | None
    role: UserRole
    created_at: datetime


# ------------------------------------------------------------------ businesses

class ServiceOut(ORMModel):
    id: uuid.UUID
    slug: str
    name: str


class BusinessServiceOut(ORMModel):
    id: uuid.UUID
    service: ServiceOut
    standard_price_cents: int | None
    price_note: str | None


class OfferPublicOut(ORMModel):
    id: uuid.UUID
    title: str
    offer_type: OfferType
    standard_price_cents: int | None
    marketplace_price_cents: int | None
    discount_percent: float | None
    conditions: str | None
    min_charge_cents: int | None
    exclusions: str | None
    starts_at: datetime | None
    expires_at: datetime | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def savings_cents(self) -> int | None:
        """Savings are shown only when BOTH prices are documented."""
        if self.standard_price_cents and self.marketplace_price_cents:
            return self.standard_price_cents - self.marketplace_price_cents
        return None


class BusinessPhotoOut(ORMModel):
    id: uuid.UUID
    path: str = ""
    caption: str | None = None


class BusinessListItem(ORMModel):
    id: uuid.UUID
    name: str
    category: BusinessCategory
    city: str | None
    state: str | None
    phone: str | None
    lat: float
    lng: float
    rating_avg: float | None
    rating_count: int
    partner_status: PartnerStatus
    is_claimed: bool = False
    is_verified: bool = False
    has_active_offer: bool = False
    is_mobile_service: bool | None = None
    accepts_emergency: bool | None = None
    price_from_cents: int | None = None
    service_price_cents: int | None = None
    photo_path: str | None = None
    hours: dict | None = None
    google_rating: float | None = None
    google_rating_count: int | None = None
    google_primary_type: str | None = None
    distance_miles: float | None = None


class BusinessDetailOut(ORMModel):
    id: uuid.UUID
    name: str
    category: BusinessCategory
    address_raw: str | None
    city: str | None
    state: str | None
    zip_code: str | None
    phone: str | None
    website: str | None
    lat: float
    lng: float
    description: str | None
    hours: dict | None
    is_mobile_service: bool | None
    accepts_emergency: bool | None
    partner_status: PartnerStatus
    rating_avg: float | None
    rating_count: int
    google_rating: float | None = None
    google_rating_count: int | None = None
    google_place_url: str | None = None
    google_primary_type: str | None = None
    is_claimed: bool = False
    is_verified: bool = False
    services: list[BusinessServiceOut] = []
    offers: list[OfferPublicOut] = []
    photos: list[BusinessPhotoOut] = []


class BusinessUpdateIn(BaseModel):
    """Fields a verified owner may edit."""
    phone: str | None = Field(default=None, max_length=32)
    website: str | None = Field(default=None, max_length=512)
    description: str | None = Field(default=None, max_length=5000)
    hours: dict[str, list[list[str]]] | None = None
    is_mobile_service: bool | None = None
    accepts_emergency: bool | None = None

    @field_validator("hours")
    @classmethod
    def validate_hours(cls, v):
        if v is None:
            return v
        valid_days = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
        for day, ranges in v.items():
            if day not in valid_days:
                raise ValueError(f"Invalid day key: {day}")
            for r in ranges:
                if len(r) != 2:
                    raise ValueError("Each range must be [open, close]")
                for t in r:
                    h, _, m = t.partition(":")
                    if not (h.isdigit() and m.isdigit() and 0 <= int(h) <= 23 and 0 <= int(m) <= 59):
                        raise ValueError(f"Invalid time: {t}")
        return v


class BusinessServiceIn(BaseModel):
    service_id: uuid.UUID
    standard_price_cents: int | None = Field(default=None, ge=0, le=100_000_000)
    price_note: str | None = Field(default=None, max_length=255)


# ------------------------------------------------------------------ claims

class ClaimIn(BaseModel):
    business_id: uuid.UUID
    evidence: str = Field(min_length=10, max_length=5000)
    contact_phone: str | None = Field(default=None, max_length=32)


class ClaimOut(ORMModel):
    id: uuid.UUID
    business_id: uuid.UUID
    user_id: uuid.UUID
    status: ClaimStatus
    evidence: str | None
    review_note: str | None
    created_at: datetime
    reviewed_at: datetime | None


# ------------------------------------------------------------------ offers

class OfferIn(BaseModel):
    business_id: uuid.UUID
    service_id: uuid.UUID | None = None
    title: str = Field(min_length=3, max_length=255)
    offer_type: OfferType
    standard_price_cents: int | None = Field(default=None, ge=0, le=100_000_000)
    marketplace_price_cents: int | None = Field(default=None, ge=0, le=100_000_000)
    discount_percent: float | None = Field(default=None, gt=0, lt=100)
    conditions: str | None = Field(default=None, max_length=5000)
    min_charge_cents: int | None = Field(default=None, ge=0)
    exclusions: str | None = Field(default=None, max_length=5000)
    starts_at: datetime | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_pricing(self):
        if self.offer_type == OfferType.FIXED_AMOUNT and self.marketplace_price_cents is None:
            raise ValueError("fixed_amount offers require marketplace_price_cents")
        if self.offer_type == OfferType.PERCENTAGE and self.discount_percent is None:
            raise ValueError("percentage offers require discount_percent")
        if (
            self.standard_price_cents is not None
            and self.marketplace_price_cents is not None
            and self.marketplace_price_cents >= self.standard_price_cents
        ):
            raise ValueError("marketplace price must be below the documented standard price")
        if self.starts_at and self.expires_at and self.expires_at <= self.starts_at:
            raise ValueError("expires_at must be after starts_at")
        return self


class OfferOut(OfferPublicOut):
    business_id: uuid.UUID
    status: OfferStatus
    created_at: datetime


# ------------------------------------------------------------------ bookings

class BookingIn(BaseModel):
    business_id: uuid.UUID
    offer_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID | None = None
    defect_id: uuid.UUID | None = None
    issue_description: str = Field(min_length=10, max_length=5000)
    urgency: BookingUrgency = BookingUrgency.SCHEDULED
    truck_info: dict | None = None
    location_text: str | None = Field(default=None, max_length=512)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    preferred_time: datetime | None = None
    share_contact_consent: bool = False

    @field_validator("truck_info")
    @classmethod
    def limit_truck_info(cls, v):
        if v is not None and len(str(v)) > 2000:
            raise ValueError("truck_info too large")
        return v


class BookingTransitionIn(BaseModel):
    to_status: BookingStatus
    version: int = Field(ge=1, description="Current booking version (optimistic concurrency)")
    note: str | None = Field(default=None, max_length=2000)
    quoted_price_cents: int | None = Field(default=None, ge=0, le=100_000_000)
    final_price_cents: int | None = Field(default=None, ge=0, le=100_000_000)


class BookingOut(ORMModel):
    id: uuid.UUID
    business_id: uuid.UUID
    driver_id: uuid.UUID
    offer_id: uuid.UUID | None
    status: BookingStatus
    urgency: BookingUrgency
    issue_description: str
    truck_info: dict | None
    location_text: str | None
    preferred_time: datetime | None
    quoted_price_cents: int | None
    quote_note: str | None
    final_price_cents: int | None
    commission_amount_cents: int | None
    provider_payout_cents: int | None
    version: int
    created_at: datetime
    updated_at: datetime


class BookingEventOut(ORMModel):
    id: uuid.UUID
    from_status: str | None
    to_status: str | None
    note: str | None
    created_at: datetime


# ------------------------------------------------------------------ reviews

class ReviewIn(BaseModel):
    booking_id: uuid.UUID
    rating: int = Field(ge=1, le=5)
    text: str | None = Field(default=None, max_length=5000)


class ReviewOut(ORMModel):
    id: uuid.UUID
    business_id: uuid.UUID
    rating: int
    text: str | None
    status: ReviewStatus
    created_at: datetime


# ------------------------------------------------------------------ fleet / TMS

class VehicleIn(BaseModel):
    unit_number: str = Field(min_length=1, max_length=32)
    name: str | None = Field(default=None, max_length=128)
    vin: str | None = Field(default=None, min_length=11, max_length=17)
    make: str | None = Field(default=None, max_length=64)
    model: str | None = Field(default=None, max_length=64)
    year: int | None = Field(default=None, ge=1950, le=2050)
    license_plate: str | None = Field(default=None, max_length=16)
    odometer_miles: float | None = Field(default=None, ge=0, le=5_000_000)

    @field_validator("vin")
    @classmethod
    def clean_vin(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else None


class VehicleUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    make: str | None = Field(default=None, max_length=64)
    model: str | None = Field(default=None, max_length=64)
    year: int | None = Field(default=None, ge=1950, le=2050)
    license_plate: str | None = Field(default=None, max_length=16)
    status: VehicleStatus | None = None


class OdometerIn(BaseModel):
    odometer_miles: float = Field(ge=0, le=5_000_000)


class VehicleOut(ORMModel):
    id: uuid.UUID
    unit_number: str
    name: str | None
    vin: str | None
    make: str | None
    model: str | None
    year: int | None
    license_plate: str | None
    status: VehicleStatus
    odometer_miles: float | None
    odometer_updated_at: datetime | None
    odometer_source: str | None
    samsara_vehicle_id: str | None
    last_lat: float | None
    last_lng: float | None
    last_location_at: datetime | None
    created_at: datetime
    # aggregates filled by the router
    maintenance_status: str = "unknown"
    open_defects: int = 0
    expenses_total_cents: int = 0


class ScheduleIn(BaseModel):
    title: str = Field(min_length=2, max_length=128)
    service_id: uuid.UUID | None = None
    interval_miles: int | None = Field(default=None, ge=100, le=1_000_000)
    interval_months: int | None = Field(default=None, ge=1, le=120)
    last_done_miles: float | None = Field(default=None, ge=0)
    last_done_at: datetime | None = None

    @model_validator(mode="after")
    def needs_interval(self):
        if self.interval_miles is None and self.interval_months is None:
            raise ValueError("Set interval_miles, interval_months, or both")
        return self


class ScheduleDoneIn(BaseModel):
    done_miles: float | None = Field(default=None, ge=0)
    done_at: datetime | None = None


class ScheduleOut(ORMModel):
    id: uuid.UUID
    title: str
    service_id: uuid.UUID | None
    interval_miles: int | None
    interval_months: int | None
    last_done_miles: float | None
    last_done_at: datetime | None
    status: str = "unknown"
    miles_left: float | None = None
    days_left: float | None = None


class ExpenseIn(BaseModel):
    category: ExpenseCategory = ExpenseCategory.OTHER
    description: str = Field(min_length=2, max_length=255)
    amount_cents: int = Field(ge=0, le=100_000_000)
    odometer_miles: float | None = Field(default=None, ge=0)
    incurred_at: datetime | None = None
    business_id: uuid.UUID | None = None


class ExpenseOut(ORMModel):
    id: uuid.UUID
    category: ExpenseCategory
    description: str
    amount_cents: int
    odometer_miles: float | None
    incurred_at: datetime
    booking_id: uuid.UUID | None
    business_id: uuid.UUID | None


class DefectIn(BaseModel):
    defect_type: str = Field(min_length=2, max_length=64)
    comment: str | None = Field(default=None, max_length=5000)
    severity: str | None = Field(default=None, pattern="^(minor|major)$")


class DefectOut(ORMModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    source: str
    defect_type: str
    comment: str | None
    severity: str | None
    status: DefectStatus
    booking_id: uuid.UUID | None
    reported_at: datetime
    resolved_at: datetime | None
    suggested_service_slug: str | None = None


class VehicleDetailOut(BaseModel):
    vehicle: VehicleOut
    schedules: list[ScheduleOut]
    expenses: list[ExpenseOut]
    expenses_by_category: dict[str, int]
    defects: list[DefectOut]
    bookings: list["BookingOut"]


# ------------------------------------------------------------------ notifications / misc

class NotificationOut(ORMModel):
    id: uuid.UUID
    type: str
    title: str
    body: str | None
    data: dict | None
    read_at: datetime | None
    created_at: datetime


class DuplicateCandidateOut(ORMModel):
    id: uuid.UUID
    business_a_id: uuid.UUID
    business_b_id: uuid.UUID
    reason: str
    status: DuplicateStatus
    created_at: datetime


class Paginated(BaseModel):
    total: int
    items: list
