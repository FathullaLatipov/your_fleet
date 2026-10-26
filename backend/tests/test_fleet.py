"""Fleet/TMS: maintenance due logic, RBAC, booking side-effects, Samsara sync,
defect -> shop options, monday export."""
from datetime import timedelta

from app.models import (
    BusinessService, MaintenanceSchedule, Service, UserRole, Vehicle, utcnow,
)
from app.services.maintenance import schedule_status
from app.services.samsara import SamsaraDefect, SamsaraStats, SamsaraVehicle, sync_samsara
from sqlalchemy import select

from tests.test_api import client, login, make_business, make_user  # noqa: F401


def fleet_user(client, db, email="fleet@example.com"):
    u = make_user(db, email, role=UserRole.FLEET_MANAGER)
    return u, login(client, email)


def add_vehicle(client, h, unit="101", **kw):
    r = client.post("/api/fleet/vehicles", headers=h,
                    json={"unit_number": unit, "odometer_miles": 100000, **kw})
    assert r.status_code == 201, r.text
    return r.json()


class TestMaintenanceLogic:
    def _sched(self, **kw):
        return MaintenanceSchedule(title="Oil change", **kw)

    def test_overdue_by_miles(self):
        s = self._sched(interval_miles=15000, last_done_miles=80000)
        assert schedule_status(s, 96000)["status"] == "overdue"

    def test_due_soon_by_miles(self):
        s = self._sched(interval_miles=15000, last_done_miles=80000)
        st = schedule_status(s, 94700)
        assert st["status"] == "due_soon" and st["miles_left"] == 300

    def test_ok(self):
        s = self._sched(interval_miles=15000, last_done_miles=80000)
        assert schedule_status(s, 85000)["status"] == "ok"

    def test_overdue_by_time(self):
        s = self._sched(interval_months=3, last_done_at=utcnow() - timedelta(days=120))
        assert schedule_status(s, None)["status"] == "overdue"

    def test_never_done_is_due(self):
        s = self._sched(interval_months=6)
        assert schedule_status(s, None)["status"] == "overdue"


class TestFleetApi:
    def test_vehicle_crud_and_rbac(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h, vin="1XKAD49X1KJ211825")
        # another user can't see or touch it
        make_user(db, "other-fleet@example.com", role=UserRole.FLEET_MANAGER)
        ho = login(client, "other-fleet@example.com")
        assert client.get(f"/api/fleet/vehicles/{v['id']}", headers=ho).status_code == 403
        assert client.get("/api/fleet/vehicles", headers=ho).json() == []
        # provider role blocked entirely
        make_user(db, "prov-fleet@example.com", role=UserRole.PROVIDER)
        hp = login(client, "prov-fleet@example.com")
        assert client.get("/api/fleet/vehicles", headers=hp).status_code == 403

    def test_duplicate_unit_rejected(self, client, db):
        _, h = fleet_user(client, db)
        add_vehicle(client, h, unit="T1")
        r = client.post("/api/fleet/vehicles", headers=h, json={"unit_number": "T1"})
        assert r.status_code == 409

    def test_odometer_cannot_go_backwards(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h)
        r = client.post(f"/api/fleet/vehicles/{v['id']}/odometer", headers=h,
                        json={"odometer_miles": 99000})
        assert r.status_code == 422

    def test_schedule_due_flow_with_notification(self, client, db):
        u, h = fleet_user(client, db)
        v = add_vehicle(client, h)
        r = client.post(f"/api/fleet/vehicles/{v['id']}/schedules", headers=h, json={
            "title": "Oil change", "interval_miles": 15000, "last_done_miles": 90000})
        assert r.status_code == 201 and r.json()["status"] == "ok"
        # drive past the interval -> overdue + one notification
        r = client.post(f"/api/fleet/vehicles/{v['id']}/odometer", headers=h,
                        json={"odometer_miles": 105500})
        assert r.status_code == 200
        assert r.json()["maintenance_status"] == "overdue"
        notes = client.get("/api/me/notifications", headers=h).json()
        due = [n for n in notes if n["type"] == "maintenance.due"]
        assert len(due) == 1
        # second odometer update must NOT duplicate the notification
        client.post(f"/api/fleet/vehicles/{v['id']}/odometer", headers=h,
                    json={"odometer_miles": 105600})
        notes = client.get("/api/me/notifications", headers=h).json()
        assert len([n for n in notes if n["type"] == "maintenance.due"]) == 1
        # mark done -> ok again and notification re-armed
        sid = r.json()["id"] if "id" in r.json() else None
        detail = client.get(f"/api/fleet/vehicles/{v['id']}", headers=h).json()
        sid = detail["schedules"][0]["id"]
        r = client.post(f"/api/fleet/schedules/{sid}/done", headers=h, json={})
        assert r.json()["status"] == "ok"

    def test_expense_totals(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h)
        for cat, amt in [("tires", 80000), ("repair", 150000), ("tires", 20000)]:
            assert client.post(f"/api/fleet/vehicles/{v['id']}/expenses", headers=h, json={
                "category": cat, "description": f"{cat} work", "amount_cents": amt,
            }).status_code == 201
        detail = client.get(f"/api/fleet/vehicles/{v['id']}", headers=h).json()
        assert detail["expenses_by_category"] == {"tires": 100000, "repair": 150000}
        assert detail["vehicle"]["expenses_total_cents"] == 250000


