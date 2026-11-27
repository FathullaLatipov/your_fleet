"""Per-company integrations: Samsara multi-account connect/test/delete + security."""
import app.services.samsara as samsara_svc
from app.models import Integration
from app.security import UserRole
from sqlalchemy import select
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import fleet_user


def _stub(monkeypatch, ok=True, err=None):
    monkeypatch.setattr(samsara_svc, "check_token", lambda token: (ok, err))
    monkeypatch.setattr(samsara_svc, "client_for", lambda token: object())
    monkeypatch.setattr(samsara_svc, "sync_samsara", lambda *a, **k: None)


class TestIntegrations:
    def test_list_shows_catalog(self, client, db):
        _, h = fleet_user(client, db, "int1@example.com")
        by = {r["provider"]: r for r in client.get("/api/integrations", headers=h).json()}
        assert by["samsara"]["available"] is True
        assert by["ringcentral"]["available"] is False and by["ringcentral"]["status"] == "unavailable"
        assert by["fuel"]["available"] is False

    def test_add_account_stores_encrypted_and_hides_token(self, client, db, monkeypatch):
        u, h = fleet_user(client, db, "int2@example.com")
        _stub(monkeypatch, ok=True)
        r = client.post("/api/integrations/samsara/accounts",
                        headers=h, json={"token": "samsara_api_SECRET_TOKEN_123"})
        assert r.status_code == 201
        body = r.json()
        assert body["status"] == "connected" and body["token_last4"] == "_123" and body["label"] == "Samsara"
        assert "token" not in body and "token_encrypted" not in body
        row = db.execute(select(Integration).where(Integration.owner_user_id == u.id)).scalar_one()
        assert row.token_encrypted and "SECRET_TOKEN" not in row.token_encrypted
        from app.services import crypto
        assert crypto.decrypt(row.token_encrypted) == "samsara_api_SECRET_TOKEN_123"

    def test_bad_token_rejected_no_row(self, client, db, monkeypatch):
        u, h = fleet_user(client, db, "int3@example.com")
        _stub(monkeypatch, ok=False, err="Samsara rejected this token")
        r = client.post("/api/integrations/samsara/accounts", headers=h, json={"token": "bad_token_xxx"})
        assert r.status_code == 400
        assert db.execute(select(Integration).where(Integration.owner_user_id == u.id)).first() is None

    def test_multiple_accounts_coexist(self, client, db, monkeypatch):
        u, h = fleet_user(client, db, "int-multi@example.com")
        _stub(monkeypatch, ok=True)
        client.post("/api/integrations/samsara/accounts", headers=h, json={"token": "samsara_api_one11"})
        client.post("/api/integrations/samsara/accounts", headers=h,
                    json={"token": "samsara_api_two22", "label": "West org"})
        accts = client.get("/api/integrations/samsara/accounts", headers=h).json()
        assert len(accts) == 2
        labels = [a["label"] for a in accts]
        assert "Samsara" in labels and "West org" in labels
        assert all(a["status"] == "connected" for a in accts)
        assert db.execute(select(Integration).where(Integration.owner_user_id == u.id)).scalars().all().__len__() == 2

    def test_delete_one_account_keeps_other(self, client, db, monkeypatch):
        _, h = fleet_user(client, db, "int5@example.com")
        _stub(monkeypatch, ok=True)
        a1 = client.post("/api/integrations/samsara/accounts", headers=h, json={"token": "samsara_api_a1a1"}).json()
        client.post("/api/integrations/samsara/accounts", headers=h, json={"token": "samsara_api_b2b2"})
        assert client.delete(f"/api/integrations/samsara/accounts/{a1['id']}", headers=h).status_code == 204
        accts = client.get("/api/integrations/samsara/accounts", headers=h).json()
        assert len(accts) == 1 and accts[0]["token_last4"] == "b2b2"

    def test_account_test_rechecks(self, client, db, monkeypatch):
        _, h = fleet_user(client, db, "int6@example.com")
        _stub(monkeypatch, ok=True)
        a = client.post("/api/integrations/samsara/accounts", headers=h, json={"token": "samsara_api_zzzzz"}).json()
        monkeypatch.setattr(samsara_svc, "check_token", lambda token: (False, "revoked"))
        r = client.post(f"/api/integrations/samsara/accounts/{a['id']}/test", headers=h)
        assert r.status_code == 200 and r.json()["status"] == "error" and r.json()["last_error"] == "revoked"

    def test_generic_samsara_connect_redirects(self, client, db, monkeypatch):
        _, h = fleet_user(client, db, "int-g@example.com")
        _stub(monkeypatch, ok=True)
        r = client.put("/api/integrations/samsara", headers=h, json={"token": "samsara_api_x"})
        assert r.status_code == 400 and "accounts" in r.json()["detail"]

    def test_unavailable_provider_rejected(self, client, db, monkeypatch):
        _, h = fleet_user(client, db, "int4@example.com")
        _stub(monkeypatch)
        r = client.put("/api/integrations/ringcentral", headers=h, json={"token": "rc_token_xxx"})
        assert r.status_code == 400

    def test_rbac(self, client, db):
        make_user(db, "int-prov@example.com", role=UserRole.PROVIDER)
        hp = login(client, "int-prov@example.com")
        assert client.get("/api/integrations", headers=hp).status_code == 403
        assert client.get("/api/integrations/samsara/accounts", headers=hp).status_code == 403
