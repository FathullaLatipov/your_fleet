"""Password reset: emailed single-use link, then a new password."""
import re
from datetime import datetime, timedelta, timezone

import jwt

from app.api import auth as auth_module
from app.config import get_settings
from tests.test_api import client, login, make_user  # noqa: F401


class _Outbox:
    def __init__(self):
        self.sent = 0
        self.to = None
        self.token = None

    def send(self, to, subject, html):
        self.sent += 1
        self.to = to
        m = re.search(r"/reset-password\?token=([\w.\-]+)", html)
        self.token = m.group(1) if m else None
        return True


def enable_email(monkeypatch):
    box = _Outbox()
    monkeypatch.setattr(auth_module.email_service, "is_configured", lambda: True)
    monkeypatch.setattr(auth_module.email_service, "send", box.send)
    return box


def forgot(client, email):
    return client.post("/api/auth/forgot-password", json={"email": email})


def reset(client, token, password="brand-new-pass"):
    return client.post("/api/auth/reset-password", json={"token": token, "password": password})


class TestPasswordReset:
    def test_full_flow(self, client, db, monkeypatch):
        make_user(db, "reset-me@example.com")
        box = enable_email(monkeypatch)

        assert forgot(client, "Reset-Me@example.com").status_code == 204
        assert box.sent == 1 and box.to == "reset-me@example.com" and box.token

        r = reset(client, box.token)
        assert r.status_code == 200, r.text
        # The response signs the user in
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        assert client.get("/api/auth/me", headers=h).json()["email"] == "reset-me@example.com"

        # Old password is dead, new one works
        assert client.post("/api/auth/login", json={
            "email": "reset-me@example.com", "password": "password123"}).status_code == 401
        login(client, "reset-me@example.com", "brand-new-pass")

    def test_link_is_single_use(self, client, db, monkeypatch):
        make_user(db, "once@example.com")
        box = enable_email(monkeypatch)
        forgot(client, "once@example.com")
        assert reset(client, box.token).status_code == 200
        assert reset(client, box.token, "another-pass-1").status_code == 400
        login(client, "once@example.com", "brand-new-pass")

    def test_unknown_email_looks_the_same_and_sends_nothing(self, client, db, monkeypatch):
        box = enable_email(monkeypatch)
        assert forgot(client, "ghost@example.com").status_code == 204
        assert box.sent == 0

    def test_inactive_account_gets_no_link(self, client, db, monkeypatch):
        u = make_user(db, "off@example.com")
        u.is_active = False
        db.commit()
        box = enable_email(monkeypatch)
        assert forgot(client, "off@example.com").status_code == 204
        assert box.sent == 0

    def test_email_not_configured(self, client, db):
        make_user(db, "nomail@example.com")
        assert forgot(client, "nomail@example.com").status_code == 503

    def test_garbage_and_expired_tokens_rejected(self, client, db, monkeypatch):
        u = make_user(db, "exp@example.com")
        enable_email(monkeypatch)
        assert reset(client, "not-a-real-token").status_code == 400

        from app.security import _password_fingerprint, _reset_key
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        expired = jwt.encode({"sub": str(u.id), "fp": _password_fingerprint(u), "exp": past},
                             _reset_key(), algorithm="HS256")
        assert reset(client, expired).status_code == 400
        login(client, "exp@example.com")  # password untouched

    def test_access_token_is_not_a_reset_token_and_vice_versa(self, client, db, monkeypatch):
        make_user(db, "swap@example.com")
        box = enable_email(monkeypatch)
        access = login(client, "swap@example.com")["Authorization"].split(" ")[1]
        assert reset(client, access).status_code == 400

        forgot(client, "swap@example.com")
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {box.token}"})
        assert r.status_code == 401
        # Sanity: the reset token really isn't signed with the access-token key
        try:
            jwt.decode(box.token, get_settings().jwt_secret, algorithms=["HS256"])
            raise AssertionError("reset token verified with the access-token key")
        except jwt.InvalidSignatureError:
            pass

    def test_short_password_rejected(self, client, db, monkeypatch):
        make_user(db, "short@example.com")
        box = enable_email(monkeypatch)
        forgot(client, "short@example.com")
        assert reset(client, box.token, "short").status_code == 422
        # The link survives a validation error
        assert reset(client, box.token).status_code == 200

    def test_reset_verifies_an_unverified_account(self, client, db, monkeypatch):
        box = enable_email(monkeypatch)
        r = client.post("/api/auth/register", json={
            "email": "unverified@example.com", "password": "secret123",
            "full_name": "Un Verified", "role": "fleet_manager"})
        assert r.status_code == 201 and r.json()["email_verified_at"] is None
        forgot(client, "unverified@example.com")
        assert reset(client, box.token).status_code == 200
        login(client, "unverified@example.com", "brand-new-pass")
