"""Email notifications and listing view counter."""
from app.models import Business, UserRole
from app.services import email as email_svc
from tests.test_api import client, login, make_business, make_user  # noqa: F401


def capture_emails(monkeypatch):
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(email_svc, "is_configured", lambda: True)
    monkeypatch.setattr(email_svc, "_deliver",
                        lambda to, subject, html: sent.append((to, subject, html)) or True)
    return sent


class TestEmails:
    def test_new_booking_emails_the_provider(self, client, db, monkeypatch):
        sent = capture_emails(monkeypatch)
        provider = make_user(db, "mail-prov@example.com", role=UserRole.PROVIDER)
        b = make_business(db, owner_user_id=provider.id)
        make_user(db, "mail-drv@example.com")
        h = login(client, "mail-drv@example.com")
        r = client.post("/api/bookings", headers=h, json={
            "business_id": str(b.id),
            "issue_description": "Coolant leak at the water pump"})
        assert r.status_code == 201
        assert sent and sent[0][0] == "mail-prov@example.com"
        assert "repair request" in sent[0][1].lower()
        assert "/bookings/" in sent[0][2]  # CTA link into the app

    def test_quote_emails_the_driver(self, client, db, monkeypatch):
        sent = capture_emails(monkeypatch)
        provider = make_user(db, "mail-prov2@example.com", role=UserRole.PROVIDER)
        b = make_business(db, owner_user_id=provider.id)
        make_user(db, "mail-drv2@example.com")
        hd = login(client, "mail-drv2@example.com")
        hp = login(client, "mail-prov2@example.com")
        bk = client.post("/api/bookings", headers=hd, json={
            "business_id": str(b.id),
            "issue_description": "Clutch slipping on grades"}).json()
        sent.clear()
        r = client.post(f"/api/bookings/{bk['id']}/transition", headers=hp,
                        json={"to_status": "quoted", "version": bk["version"],
                              "quoted_price_cents": 120000})
        assert r.status_code == 200
        assert any(to == "mail-drv2@example.com" and "quote" in subj.lower()
                   for to, subj, _ in sent)

    def test_unconfigured_email_is_silent_noop(self, client, db, monkeypatch):
        monkeypatch.setattr(email_svc, "is_configured", lambda: False)
        provider = make_user(db, "mail-prov3@example.com", role=UserRole.PROVIDER)
        b = make_business(db, owner_user_id=provider.id)
        make_user(db, "mail-drv3@example.com")
        h = login(client, "mail-drv3@example.com")
        r = client.post("/api/bookings", headers=h, json={
            "business_id": str(b.id), "issue_description": "Dead batteries again"})
        assert r.status_code == 201  # flow unaffected


class TestViewsCounter:
    def test_profile_views_increment(self, client, db):
        b = make_business(db, "Counted Shop")
        for _ in range(3):
            assert client.get(f"/api/businesses/{b.id}").status_code == 200
        db.expire_all()
        assert db.get(Business, b.id).views_count == 3
        # and it is exposed to the claim pitch
        assert client.get(f"/api/businesses/{b.id}").json()["views_count"] >= 3