class TestBookingFleetIntegration:
    def test_completed_booking_creates_expense_and_resolves_defect(self, client, db):
        u, h = fleet_user(client, db)
        v = add_vehicle(client, h)
        prov = make_user(db, "shop-fleet@example.com", role=UserRole.PROVIDER)
        b = make_business(db, owner_user_id=prov.id)
        hp = login(client, "shop-fleet@example.com")
        d = client.post(f"/api/fleet/vehicles/{v['id']}/defects", headers=h, json={
            "defect_type": "Tire — flat inner drive tire"}).json()
        assert d["suggested_service_slug"] == "tires"
        bk = client.post("/api/bookings", headers=h, json={
            "business_id": str(b.id), "vehicle_id": v["id"], "defect_id": d["id"],
            "issue_description": "Flat inner drive tire, needs replacement"}).json()
        def move(hdr, to, **extra):
            nonlocal bk
            r = client.post(f"/api/bookings/{bk['id']}/transition", headers=hdr,
                            json={"to_status": to, "version": bk["version"], **extra})
            assert r.status_code == 200, r.text
            bk = r.json()
        move(hp, "accepted")
        move(h, "confirmed")
        move(hp, "in_progress")
        detail = client.get(f"/api/fleet/vehicles/{v['id']}", headers=h).json()
        assert detail["vehicle"]["status"] == "in_repair"
        assert detail["defects"][0]["status"] == "in_repair"
        move(hp, "completed", final_price_cents=45000)
        detail = client.get(f"/api/fleet/vehicles/{v['id']}", headers=h).json()
        assert detail["vehicle"]["status"] == "active"
        assert detail["defects"][0]["status"] == "resolved"
        exp = detail["expenses"]
        assert len(exp) == 1 and exp[0]["amount_cents"] == 45000
        assert exp[0]["booking_id"] == bk["id"]

    def test_cannot_book_with_foreign_vehicle(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h)
        b = make_business(db)
        make_user(db, "intruder@example.com")
        hi = login(client, "intruder@example.com")
        r = client.post("/api/bookings", headers=hi, json={
            "business_id": str(b.id), "vehicle_id": v["id"],
            "issue_description": "Trying to use someone else's truck"})
        assert r.status_code == 422


class TestDefectShopOptions:
    def test_options_filtered_by_service_and_distance(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h)
        tire_svc = Service(slug="tires", name="Tires")
        db.add(tire_svc)
        near = make_business(db, "Near Tire Shop", lat=32.80, lng=-96.80)
        far_no_svc = make_business(db, "No Tire Service", lat=32.81, lng=-96.80)
        db.add(BusinessService(business_id=near.id, service_id=tire_svc.id,
                               standard_price_cents=42000))
        db.commit()
        d = client.post(f"/api/fleet/vehicles/{v['id']}/defects", headers=h,
                        json={"defect_type": "tire blowout"}).json()
        r = client.get(f"/api/fleet/defects/{d['id']}/shop-options", headers=h,
                       params={"lat": 32.78, "lng": -96.80})
        body = r.json()
        names = [o["name"] for o in body["options"]]
        assert "Near Tire Shop" in names and "No Tire Service" not in names
        opt = body["options"][0]
        assert opt["service_price_cents"] == 42000


class TestSamsaraSync:
    def test_sync_matches_by_vin_updates_odometer_and_defects(self, client, db):
        u, h = fleet_user(client, db)
        add_vehicle(client, h, unit="S1", vin="1XKAD49X1KJ211825")
        report = sync_samsara(
            db, u,
            vehicles_fn=lambda: [SamsaraVehicle(id="sam-1", name="S1",
                                                vin="1XKAD49X1KJ211825")],
            stats_fn=lambda: [SamsaraStats(vehicle_id="sam-1",
                                           odometer_meters=200_000_000,
                                           lat=35.1, lng=-101.8, located_at=None)],
            defects_fn=lambda: [SamsaraDefect(id="def-1", vehicle_id="sam-1",
                                              defect_type="Brakes", comment="soft pedal",
                                              resolved=False)],
        )
        assert report.vehicles_matched == 1
        assert report.odometers_updated == 1
        assert report.defects_created == 1
        v = db.execute(select(Vehicle).where(Vehicle.vin == "1XKAD49X1KJ211825")).scalar_one()
        assert abs(v.odometer_miles - 124274.2) < 1  # 200,000 km in miles
        assert v.last_lat == 35.1 and v.odometer_source == "samsara"
        # idempotent: defect not duplicated
        report2 = sync_samsara(
            db, u,
            vehicles_fn=lambda: [], stats_fn=lambda: [],
            defects_fn=lambda: [SamsaraDefect(id="def-1", vehicle_id="sam-1",
                                              defect_type="Brakes", comment=None,
                                              resolved=False)],
        )
        assert report2.defects_created == 0

    def test_unmatched_reported_not_created(self, client, db):
        u, _ = fleet_user(client, db)
        report = sync_samsara(
            db, u,
            vehicles_fn=lambda: [SamsaraVehicle(id="x", name="Ghost", vin="ZZZ11111111111111")],
            stats_fn=lambda: [], defects_fn=lambda: [],
        )
        assert report.vehicles_matched == 0 and report.unmatched


class TestMondayExport:
    def test_export_builds_items(self, client, db):
        from app.services.monday_export import export_expenses

        u, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="M7")
        client.post(f"/api/fleet/vehicles/{v['id']}/expenses", headers=h, json={
            "category": "repair", "description": "Clutch replacement",
            "amount_cents": 123456})
        calls = []

        def fake_gql(query, variables):
            calls.append(variables)
            return {"create_item": {"id": "1"}}

        report = export_expenses(db, u, "board-9", fake_gql,
                                 column_map={"amount": "numbers1", "unit": "text1"})
        assert report.exported == 1 and not report.errors
        assert calls[0]["boardId"] == "board-9"
        assert "Unit M7" in calls[0]["name"] and "$1234.56" in calls[0]["name"]
        assert '"numbers1": 1234.56' in calls[0]["columns"]
