"""Vehicle documents: CRUD, file upload/download, deadlines integration."""
from datetime import timedelta

from app.models import utcnow
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user

PDF = b"%PDF-1.4 fake registration"


class TestVehicleDocuments:
    def test_crud_and_file_roundtrip(self, client, db):
        _, h = fleet_user(client, db, "doc1@example.com")
        v = add_vehicle(client, h, unit="D1")
        base = f"/api/fleet/vehicles/{v['id']}/documents"

        soon = (utcnow() + timedelta(days=10)).isoformat()
        r = client.post(base, headers=h, json={"kind": "registration", "expires_at": soon})
        assert r.status_code == 201
        doc = r.json()
        assert doc["label"] == "IRP registration / cab card"
        assert doc["status"] == "due_soon"
        assert doc["has_file"] is False

        # Upload a PDF, then download it back
        r = client.post(f"{base}/{doc['id']}/file", headers=h,
                        files={"file": ("cab-card.pdf", PDF, "application/pdf")})
        assert r.status_code == 200 and r.json()["has_file"] is True
        r = client.get(f"{base}/{doc['id']}/file", headers=h)
        assert r.status_code == 200 and r.content == PDF

        # Update the expiry to the past -> overdue
        past = (utcnow() - timedelta(days=3)).isoformat()
        r = client.patch(f"{base}/{doc['id']}", headers=h, json={"expires_at": past})
        assert r.json()["status"] == "overdue"

        # Appears on the deadlines board
        dl = client.get("/api/fleet/deadlines", headers=h).json()
        assert any(d["label"] == "IRP registration / cab card" for d in dl)

        # Listing includes the kind catalog; delete removes it
        lst = client.get(base, headers=h).json()
        assert len(lst["documents"]) == 1
        assert any(k["kind"] == "hvut_2290" for k in lst["kinds"])
        assert client.delete(f"{base}/{doc['id']}", headers=h).status_code == 204
        assert client.get(base, headers=h).json()["documents"] == []

    def test_bad_file_rejected_and_rbac(self, client, db):
        _, h = fleet_user(client, db, "doc2@example.com")
        v = add_vehicle(client, h, unit="D2")
        base = f"/api/fleet/vehicles/{v['id']}/documents"
        doc = client.post(base, headers=h, json={"kind": "title"}).json()
        r = client.post(f"{base}/{doc['id']}/file", headers=h,
                        files={"file": ("x.txt", b"plain text", "text/plain")})
        assert r.status_code == 422
        # No file uploaded yet -> 404 on download
        assert client.get(f"{base}/{doc['id']}/file", headers=h).status_code == 404
        # Another carrier can't see these documents
        _, h2 = fleet_user(client, db, "doc3@example.com")
        assert client.get(base, headers=h2).status_code == 404
