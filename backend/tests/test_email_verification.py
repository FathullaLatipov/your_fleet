"""Email verification: code flow when email is configured, bypass when not."""
import re

from app.api import auth as auth_module
from tests.test_api import client, login, make_user  # noqa: F401

REG = {"email": "verify-me@example.com", "password": "secret123",
       "full_name": "Verify Me", "role": "fleet_manager"}


class _Outbox:
    def __init__(self):
        self.last_code = None
        self.sent = 0

    def send(self, to, subject, html):
        self.sent += 1
        m = re.search(r"(\d{6})", subject)
        self.last_code = m.group(1) if m else None
        return True


def enable_email(monkeypatch):
    box = _Outbox()
    monkeypatch.setattr(auth_module.email_service, "is_configured", lambda: True)
    monkeypatch.setattr(auth_module.email_service, "send", box.send)
    return box


class TestEmailVerification:
    def test_unconfigured_email_means_auto_verified(self, client, db):
        r = client.post("/api/auth/register", json={**REG, "email": "nv@example.com"})
        assert r.status_code == 201
        assert r.json()["email_verified_at"] is not None
        # Login works right away
        assert client.post("/api/auth/login", json={
            "email": "nv@example.com", "password": "secret123"}).status_code == 200

    def test_full_code_flow(self, client, db, monkeypatch):
        box = enable_email(monkeypatch)
        r = client.post("/api/auth/register", json=REG)
        assert r.status_code == 201
        assert r.json()["email_verified_at"] is None
        assert box.sent == 1 and box.last_code is not None

        # Login is blocked until the code is confirmed
        r = client.post("/api/auth/login", json={"email": REG["email"],
                                                 "password": REG["password"]})
        assert r.status_code == 403
        assert "not verified" in r.json()["detail"].lower()

        # Wrong code counts an attempt
        r = client.post("/api/auth/verify-email",
                        json={"email": REG["email"], "code": "000000"})
        assert r.status_code == 422 or box.last_code == "000000"

        # Resend issues a fresh code
        assert client.post("/api/auth/resend-code",
                           json={"email": REG["email"]}).status_code == 204
        assert box.sent == 2

        # Right code verifies and signs in
        r = client.post("/api/auth/verify-email",
                        json={"email": REG["email"], "code": box.last_code})
        assert r.status_code == 200
        token = r.json()["access_token"]
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
        assert me["email_verified_at"] is not None

        # Now plain login works too
        assert client.post("/api/auth/login", json={
            "email": REG["email"], "password": REG["password"]}).status_code == 200

    def test_verify_unknown_email(self, client, db, monkeypatch):
        enable_email(monkeypatch)
        assert client.post("/api/auth/verify-email",
                           json={"email": "ghost@example.com", "code": "123456"}
                           ).status_code == 404

    def test_preexisting_users_still_login_when_email_enabled(self, client, db, monkeypatch):
        # make_user predates verification (email_verified_at NULL) — treated
        # like prod users backfilled by the migration only if verified_at set.
        u = make_user(db, "legacy@example.com")
        from app.models import utcnow
        u.email_verified_at = utcnow()
        db.commit()
        enable_email(monkeypatch)
        assert client.post("/api/auth/login", json={
            "email": "legacy@example.com", "password": "password123"}).status_code == 200
