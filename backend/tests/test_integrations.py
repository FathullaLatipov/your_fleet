"""Per-company integrations: connect/test/disconnect + token security."""
import app.services.samsara as samsara_svc
from app.models import Integration
from app.security import UserRole
from sqlalchemy import select
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import fleet_user


def _stub_samsara(monkeypatch, ok=True, err=None):
    monkeypatch.setattr(samsara_svc, "check_token", lambda token: (ok, err))
    monkeypatch.setattr(samsara_svc, "client_for", lambda token: object())
    monkeypatch.setattr(samsara_svc, "sync_samsara", lambda *a, **k: None)


class TestIntegrations:
    def test_list_shows_catalog(self, client, db):
        _, h = fleet_user(client, db, "int1@example.com")
        rows = client.get("/api/integrations", headers=h).json()
        by = {r["provider"]: r for r in rows}
        assert by["samsara"]["available"] is True and by["samsara"]["status"] == "disconnected"
        assert by["ringcentral"]["available"] is False and by["ringcentral"]["status"] == "unavailable"
        assert by["fuel"]["available"] is False

    def test_connect_stores_encrypted_and_hides_token(self, client, db, monkeypatch):
        u, h = fleet_user(client, db, "int2@example.com")
        _stub_samsara(monkeypatch, ok=True)
        r = client.put("/api/integrations/samsara",
                       headers=h, json={"token": "samsara_api_SECRET_TOKEN_123"})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "connected" and body["token_last4"] == "_123"
        assert "token" not in body and "token_encrypted" not in body

        row = db.execute(select(Integration).where(Integration.owner_user_id == u.id)).scalar_one()
        # Stored ciphertext is not the plaintext.
        assert row.token_encrypted and "SECRET_TOKEN" not in row.token_encrypted
        from app.services import crypto
        assert crypto.decrypt(row.token_encrypted) == "samsara_api_SECRET_TOKEN_123"

    def test_connect_bad_token_is_rejected(self, client, db, monkeypatch):
        u, h = fleet_user(client, db, "int3@example.com")
        _stub_samsara(monkeypatch, ok=False, err="Samsara rejected this token")
        r = client.put("/api/integrations/samsara", headers=h, json={"token": "bad_token_xxx"})
        assert r.status_code == 400
        row = db.execute(select(Integration).where(Integration.owner_user_id == u.id)).scalar_one()
        assert row.status == "error" and row.token_encrypted is None

    def test_unavailable_provider_rejected(self, client, db, monkeypatch):
        _, h = fleet_user(client, db, "int4@example.com")
        _stub_samsara(monkeypatch)
        r = client.put("/api/integrations/ringcentral", headers=h, json={"token": "rc_token_xxx"})
        assert r.status_code == 400

    def test_disconnect_clears_token(self, client, db, monkeypatch):
        u, h = fleet_user(client, db, "int5@example.com")
        _stub_samsara(monkeypatch, ok=True)
        client.put("/api/integrations/samsara", headers=h, json={"token": "samsara_api_abcde"})
        assert client.delete("/api/integrations/samsara", headers=h).status_code == 204
        row = db.execute(select(Integration).where(Integration.owner_user_id == u.id)).scalar_one()
        assert row.status == "disconnected" and row.token_encrypted is None
        assert client.get("/api/integrations", headers=h).json()[0]["status"] == "disconnected"

    def test_test_endpoint_rechecks(self, client, db, monkeypatch):
        _, h = fleet_user(client, db, "int6@example.com")
        _stub_samsara(monkeypatch, ok=True)
        client.put("/api/integrations/samsara", headers=h, json={"token": "samsara_api_zzzzz"})
        monkeypatch.setattr(samsara_svc, "check_token", lambda token: (False, "revoked"))
        r = client.post("/api/integrations/samsara/test", headers=h)
        assert r.status_code == 200 and r.json()["status"] == "error"
        assert r.json()["last_error"] == "revoked"

    def test_rbac(self, client, db):
        make_user(db, "int-prov@example.com", role=UserRole.PROVIDER)
        hp = login(client, "int-prov@example.com")
        assert client.get("/api/integrations", headers=hp).status_code == 403
