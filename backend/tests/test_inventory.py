"""Fleet inventory: CRUD, split/merge moves, archive, groups, export, docs, RBAC."""
import io

from app.models import UserRole
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user

BASE = "/api/fleet/inventory"
PDF = b"%PDF-1.4 receipt"


def add_item(client, h, **kw):
    body = {"name": "tablet", "item_type": "tablet", "reference": "tablet-504",
            "mc_number": "IQS Group LLC", "amount_cents": 100, "quantity": 301, **kw}
    r = client.post(BASE, headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


class TestInventory:
    def test_create_and_list_with_totals(self, client, db):
        _, h = fleet_user(client, db, "inv1@example.com")
        item = add_item(client, h)
        assert item["location_label"] == "Warehouse"
        assert item["total_cents"] == 30100 and item["type_label"] == "Tablet"
        add_item(client, h, name="Snow chains set", item_type="snow_chains",
                 reference=None, amount_cents=50000, quantity=2)
        r = client.get(BASE, headers=h, params={"sort": "total", "order": "desc"}).json()
        assert r["total"] == 2
        assert r["items"][0]["name"] == "Snow chains set"  # $1,000 > $301
        assert r["totals"] == {"quantity": 303, "amount_cents": 130100}
        # Filters: type and search
        assert client.get(BASE, headers=h, params={"item_type": "snow_chains"}).json()["total"] == 1
        assert client.get(BASE, headers=h, params={"q": "504"}).json()["total"] == 1

    def test_move_splits_then_merges(self, client, db):
        _, h = fleet_user(client, db, "inv2@example.com")
        v = add_vehicle(client, h, unit="3651")
        item = add_item(client, h)
        # Give 300 of 301 to the truck -> split into two rows
        moved = client.post(f"{BASE}/{item['id']}/move", headers=h, json={
            "location_kind": "vehicle", "vehicle_id": v["id"], "quantity": 300}).json()
        assert moved["location_label"] == "Unit 3651" and moved["quantity"] == 300
        rows = {r["location_label"]: r["quantity"] for r in client.get(BASE, headers=h).json()["items"]}
        assert rows == {"Warehouse": 1, "Unit 3651": 300}
        # Move the last one onto the truck -> merges, warehouse row disappears
        merged = client.post(f"{BASE}/{item['id']}/move", headers=h, json={
            "location_kind": "vehicle", "vehicle_id": v["id"]}).json()
        assert merged["quantity"] == 301
        rows = client.get(BASE, headers=h).json()["items"]
        assert [(r["location_label"], r["quantity"]) for r in rows] == [("Unit 3651", 301)]
        # Too many / same place are refused
        assert client.post(f"{BASE}/{merged['id']}/move", headers=h, json={
            "location_kind": "warehouse", "quantity": 999}).status_code == 422
        assert client.post(f"{BASE}/{merged['id']}/move", headers=h, json={
            "location_kind": "vehicle", "vehicle_id": v["id"]}).status_code == 422

    def test_driver_location_and_driver_delete_returns_stock(self, client, db):
        _, h = fleet_user(client, db, "inv3@example.com")
        d = client.post("/api/fleet/drivers", headers=h, json={"name": "Mukhtar Omar Hassan"}).json()
        item = add_item(client, h, location_kind="driver", driver_id=d["id"], quantity=1)
        assert item["location_label"] == "Mukhtar Omar Hassan"
        assert client.delete(f"/api/fleet/drivers/{d['id']}", headers=h).status_code == 204
        rows = client.get(BASE, headers=h).json()["items"]
        assert rows[0]["location_label"] == "Warehouse"

    def test_archive_restore_delete(self, client, db):
        _, h = fleet_user(client, db, "inv4@example.com")
        item = add_item(client, h)
        # Delete only from the archive
        assert client.delete(f"{BASE}/{item['id']}", headers=h).status_code == 409
        client.post(f"{BASE}/{item['id']}/archive", headers=h)
        assert client.get(BASE, headers=h).json()["total"] == 0
        assert client.get(BASE, headers=h, params={"tab": "archived"}).json()["total"] == 1
        client.post(f"{BASE}/{item['id']}/restore", headers=h)
        assert client.get(BASE, headers=h).json()["total"] == 1
        client.post(f"{BASE}/{item['id']}/archive", headers=h)
        assert client.delete(f"{BASE}/{item['id']}", headers=h).status_code == 204
        assert client.get(BASE, headers=h, params={"tab": "archived"}).json()["total"] == 0

    def test_groups_export_and_documents(self, client, db):
        _, h = fleet_user(client, db, "inv5@example.com")
        v = add_vehicle(client, h, unit="77")
        item = add_item(client, h, quantity=10)
        client.post(f"{BASE}/{item['id']}/move", headers=h,
                    json={"location_kind": "vehicle", "vehicle_id": v["id"], "quantity": 4})
        groups = client.get(f"{BASE}/groups", headers=h).json()
        assert groups == [{
            "item_type": "tablet", "type_label": "Tablet", "rows": 2, "quantity": 10,
            "total_cents": 1000, "in_warehouse": 6, "on_trucks": 4, "with_drivers": 0,
        }]
        r = client.get(f"{BASE}/export", headers=h)
        assert r.status_code == 200 and r.content[:2] == b"PK"
        import openpyxl
        ws = openpyxl.load_workbook(io.BytesIO(r.content)).worksheets[0]
        cells = [c.value for row in ws.iter_rows() for c in row if c.value]
        assert "Unit 77" in cells and "IQS Group LLC" in cells
        # Documents
        r = client.post(f"{BASE}/{item['id']}/documents", headers=h,
                        files={"file": ("receipt.pdf", PDF, "application/pdf")})
        assert r.status_code == 201
        doc = r.json()
        assert client.get(f"{BASE}/{item['id']}/documents/{doc['id']}", headers=h).content == PDF
        listed = {r["id"]: r["document_count"] for r in client.get(BASE, headers=h).json()["items"]}
        assert listed[item["id"]] == 1
        assert client.delete(f"{BASE}/{item['id']}/documents/{doc['id']}", headers=h).status_code == 204

    def test_validation_and_isolation(self, client, db):
        _, h = fleet_user(client, db, "inv6@example.com")
        assert client.post(BASE, headers=h, json={
            "name": "x", "item_type": "spaceship", "amount_cents": 1, "quantity": 1}).status_code == 422
        assert client.post(BASE, headers=h, json={
            "name": "x", "amount_cents": 1, "quantity": 0}).status_code == 422
        item = add_item(client, h)
        # Another carrier can't see, move or use their truck
        _, h2 = fleet_user(client, db, "inv7@example.com")
        assert client.get(BASE, headers=h2).json()["total"] == 0
        assert client.post(f"{BASE}/{item['id']}/archive", headers=h2).status_code == 404
        v2 = add_vehicle(client, h2, unit="X1")
        assert client.post(f"{BASE}/{item['id']}/move", headers=h, json={
            "location_kind": "vehicle", "vehicle_id": v2["id"]}).status_code == 422
        make_user(db, "inv-prov@example.com", role=UserRole.PROVIDER)
        assert client.get(BASE, headers=login(client, "inv-prov@example.com")).status_code == 403

    def test_options(self, client, db):
        _, h = fleet_user(client, db, "inv8@example.com")
        add_vehicle(client, h, unit="12")
        add_item(client, h)
        opts = client.get(f"{BASE}/options", headers=h).json()
        assert opts["types"][0] == {"key": "snow_chains", "label": "Snow Chains"}
        assert {"key": "elite_pass", "label": "Elite pass"} in opts["types"]
        assert "IQS Group LLC" in opts["mc_numbers"]
        assert opts["vehicles"][0]["unit_number"] == "12"
