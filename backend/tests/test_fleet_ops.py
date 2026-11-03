"""Fleet assets & ops: trailers, driver roster, tasks, comm log, issue board,
deadline board, merged service history, expense ledger, insights, RBAC."""
import uuid
from datetime import timedelta

from app.models import (
    Booking, BookingStatus, ExpenseCategory, UserRole, VehicleExpense, utcnow,
)
from tests.test_api import client, login, make_business, make_user  # noqa: F401


def fleet_user(client, db, email="ops@example.com"):
    u = make_user(db, email, role=UserRole.FLEET_MANAGER)
    return u, login(client, email)


def add_vehicle(client, h, unit="101", **kw):
    r = client.post("/api/fleet/vehicles", headers=h,
                    json={"unit_number": unit, "odometer_miles": 100000, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def iso_in(days: int) -> str:
    return (utcnow() + timedelta(days=days)).isoformat()


# ------------------------------------------------------------------ trailers

class TestTrailers:
    def test_crud_warnings_and_duplicate(self, client, db):
        _, h = fleet_user(client, db)
        r = client.post("/api/fleet/trailers", headers=h, json={
            "unit_number": "TR1", "trailer_type": "reefer",
            "vin": "1uyvs2538fm906", "inspection_expires_at": iso_in(10),
            "registration_expires_at": iso_in(-1)})
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["vin"] == "1UYVS2538FM906"  # uppercased
        assert any(w.startswith("Inspection expires in") for w in t["warnings"])
        assert any(w.startswith("Registration expired") for w in t["warnings"])
        # missing dates -> "No ... date on file"
        t2 = client.post("/api/fleet/trailers", headers=h,
                         json={"unit_number": "TR2"}).json()
        assert "No inspection date on file" in t2["warnings"]
        assert "No registration date on file" in t2["warnings"]
        # duplicate unit for this owner -> 409
        r = client.post("/api/fleet/trailers", headers=h, json={"unit_number": "TR1"})
        assert r.status_code == 409
        # list ordered by unit_number
        lst = client.get("/api/fleet/trailers", headers=h).json()
        assert [x["unit_number"] for x in lst] == ["TR1", "TR2"]
        # patch + delete
        r = client.patch(f"/api/fleet/trailers/{t['id']}", headers=h,
                         json={"status": "in_repair", "notes": "brakes"})
        assert r.status_code == 200 and r.json()["status"] == "in_repair"
        assert client.delete(f"/api/fleet/trailers/{t2['id']}",
                             headers=h).status_code == 204
        lst = client.get("/api/fleet/trailers", headers=h).json()
        assert [x["unit_number"] for x in lst] == ["TR1"]

    def test_assignment_validation(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="T7")
        t = client.post("/api/fleet/trailers", headers=h,
                        json={"unit_number": "TR9"}).json()
        # own vehicle -> ok, assigned_unit resolved
        r = client.patch(f"/api/fleet/trailers/{t['id']}", headers=h,
                         json={"assigned_vehicle_id": v["id"]})
        assert r.status_code == 200
        assert r.json()["assigned_unit"] == "T7"
        # foreign vehicle -> 422
        _, h2 = fleet_user(client, db, email="ops2@example.com")
        v2 = add_vehicle(client, h2, unit="X1")
        r = client.patch(f"/api/fleet/trailers/{t['id']}", headers=h,
                         json={"assigned_vehicle_id": v2["id"]})
        assert r.status_code == 422

    def test_owner_isolation(self, client, db):
        _, h = fleet_user(client, db)
        t = client.post("/api/fleet/trailers", headers=h,
                        json={"unit_number": "TR1"}).json()
        _, h2 = fleet_user(client, db, email="ops2@example.com")
        assert client.get("/api/fleet/trailers", headers=h2).json() == []
        assert client.patch(f"/api/fleet/trailers/{t['id']}", headers=h2,
                            json={"notes": "mine now"}).status_code == 404
        assert client.delete(f"/api/fleet/trailers/{t['id']}",
                             headers=h2).status_code == 404
        # still there for the owner
        assert len(client.get("/api/fleet/trailers", headers=h).json()) == 1

    def test_provider_rbac(self, client, db):
        make_user(db, "prov-ops@example.com", role=UserRole.PROVIDER)
        hp = login(client, "prov-ops@example.com")
        assert client.get("/api/fleet/trailers", headers=hp).status_code == 403


# ------------------------------------------------------------------- drivers

class TestDrivers:
    def test_crud_and_warnings(self, client, db):
        _, h = fleet_user(client, db)
        r = client.post("/api/fleet/drivers", headers=h, json={"name": "Bob Lane"})
        assert r.status_code == 201, r.text
        d = r.json()
        assert "No CDL date on file" in d["warnings"]
        assert "No medical card date on file" in d["warnings"]
        r = client.patch(f"/api/fleet/drivers/{d['id']}", headers=h, json={
            "cdl_expires_at": iso_in(-5), "medical_card_expires_at": iso_in(20),
            "status": "inactive"})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "inactive"
        assert any(w.startswith("CDL expired") for w in d["warnings"])
        assert any(w.startswith("Medical card expires in") for w in d["warnings"])
        client.post("/api/fleet/drivers", headers=h, json={"name": "Al Smith"})
        names = [x["name"] for x in client.get("/api/fleet/drivers", headers=h).json()]
        assert names == ["Al Smith", "Bob Lane"]  # ordered by name
        assert client.delete(f"/api/fleet/drivers/{d['id']}",
                             headers=h).status_code == 204
        names = [x["name"] for x in client.get("/api/fleet/drivers", headers=h).json()]
        assert names == ["Al Smith"]

    def test_assignment_syncs_operator_name(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="T1")
        d = client.post("/api/fleet/drivers", headers=h,
                        json={"name": "Maria Diaz"}).json()
        r = client.patch(f"/api/fleet/drivers/{d['id']}", headers=h,
                         json={"assigned_vehicle_id": v["id"]})
        assert r.status_code == 200 and r.json()["assigned_unit"] == "T1"
        vehicles = client.get("/api/fleet/vehicles", headers=h).json()
        assert vehicles[0]["operator_name"] == "Maria Diaz"
        # foreign vehicle -> 422
        _, h2 = fleet_user(client, db, email="ops2@example.com")
        v2 = add_vehicle(client, h2, unit="Z1")
        r = client.patch(f"/api/fleet/drivers/{d['id']}", headers=h,
                         json={"assigned_vehicle_id": v2["id"]})
        assert r.status_code == 422


# --------------------------------------------------------------------- tasks

class TestTasks:
    def test_lifecycle_overdue_and_filters(self, client, db):
        _, h = fleet_user(client, db)
        r = client.post("/api/fleet/tasks", headers=h, json={
            "title": "Order air filters", "due_at": iso_in(-1)})
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["status"] == "open" and t["priority"] == "medium"
        assert t["overdue"] is True and t["completed_at"] is None
        r = client.patch(f"/api/fleet/tasks/{t['id']}", headers=h,
                         json={"status": "in_progress"})
        assert r.json()["status"] == "in_progress"
        assert r.json()["completed_at"] is None
        r = client.patch(f"/api/fleet/tasks/{t['id']}", headers=h,
                         json={"status": "done"})
        done = r.json()
        assert done["status"] == "done"
        assert done["completed_at"] is not None
        assert done["overdue"] is False
        # default "active" filter hides done tasks
        assert client.get("/api/fleet/tasks", headers=h).json() == []
        done_list = client.get("/api/fleet/tasks", headers=h,
                               params={"status": "done"}).json()
        assert [x["id"] for x in done_list] == [t["id"]]
        # moving away from done clears completed_at
        r = client.patch(f"/api/fleet/tasks/{t['id']}", headers=h,
                         json={"status": "open"})
        assert r.json()["completed_at"] is None
        assert client.delete(f"/api/fleet/tasks/{t['id']}",
                             headers=h).status_code == 204
        assert client.get("/api/fleet/tasks", headers=h).json() == []

    def test_sorting_and_link_validation(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="T3")
        a = client.post("/api/fleet/tasks", headers=h, json={
            "title": "Due later", "due_at": iso_in(5)}).json()
        b = client.post("/api/fleet/tasks", headers=h, json={
            "title": "Due sooner", "due_at": iso_in(1), "vehicle_id": v["id"]}).json()
        c = client.post("/api/fleet/tasks", headers=h, json={"title": "No due"}).json()
        lst = client.get("/api/fleet/tasks", headers=h).json()
        assert [x["id"] for x in lst] == [b["id"], a["id"], c["id"]]
        assert lst[0]["unit_number"] == "T3"
        # foreign vehicle/driver links rejected
        _, h2 = fleet_user(client, db, email="ops2@example.com")
        v2 = add_vehicle(client, h2, unit="Z9")
        r = client.post("/api/fleet/tasks", headers=h, json={
            "title": "Bad link", "vehicle_id": v2["id"]})
        assert r.status_code == 422


# ------------------------------------------------------------------ comm log

class TestCommLog:
    def test_create_list_delete(self, client, db):
        u, h = fleet_user(client, db)
        biz = make_business(db)
        bk = Booking(business_id=biz.id, driver_id=u.id,
                     issue_description="Brake job quote")
        db.add(bk)
        db.commit()
        r = client.post("/api/fleet/comm-log", headers=h, json={
            "subject": "Called shop about brakes", "kind": "call",
            "contact_name": "Joe", "booking_id": str(bk.id)})
        assert r.status_code == 201, r.text
        e1 = r.json()
        assert e1["kind"] == "call" and e1["booking_id"] == str(bk.id)
        assert e1["happened_at"] is not None  # defaulted to now
        e2 = client.post("/api/fleet/comm-log", headers=h, json={
            "subject": "Note to self",
            "happened_at": (utcnow() + timedelta(hours=1)).isoformat()}).json()
        assert e2["kind"] == "note"  # default kind
        lst = client.get("/api/fleet/comm-log", headers=h).json()
        assert [x["id"] for x in lst] == [e2["id"], e1["id"]]  # newest first
        assert client.delete(f"/api/fleet/comm-log/{e1['id']}",
                             headers=h).status_code == 204
        lst = client.get("/api/fleet/comm-log", headers=h).json()
        assert [x["id"] for x in lst] == [e2["id"]]

    def test_foreign_booking_rejected(self, client, db):
        _, h = fleet_user(client, db)
        other = make_user(db, "stranger@example.com")
        biz = make_business(db)
        bk = Booking(business_id=biz.id, driver_id=other.id,
                     issue_description="Someone else's booking")
        db.add(bk)
        db.commit()
        r = client.post("/api/fleet/comm-log", headers=h, json={
            "subject": "Sneaky link", "booking_id": str(bk.id)})
        assert r.status_code == 422


# -------------------------------------------------------------------- issues

class TestIssues:
    def test_filters_and_suggestion(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="T5")
        d1 = client.post(f"/api/fleet/vehicles/{v['id']}/defects", headers=h,
                         json={"defect_type": "tire blowout"}).json()
        d2 = client.post(f"/api/fleet/vehicles/{v['id']}/defects", headers=h,
                         json={"defect_type": "brake pedal soft"}).json()
        client.post(f"/api/fleet/defects/{d2['id']}/resolve", headers=h)
        # default "active" hides resolved
        lst = client.get("/api/fleet/issues", headers=h).json()
        assert [x["id"] for x in lst] == [d1["id"]]
        assert lst[0]["unit_number"] == "T5"
        assert lst[0]["suggested_service_slug"] == "tires"
        all_lst = client.get("/api/fleet/issues", headers=h,
                             params={"status": "all"}).json()
        assert {x["id"] for x in all_lst} == {d1["id"], d2["id"]}
        res = client.get("/api/fleet/issues", headers=h,
                         params={"status": "resolved"}).json()
        assert [x["id"] for x in res] == [d2["id"]]


# ----------------------------------------------------------------- deadlines

class TestDeadlines:
    def test_combined_sources_and_sorting(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="T1")  # odometer 100000
        # overdue maintenance: 80000 + 15000 << 100000
        assert client.post(f"/api/fleet/vehicles/{v['id']}/schedules", headers=h, json={
            "title": "Oil change", "interval_miles": 15000, "last_done_miles": 80000,
        }).status_code == 201
        # vehicle insurance due soon
        assert client.patch(f"/api/fleet/vehicles/{v['id']}", headers=h, json={
            "insurance_expires_at": iso_in(10)}).status_code == 200
        # driver CDL overdue
        client.post("/api/fleet/drivers", headers=h, json={
            "name": "Bob Lane", "cdl_expires_at": iso_in(-5)})
        # trailer registration upcoming (60 days out)
        client.post("/api/fleet/trailers", headers=h, json={
            "unit_number": "TR1", "registration_expires_at": iso_in(60)})

        dl = client.get("/api/fleet/deadlines", headers=h).json()
        by_kind = {e["kind"]: e for e in dl}
        assert by_kind["maintenance"]["status"] == "overdue"
        assert by_kind["maintenance"]["label"] == "Oil change"
        assert by_kind["maintenance"]["ref"] == "Unit T1"
        assert by_kind["maintenance"]["miles_left"] == -5000
        assert by_kind["vehicle_insurance"]["status"] == "due_soon"
        assert by_kind["vehicle_insurance"]["label"] == "Insurance"
        assert by_kind["driver_cdl"]["status"] == "overdue"
        assert by_kind["driver_cdl"]["ref"] == "Bob Lane"
        assert by_kind["driver_cdl"]["days_left"] < 0
        assert by_kind["trailer_registration"]["status"] == "upcoming"
        assert by_kind["trailer_registration"]["ref"] == "Trailer TR1"
        # missing vehicle inspection date is NOT a deadline entry
        assert "vehicle_inspection" not in by_kind
        # overdue group first, then due_soon, then upcoming
        rank = {"overdue": 0, "due_soon": 1, "upcoming": 2}
        ranks = [rank[e["status"]] for e in dl]
        assert ranks == sorted(ranks)
        assert ranks[0] == 0 and ranks[-1] == 2


# ----------------------------------------------------------- service records

class TestServiceRecords:
    def test_merge_and_exclusions(self, client, db):
        u, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="T1")
        vid = uuid.UUID(v["id"])
        biz = make_business(db, "Best Brake Shop")
        bk = Booking(business_id=biz.id, driver_id=u.id, vehicle_id=vid,
                     status=BookingStatus.COMPLETED, final_price_cents=45000,
                     issue_description="Brake chamber replacement")
        db.add(bk)
        db.commit()
        # logged repair expense (no booking) -> included
        assert client.post("/api/fleet/expenses", headers=h, json={
            "vehicle_id": v["id"], "category": "repair",
            "description": "Shop-logged clutch work", "amount_cents": 10000,
        }).status_code == 201
        # fuel -> excluded
        client.post("/api/fleet/expenses", headers=h, json={
            "vehicle_id": v["id"], "category": "fuel",
            "description": "diesel fill", "amount_cents": 50000})
        # repair expense tied to the booking -> excluded (already counted)
        db.add(VehicleExpense(vehicle_id=vid, booking_id=bk.id,
                              category=ExpenseCategory.REPAIR,
                              description="auto from booking",
                              amount_cents=45000, created_by=u.id))
        db.commit()

        recs = client.get("/api/fleet/service-records", headers=h).json()
        assert len(recs) == 2, recs
        kinds = {r["kind"] for r in recs}
        assert kinds == {"marketplace", "logged"}
        mkt = next(r for r in recs if r["kind"] == "marketplace")
        assert mkt["shop_name"] == "Best Brake Shop"
        assert mkt["amount_cents"] == 45000
        assert mkt["unit_number"] == "T1"
        assert mkt["booking_id"] == str(bk.id)
        logged = next(r for r in recs if r["kind"] == "logged")
        assert logged["category"] == "repair" and logged["booking_id"] is None
        # vehicle filter applies to both sources
        other = add_vehicle(client, h, unit="T2")
        filtered = client.get("/api/fleet/service-records", headers=h,
                              params={"vehicle_id": other["id"]}).json()
        assert filtered == []


# ------------------------------------------------------------------ expenses

class TestExpenses:
    def test_totals_monthly_zero_fill_and_category_filter(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="T1")
        for cat, amt in [("repair", 10000), ("tires", 5000)]:
            assert client.post("/api/fleet/expenses", headers=h, json={
                "vehicle_id": v["id"], "category": cat,
                "description": f"{cat} work", "amount_cents": amt,
            }).status_code == 201
        body = client.get("/api/fleet/expenses", headers=h).json()
        assert body["total_cents"] == 15000
        assert len(body["items"]) == 2
        assert body["items"][0]["unit_number"] == "T1"
        assert body["totals_by_category"] == {"repair": 10000, "tires": 5000}
        monthly = body["monthly"]
        assert len(monthly) == 6  # zero-filled, oldest first
        assert monthly[-1]["month"] == utcnow().strftime("%Y-%m")
        assert monthly[-1]["total_cents"] == 15000
        assert all(m["total_cents"] == 0 for m in monthly[:-1])
        months = [m["month"] for m in monthly]
        assert months == sorted(set(months))
        # category filter narrows items AND totals
        body = client.get("/api/fleet/expenses", headers=h,
                          params={"category": "repair"}).json()
        assert body["total_cents"] == 10000
        assert [i["category"] for i in body["items"]] == ["repair"]
        assert body["totals_by_category"] == {"repair": 10000}
        # months window is adjustable
        body = client.get("/api/fleet/expenses", headers=h,
                          params={"months": 3}).json()
        assert len(body["monthly"]) == 3

    def test_post_requires_owned_vehicle(self, client, db):
        _, h = fleet_user(client, db)
        _, h2 = fleet_user(client, db, email="ops2@example.com")
        v2 = add_vehicle(client, h2, unit="Z1")
        r = client.post("/api/fleet/expenses", headers=h, json={
            "vehicle_id": v2["id"], "category": "repair",
            "description": "not my truck", "amount_cents": 100})
        assert r.status_code in (403, 404)


# ------------------------------------------------------------------ insights

class TestInsights:
    def test_cost_per_mile(self, client, db):
        _, h = fleet_user(client, db)
        v1 = add_vehicle(client, h, unit="T1")
        v2 = add_vehicle(client, h, unit="T2")
        # T1: two odometer-stamped expenses 1000 miles apart -> cpm computable
        for amt, odo in [(10000, 100000), (20000, 101000)]:
            assert client.post("/api/fleet/expenses", headers=h, json={
                "vehicle_id": v1["id"], "category": "repair",
                "description": "work", "amount_cents": amt,
                "odometer_miles": odo}).status_code == 201
        # T2: span under 500 miles -> null
        for amt, odo in [(1000, 100000), (2000, 100300)]:
            client.post("/api/fleet/expenses", headers=h, json={
                "vehicle_id": v2["id"], "category": "parts",
                "description": "small", "amount_cents": amt,
                "odometer_miles": odo})
        ins = client.get("/api/fleet/insights", headers=h).json()
        per = {t["unit_number"]: t for t in ins["per_truck"]}
        assert per["T1"]["total_cents"] == 30000
        assert per["T1"]["expenses_count"] == 2
        assert per["T1"]["cost_per_mile_cents"] == 30  # 30000 / 1000 mi
        assert per["T2"]["cost_per_mile_cents"] is None
        # sorted by total desc
        assert [t["unit_number"] for t in ins["per_truck"]] == ["T1", "T2"]
        mbc = ins["monthly_by_category"]
        assert len(mbc) == 6
        assert mbc[-1]["categories"] == {"repair": 30000, "parts": 3000}
        assert all(m["categories"] == {} for m in mbc[:-1])
