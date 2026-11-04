"""Work order flow: transitions, quotes, approval, closing, RBAC."""
from app.models import Business, UserRole, Vehicle, VehicleStatus
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user

BASE = "/api/fleet/work-orders"
PDF = b"%PDF-1.4 fake invoice bytes"
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def make_wo(client, db, email, unit="WO1"):
    owner, h = fleet_user(client, db, email)
    v = add_vehicle(client, h, unit=unit)
    r = client.post(BASE, headers=h, json={
        "vehicle_id": v["id"], "service_type": "repair",
        "priority": "urgent", "description": "Brakes grinding on the drive axle",
    })
    assert r.status_code == 201
    return owner, h, v, r.json()


class TestWorkOrderFlow:
    def test_full_happy_path(self, client, db):
        owner, h, v, wo = make_wo(client, db, "wo-flow@example.com")
        assert wo["status"] == "open" and wo["wo_number"] == 1

        # Send to shops (roadside call)
        r = client.post(f"{BASE}/{wo['id']}/send", headers=h,
                        json={"call_type": "roadside"})
        assert r.json()["status"] == "looking_for_shop"

        # Quote comes in
        r = client.post(f"{BASE}/{wo['id']}/quotes", headers=h, json={
            "shop_name": "Santos Truck Repair", "price_cents": 85000, "eta": "2 days",
        })
        assert r.status_code == 201
        wo2 = r.json()
        assert wo2["status"] == "quote_received" and wo2["quote_count"] == 1
        qid = wo2["quotes"][0]["id"]

        # Approve before accepting a quote is refused
        assert client.post(f"{BASE}/{wo['id']}/approve", headers=h).status_code == 409

        # Accept + approve
        r = client.post(f"{BASE}/{wo['id']}/quotes/{qid}/accept", headers=h)
        assert r.json()["accepted_quote_id"] == qid
        assert r.json()["shop_name"] == "Santos Truck Repair"
        r = client.post(f"{BASE}/{wo['id']}/approve", headers=h)
        assert r.json()["status"] == "approved"

        # Shop confirms -> in progress, truck goes in repair
        r = client.post(f"{BASE}/{wo['id']}/confirm", headers=h)
        assert r.json()["status"] == "in_progress"
        db.expire_all()
        assert db.get(Vehicle, v["id"]).status == VehicleStatus.IN_REPAIR

        # Update note, then ready
        assert client.post(f"{BASE}/{wo['id']}/notes", headers=h,
                           json={"note": "Shop says parts arrived"}).status_code == 201
        r = client.post(f"{BASE}/{wo['id']}/ready", headers=h)
        assert r.json()["status"] == "ready"

        # Closing without an invoice is refused
        close_body = {"final_amount_cents": 80000, "discount_cents": 5000,
                      "payment_method": "efs", "notes": "Paid via EFS check"}
        assert client.post(f"{BASE}/{wo['id']}/close", headers=h,
                           json=close_body).status_code == 409

        # Upload invoice (PDF) + payment proof, then close
        r = client.post(f"{BASE}/{wo['id']}/attachments", headers=h,
                        params={"kind": "invoice"},
                        files={"file": ("invoice.pdf", PDF, "application/pdf")})
        assert r.status_code == 201
        att_id = r.json()["id"]
        client.post(f"{BASE}/{wo['id']}/attachments", headers=h,
                    params={"kind": "payment_proof"},
                    files={"file": ("check.jpg", JPG, "image/jpeg")})
        r = client.post(f"{BASE}/{wo['id']}/close", headers=h, json=close_body)
        assert r.status_code == 200
        closed = r.json()
        assert closed["status"] == "closed"
        assert closed["final_amount_cents"] == 80000
        assert closed["payment_method"] == "efs"
        db.expire_all()
        assert db.get(Vehicle, v["id"]).status == VehicleStatus.ACTIVE

        # The repair landed on the service records ledger
        recs = client.get("/api/fleet/service-records", headers=h).json()
        assert any("WO-1" in rec["description"] for rec in recs)

        # Attachment downloads back with auth
        r = client.get(f"{BASE}/{wo['id']}/attachments/{att_id}", headers=h)
        assert r.status_code == 200 and r.content == PDF

    def test_transitions_enforced(self, client, db):
        _, h, _, wo = make_wo(client, db, "wo-trans@example.com")
        assert client.post(f"{BASE}/{wo['id']}/ready", headers=h).status_code == 409
        assert client.post(f"{BASE}/{wo['id']}/confirm", headers=h).status_code == 409
        # Quotes only after the request was sent
        assert client.post(f"{BASE}/{wo['id']}/quotes", headers=h,
                           json={"shop_name": "Early Shop"}).status_code == 409

    def test_reject_returns_to_search(self, client, db):
        _, h, _, wo = make_wo(client, db, "wo-reject@example.com")
        client.post(f"{BASE}/{wo['id']}/send", headers=h, json={"call_type": "scheduled"})
        r = client.post(f"{BASE}/{wo['id']}/quotes", headers=h,
                        json={"shop_name": "Pricey Shop", "price_cents": 300000})
        qid = r.json()["quotes"][0]["id"]
        client.post(f"{BASE}/{wo['id']}/quotes/{qid}/accept", headers=h)
        r = client.post(f"{BASE}/{wo['id']}/reject", headers=h,
                        json={"note": "Too expensive"})
        body = r.json()
        assert body["status"] == "looking_for_shop"
        assert body["accepted_quote_id"] is None
        assert body["quotes"][0]["status"] == "declined"

    def test_assign_shop_from_directory(self, client, db):
        _, h, _, wo = make_wo(client, db, "wo-assign@example.com")
        biz = Business(name="Map Picked Truck Repair",
                       normalized_name="map picked truck repair",
                       lat=41.6, lng=-93.6, city="Des Moines", state="IA")
        db.add(biz)
        db.commit()
        # Directly from open: assigns the shop and moves to looking_for_shop
        r = client.post(f"{BASE}/{wo['id']}/assign-shop", headers=h,
                        json={"business_id": str(biz.id)})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "looking_for_shop"
        assert body["shop_name"] == "Map Picked Truck Repair"
        assert body["business_id"] == str(biz.id)
        assert body["call_type"] == "scheduled"
        # Re-assign by free-text name while still looking
        r = client.post(f"{BASE}/{wo['id']}/assign-shop", headers=h,
                        json={"shop_name": "Backup Shop LLC"})
        assert r.json()["shop_name"] == "Backup Shop LLC"
        assert r.json()["business_id"] is None
        # Neither id nor name is rejected
        assert client.post(f"{BASE}/{wo['id']}/assign-shop", headers=h,
                           json={}).status_code == 422

    def test_create_requires_unit(self, client, db):
        _, h = fleet_user(client, db, "wo-unit@example.com")
        r = client.post(BASE, headers=h, json={"description": "No unit picked here"})
        assert r.status_code == 422

    def test_photo_must_be_image(self, client, db):
        _, h, _, wo = make_wo(client, db, "wo-photo@example.com")
        r = client.post(f"{BASE}/{wo['id']}/attachments", headers=h,
                        params={"kind": "photo"},
                        files={"file": ("x.pdf", PDF, "application/pdf")})
        assert r.status_code == 422

    def test_rbac(self, client, db):
        _, h, _, wo = make_wo(client, db, "wo-rbac@example.com")
        make_user(db, "wo-prov@example.com", role=UserRole.PROVIDER)
        hp = login(client, "wo-prov@example.com")
        assert client.get(BASE, headers=hp).status_code == 403
        _, h2 = fleet_user(client, db, "wo-other@example.com")
        assert client.get(f"{BASE}/{wo['id']}", headers=h2).status_code == 404
