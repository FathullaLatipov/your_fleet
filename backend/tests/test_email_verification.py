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

    def test_very_first_code_works(self, client, db, monkeypatch):
        """Regression: the code mailed at signup must verify without a resend.

        The hash is bound to user.id, which only exists after flush — issuing
        the code before the flush made every first code 'wrong'.
        """
        box = enable_email(monkeypatch)
        r = client.post("/api/auth/register", json={**REG, "email": "first@example.com"})
        assert r.status_code == 201
        r = client.post("/api/auth/verify-email",
                        json={"email": "first@example.com", "code": box.last_code})
        assert r.status_code == 200, r.text

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


class _FakeSMTP:
    """Records the SMTP conversation instead of talking to Gmail."""
    sent = {}

    def __init__(self, host, port, timeout=0):
        _FakeSMTP.sent["host"] = (host, port)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        _FakeSMTP.sent["tls"] = True

    def login(self, user, password):
        _FakeSMTP.sent["login"] = (user, password)

    def sendmail(self, frm, to, body):
        _FakeSMTP.sent["mail"] = (frm, to, body)


class TestSmtpDelivery:
    def test_send_uses_smtp_when_configured(self, monkeypatch):
        from app.config import Settings
        from app.services import email as email_mod

        cfg = Settings(smtp_user="wolffleet1@gmail.com", smtp_password="app-pass",
                       resend_api_key="")
        monkeypatch.setattr(email_mod, "get_settings", lambda: cfg)
        monkeypatch.setattr(email_mod.smtplib, "SMTP", _FakeSMTP)
        _FakeSMTP.sent = {}
        assert email_mod.is_configured() is True
        ok = email_mod.send("driver@example.com", "123456 is your code", "<p>hi</p>")
        assert ok is True
        assert _FakeSMTP.sent["host"] == ("smtp.gmail.com", 587)
        assert _FakeSMTP.sent["tls"] is True
        assert _FakeSMTP.sent["login"] == ("wolffleet1@gmail.com", "app-pass")
        frm, to, body = _FakeSMTP.sent["mail"]
        assert frm == "wolffleet1@gmail.com" and to == ["driver@example.com"]
        assert "123456" in body
