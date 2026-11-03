"""Fleet analytics endpoint: KPI counters, spend trend/categories, issue
buckets, maintenance deadlines, per-user scoping, RBAC."""
from app.models import UserRole, utcnow

from tests.test_api import client, login, make_business, make_user  # noqa: F401


def fleet_user(client, db, email="analytics@example.com"):
    u = make_user(db, email, role=UserRole.FLEET_MANAGER)
    return u, login(client, email)


def add_vehicle(client, h, unit="101", **kw):
    r = client.post("/api/fleet/vehicles", headers=h,
                    json={"unit_number": unit, "odometer_miles": 100000, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def get_analytics(client, h):
    r = client.get("/api/fleet/analytics", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


class TestAnalyticsEmpty:
    def test_fresh_manager_all_zero(self, client, db):
        _, h = fleet_user(client, db)
        a = get_analytics(client, h)
        assert all(v == 0 for v in a["kpis"].values()), a["kpis"]
        assert len(a["spend_trend"]) == 6
        assert all(m["total_cents"] == 0 for m in a["spend_trend"])
        assert a["spend_trend"][-1]["month"] == utcnow().strftime("%Y-%m")
        # oldest first, unique consecutive calendar months
        months = [m["month"] for m in a["spend_trend"]]
        assert months == sorted(set(months))
        for key in ("spend_by_category", "top_issues", "deadlines",
                    "open_defect_list", "active_request_list"):
            assert a[key] == []


class TestAnalyticsFullPicture:
    def test_kpis_lists_and_sorting(self, client, db):
        _, h = fleet_user(client, db)
        v1 = add_vehicle(client, h, unit="T1")
        v2 = add_vehicle(client, h, unit="T2")
        # overdue schedule on T1: 80000 + 15000 << 100000
        assert client.post(f"/api/fleet/vehicles/{v1['id']}/schedules", headers=h, json={
            "title": "Oil change", "interval_miles": 15000, "last_done_miles": 80000,
        }).status_code == 201
        # open major defect on T1
        d = client.post(f"/api/fleet/vehicles/{v1['id']}/defects", headers=h, json={
            "defect_type": "tire blowout", "severity": "major"})
        assert d.status_code == 201
        # expenses in two categories across both trucks
        for vid, cat, amt in [(v1["id"], "tires", 80000),
                              (v2["id"], "repair", 150000),
                              (v1["id"], "tires", 20000)]:
            assert client.post(f"/api/fleet/vehicles/{vid}/expenses", headers=h, json={
                "category": cat, "description": f"{cat} work", "amount_cents": amt,
            }).status_code == 201
        # one active repair request on T1
        b = make_business(db)
        r = client.post("/api/bookings", headers=h, json={
            "business_id": str(b.id), "vehicle_id": v1["id"],
            "issue_description": "Blown tire on drive axle"})
        assert r.status_code == 201, r.text

        a = get_analytics(client, h)
        k = a["kpis"]
        assert k["trucks"] == 2
        assert k["trucks_in_repair"] == 0
        assert k["open_defects"] == 1
        assert k["major_defects"] == 1
        assert k["active_requests"] == 1
        assert k["maintenance_overdue"] == 1
        assert k["maintenance_due_soon"] == 0
        # each truck has no vin / insurance date / inspection date -> 3 warnings
        assert k["document_warnings"] == 6
        assert k["spend_total_cents"] == 250000
        assert k["spend_period_cents"] == 250000

        assert a["spend_trend"][-1]["total_cents"] == 250000
        assert sum(m["total_cents"] for m in a["spend_trend"]) == 250000
        assert a["spend_by_category"] == [
            {"category": "repair", "total_cents": 150000},
            {"category": "tires", "total_cents": 100000},
        ]
        assert {"label": "Tires / wheels", "count": 1} in a["top_issues"]

        assert a["deadlines"][0]["status"] == "overdue"
        assert a["deadlines"][0]["unit_number"] == "T1"
        assert a["deadlines"][0]["title"] == "Oil change"
        assert a["deadlines"][0]["miles_left"] == -5000

        od = a["open_defect_list"]
        assert len(od) == 1
        assert od[0]["defect_type"] == "tire blowout"
        assert od[0]["severity"] == "major"
        assert od[0]["unit_number"] == "T1"

        ar = a["active_request_list"]
        assert len(ar) == 1
        assert ar[0]["status"] == "requested"
        assert ar[0]["unit_number"] == "T1"

    def test_resolved_defects_count_in_top_issues_only(self, client, db):
        _, h = fleet_user(client, db)
        v = add_vehicle(client, h, unit="T9")
        d = client.post(f"/api/fleet/vehicles/{v['id']}/defects", headers=h, json={
            "defect_type": "brake pedal soft"}).json()
        client.post(f"/api/fleet/defects/{d['id']}/resolve", headers=h)
        a = get_analytics(client, h)
        assert a["kpis"]["open_defects"] == 0
        assert a["open_defect_list"] == []
        assert a["top_issues"] == [{"label": "Brakes", "count": 1}]


class TestAnalyticsIsolation:
    def test_other_users_data_does_not_leak(self, client, db):
        _, h_other = fleet_user(client, db, email="other-analytics@example.com")
        v = add_vehicle(client, h_other, unit="X1")
        client.post(f"/api/fleet/vehicles/{v['id']}/expenses", headers=h_other, json={
            "category": "fuel", "description": "diesel fill", "amount_cents": 50000})
        client.post(f"/api/fleet/vehicles/{v['id']}/defects", headers=h_other, json={
            "defect_type": "engine coolant leak"})

        _, h = fleet_user(client, db)
        a = get_analytics(client, h)
        assert all(val == 0 for val in a["kpis"].values()), a["kpis"]
        assert a["spend_by_category"] == [] and a["top_issues"] == []
        assert a["open_defect_list"] == [] and a["deadlines"] == []


class TestAnalyticsRBAC:
    def test_provider_gets_403(self, client, db):
        make_user(db, "prov-analytics@example.com", role=UserRole.PROVIDER)
        hp = login(client, "prov-analytics@example.com")
        assert client.get("/api/fleet/analytics", headers=hp).status_code == 403
