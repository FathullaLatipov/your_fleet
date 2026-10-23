"""API tests: auth, RBAC, search, offers, bookings, commissions, reviews."""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.db as app_db
from app.main import app
from app.models import (
    Booking, BookingStatus, Business, BusinessCategory, Offer, OfferStatus,
    PartnerStatus, PlatformSetting, User, UserRole, utcnow,
)
from app.security import hash_password


@pytest.fixture
def client(db, engine, monkeypatch):
    # Route the app's sessions to the test database/session factory.
    from sqlalchemy.orm import sessionmaker

    from app.rate_limit import _hits
    _hits.clear()  # the in-memory limiter is keyed by IP and shared across tests
    TestSession = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_db():
        s = TestSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[app_db.get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def make_business(db, name="Test Truck Repair", lat=32.78, lng=-96.80, **kw):
    b = Business(name=name, normalized_name=name.lower(),
                 category=BusinessCategory.TRUCK_TRAILER, lat=lat, lng=lng, **kw)
    db.add(b)
    db.commit()
    return b


def make_user(db, email, role=UserRole.DRIVER, password="password123"):
    u = User(email=email, password_hash=hash_password(password),
             full_name="Test User", role=role)
    db.add(u)
    db.commit()
    return u


def login(client, email, password="password123"):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class TestAuth:
    def test_register_login_me(self, client):
        r = client.post("/api/auth/register", json={
            "email": "d1@example.com", "password": "password123",
            "full_name": "Driver One", "role": "driver"})
        assert r.status_code == 201
        h = login(client, "d1@example.com")
        assert client.get("/api/auth/me", headers=h).json()["email"] == "d1@example.com"

    def test_cannot_register_admin(self, client):
        r = client.post("/api/auth/register", json={
            "email": "evil@example.com", "password": "password123",
            "full_name": "X", "role": "admin"})
        assert r.status_code == 422

    def test_wrong_password_rejected(self, client, db):
        make_user(db, "d2@example.com")
        r = client.post("/api/auth/login",
                        json={"email": "d2@example.com", "password": "wrongwrong"})
        assert r.status_code == 401

    def test_protected_route_requires_token(self, client):
        assert client.get("/api/auth/me").status_code == 401


class TestRBAC:
    def test_driver_cannot_access_admin(self, client, db):
        make_user(db, "d3@example.com")
        h = login(client, "d3@example.com")
        assert client.get("/api/admin/stats", headers=h).status_code == 403

    def test_admin_can_access_admin(self, client, db):
        make_user(db, "a1@example.com", role=UserRole.ADMIN)
        h = login(client, "a1@example.com")
        assert client.get("/api/admin/stats", headers=h).status_code == 200

    def test_non_owner_cannot_edit_business(self, client, db):
        b = make_business(db)
        make_user(db, "p1@example.com", role=UserRole.PROVIDER)
        h = login(client, "p1@example.com")
        r = client.patch(f"/api/businesses/{b.id}", headers=h, json={"description": "hi"})
        assert r.status_code == 403


class TestSearch:
    def test_distance_ordering(self, client, db):
        make_business(db, "Near Shop", lat=32.78, lng=-96.80)
        make_business(db, "Far Shop", lat=33.30, lng=-96.80)  # ~36 mi north
        r = client.get("/api/search", params={"lat": 32.78, "lng": -96.80,
                                              "radius_miles": 100})
        items = r.json()["items"]
        assert [i["name"] for i in items] == ["Near Shop", "Far Shop"]
        assert items[0]["distance_miles"] < items[1]["distance_miles"]

    def test_radius_excludes_far(self, client, db):
        make_business(db, "Near Shop", lat=32.78, lng=-96.80)
        make_business(db, "Far Shop", lat=35.00, lng=-96.80)
        r = client.get("/api/search", params={"lat": 32.78, "lng": -96.80,
                                              "radius_miles": 30})
        assert [i["name"] for i in r.json()["items"]] == ["Near Shop"]

    def test_unpublished_hidden(self, client, db):
        make_business(db, "Hidden Shop", is_published=False)
        r = client.get("/api/search", params={"q": "Hidden"})
        assert r.json()["total"] == 0

    def test_min_reviews_combines_yourfleet_and_google(self, client, db):
        make_business(db, "Few Reviews", google_rating=5.0, google_rating_count=3)
        make_business(db, "Many Reviews", google_rating=4.8, google_rating_count=900)
        r = client.get("/api/search", params={"min_reviews": 25, "sort": "rating"})
        assert [i["name"] for i in r.json()["items"]] == ["Many Reviews"]

    def test_partner_filter(self, client, db):
        make_business(db, "Partner Shop", partner_status=PartnerStatus.ACTIVE)
        make_business(db, "Plain Shop")
        r = client.get("/api/search", params={"partner_only": True})
        assert [i["name"] for i in r.json()["items"]] == ["Partner Shop"]


class TestOffers:
    def _provider_with_business(self, client, db):
        p = make_user(db, "prov@example.com", role=UserRole.PROVIDER)
        b = make_business(db, owner_user_id=p.id, partner_status=PartnerStatus.ACTIVE)
        return p, b, login(client, "prov@example.com")

    def test_offer_requires_price_below_standard(self, client, db):
        _, b, h = self._provider_with_business(client, db)
        r = client.post("/api/offers", headers=h, json={
            "business_id": str(b.id), "title": "Brake job special",
            "offer_type": "fixed_amount",
            "standard_price_cents": 100000, "marketplace_price_cents": 120000})
        assert r.status_code == 422

    def test_offer_lifecycle_and_public_visibility(self, client, db):
        _, b, h = self._provider_with_business(client, db)
        r = client.post("/api/offers", headers=h, json={
            "business_id": str(b.id), "title": "PM service deal",
            "offer_type": "fixed_amount",
            "standard_price_cents": 50000, "marketplace_price_cents": 40000})
        assert r.status_code == 201
        offer_id = r.json()["id"]
        # Not public before approval
        detail = client.get(f"/api/businesses/{b.id}").json()
        assert detail["offers"] == []
        # Admin approves
        make_user(db, "a2@example.com", role=UserRole.ADMIN)
        ha = login(client, "a2@example.com")
        assert client.post(f"/api/admin/offers/{offer_id}/decide", headers=ha,
                           json={"approve": True}).status_code == 200
        offers = client.get(f"/api/businesses/{b.id}").json()["offers"]
        assert len(offers) == 1 and offers[0]["savings_cents"] == 10000

    def test_approved_offer_hidden_if_not_partner(self, client, db):
        p = make_user(db, "prov2@example.com", role=UserRole.PROVIDER)
        b = make_business(db, "NonPartner", owner_user_id=p.id)  # partner_status=none
        o = Offer(business_id=b.id, title="X", offer_type="fixed_amount",
                  marketplace_price_cents=1000, status=OfferStatus.APPROVED,
                  created_by=p.id)
        db.add(o)
        db.commit()
        assert client.get(f"/api/businesses/{b.id}").json()["offers"] == []


class TestBookings:
    def _setup(self, client, db):
        driver = make_user(db, "drv@example.com")
        provider = make_user(db, "shop@example.com", role=UserRole.PROVIDER)
        b = make_business(db, owner_user_id=provider.id)
        hd = login(client, "drv@example.com")
        hp = login(client, "shop@example.com")
        r = client.post("/api/bookings", headers=hd, json={
            "business_id": str(b.id),
            "issue_description": "Engine losing power under load"})
        assert r.status_code == 201, r.text
        return r.json(), hd, hp

    def _move(self, client, headers, booking, to, **extra):
        return client.post(f"/api/bookings/{booking['id']}/transition", headers=headers,
                           json={"to_status": to, "version": booking["version"], **extra})

    def test_full_happy_path_with_commission(self, client, db):
        db.add(PlatformSetting(key="commission",
                               value={"model": "commission", "percent": 10.0}))
        db.commit()
        bk, hd, hp = self._setup(client, db)
        bk = self._move(client, hp, bk, "quoted", quoted_price_cents=150000).json()
        assert bk["status"] == "quoted" and bk["quoted_price_cents"] == 150000
        bk = self._move(client, hd, bk, "confirmed").json()
        bk = self._move(client, hp, bk, "in_progress").json()
        r = self._move(client, hp, bk, "completed", final_price_cents=160000)
        bk = r.json()
        assert bk["status"] == "completed"
        assert bk["commission_amount_cents"] == 16000
        assert bk["provider_payout_cents"] == 144000

    def test_driver_cannot_quote(self, client, db):
        bk, hd, _ = self._setup(client, db)
        r = self._move(client, hd, bk, "quoted", quoted_price_cents=100)
        assert r.status_code == 422

    def test_invalid_transition_rejected(self, client, db):
        bk, _, hp = self._setup(client, db)
        assert self._move(client, hp, bk, "completed", final_price_cents=1).status_code == 422

    def test_stale_version_conflict(self, client, db):
        bk, hd, hp = self._setup(client, db)
        assert self._move(client, hp, bk, "quoted", quoted_price_cents=100).status_code == 200
        # Driver acts on the stale (version 1) copy -> 409
        r = self._move(client, hd, bk, "cancelled")
        assert r.status_code == 409

    def test_outsider_cannot_see_booking(self, client, db):
        bk, _, _ = self._setup(client, db)
        make_user(db, "other@example.com")
        ho = login(client, "other@example.com")
        assert client.get(f"/api/bookings/{bk['id']}", headers=ho).status_code == 403

    def test_duplicate_submission_blocked(self, client, db):
        bk, hd, _ = self._setup(client, db)
        r = client.post("/api/bookings", headers=hd, json={
            "business_id": bk["business_id"],
            "issue_description": "Engine losing power under load"})
        assert r.status_code == 409

    def test_completion_requires_final_price(self, client, db):
        bk, hd, hp = self._setup(client, db)
        bk = self._move(client, hp, bk, "accepted").json()
        bk = self._move(client, hd, bk, "confirmed").json()
        bk = self._move(client, hp, bk, "in_progress").json()
        assert self._move(client, hp, bk, "completed").status_code == 422


class TestReviews:
    def _completed_booking(self, client, db):
        driver = make_user(db, "rev@example.com")
        provider = make_user(db, "revshop@example.com", role=UserRole.PROVIDER)
        b = make_business(db, owner_user_id=provider.id)
        booking = Booking(business_id=b.id, driver_id=driver.id,
                          issue_description="x" * 20, status=BookingStatus.COMPLETED,
                          final_price_cents=1000)
        db.add(booking)
        db.commit()
        return b, booking, login(client, "rev@example.com")

    def test_review_only_for_completed_booking(self, client, db):
        b, booking, h = self._completed_booking(client, db)
        r = client.post("/api/reviews", headers=h,
                        json={"booking_id": str(booking.id), "rating": 5, "text": "Great"})
        assert r.status_code == 201
        # Aggregate updated
        assert client.get(f"/api/businesses/{b.id}").json()["rating_avg"] == 5.0

    def test_duplicate_review_blocked(self, client, db):
        _, booking, h = self._completed_booking(client, db)
        payload = {"booking_id": str(booking.id), "rating": 4}
        assert client.post("/api/reviews", headers=h, json=payload).status_code == 201
        assert client.post("/api/reviews", headers=h, json=payload).status_code == 409

    def test_review_rejected_for_uncompleted(self, client, db):
        driver = make_user(db, "rev2@example.com")
        b = make_business(db)
        booking = Booking(business_id=b.id, driver_id=driver.id,
                          issue_description="x" * 20, status=BookingStatus.REQUESTED)
        db.add(booking)
        db.commit()
        h = login(client, "rev2@example.com")
        r = client.post("/api/reviews", headers=h,
                        json={"booking_id": str(booking.id), "rating": 5})
        assert r.status_code == 403

    def test_review_rejected_for_other_users_booking(self, client, db):
        _, booking, _ = self._completed_booking(client, db)
        make_user(db, "stranger@example.com")
        h = login(client, "stranger@example.com")
        r = client.post("/api/reviews", headers=h,
                        json={"booking_id": str(booking.id), "rating": 1})
        assert r.status_code == 403


class TestClaims:
    def test_claim_and_approval_flow(self, client, db):
        b = make_business(db)
        make_user(db, "claimer@example.com", role=UserRole.PROVIDER)
        h = login(client, "claimer@example.com")
        r = client.post("/api/claims", headers=h, json={
            "business_id": str(b.id),
            "evidence": "I am the owner; call the shop number to verify."})
        assert r.status_code == 201
        claim_id = r.json()["id"]
        make_user(db, "a3@example.com", role=UserRole.ADMIN)
        ha = login(client, "a3@example.com")
        r = client.post(f"/api/admin/claims/{claim_id}/decide", headers=ha,
                        json={"approve": True, "mark_identity_verified": True})
        assert r.status_code == 200
        db.expire_all()
        fresh = db.get(Business, b.id)
        assert fresh.owner_user_id is not None
        assert fresh.identity_verified_at is not None

    def test_cannot_claim_claimed_business(self, client, db):
        p = make_user(db, "owner@example.com", role=UserRole.PROVIDER)
        b = make_business(db, owner_user_id=p.id)
        make_user(db, "claimer2@example.com", role=UserRole.PROVIDER)
        h = login(client, "claimer2@example.com")
        r = client.post("/api/claims", headers=h, json={
            "business_id": str(b.id), "evidence": "Actually mine, trust me bro."})
        assert r.status_code == 409
