"""Truck profile: depreciation, driver assignment history, mileage history."""
from datetime import datetime, timedelta, timezone

from tests.test_api import client  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user


class TestTruckProfile:
    def test_depreciation_is_derived(self, client, db):
        _, h = fleet_user(client, db, "tp1@example.com")
        pd = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        v = add_vehicle(client, h, unit="001", purchase_price_cents=8_500_000,
                        useful_life_months=72, salvage_value_cents=0, purchase_date=pd)
        d = client.get(f"/api/fleet/vehicles/{v['id']}", headers=h).json()
        dep = d["depreciation"]
        assert dep["monthly_cents"] == round(8_500_000 / 72)  # ~ $1,180
        assert dep["annual_cents"] == dep["monthly_cents"] * 12
        assert dep["months_elapsed"] in (2, 3)  # ~90 days, depends on day-of-month
        assert dep["accumulated_cents"] == dep["monthly_cents"] * dep["months_elapsed"]
        assert dep["net_book_value_cents"] == 8_500_000 - dep["accumulated_cents"]

    def test_depreciation_absent_without_inputs(self, client, db):
        _, h = fleet_user(client, db, "tp2@example.com")
        v = add_vehicle(client, h, unit="002")
        dep = client.get(f"/api/fleet/vehicles/{v['id']}", headers=h).json()["depreciation"]
        assert dep["monthly_cents"] is None and dep["net_book_value_cents"] is None

    def test_driver_assignment_history(self, client, db):
        _, h = fleet_user(client, db, "tp3@example.com")
        v = add_vehicle(client, h, unit="003")
        vid = v["id"]
        r1 = client.post(f"/api/fleet/vehicles/{vid}/driver-assignments",
                         headers=h, json={"driver_name": "David Brown"})
        assert r1.status_code == 201
        client.post(f"/api/fleet/vehicles/{vid}/driver-assignments",
                    headers=h, json={"driver_name": "John Smith"})
        d = client.get(f"/api/fleet/vehicles/{vid}", headers=h).json()
        assert d["current_driver"] == "John Smith"
        assert d["vehicle"]["operator_name"] == "John Smith"
        hist = d["driver_assignments"]
        assert len(hist) == 2
        # Newest first; the previous one is now closed.
        assert hist[0]["driver_name"] == "John Smith" and hist[0]["end_date"] is None
        assert hist[1]["driver_name"] == "David Brown" and hist[1]["end_date"] is not None
        # Only one open assignment at a time.
        assert sum(1 for a in hist if a["end_date"] is None) == 1

    def test_end_current_assignment(self, client, db):
        _, h = fleet_user(client, db, "tp4@example.com")
        v = add_vehicle(client, h, unit="004")
        vid = v["id"]
        a = client.post(f"/api/fleet/vehicles/{vid}/driver-assignments",
                        headers=h, json={"driver_name": "Mike Johnson"}).json()
        r = client.post(f"/api/fleet/vehicles/{vid}/driver-assignments/{a['id']}/end", headers=h)
        assert r.status_code == 200 and r.json()["end_date"] is not None
        d = client.get(f"/api/fleet/vehicles/{vid}", headers=h).json()
        assert d["current_driver"] is None

    def test_mileage_history(self, client, db):
        _, h = fleet_user(client, db, "tp5@example.com")
        v = add_vehicle(client, h, unit="005")  # starts at 100000
        vid = v["id"]
        r = client.post(f"/api/fleet/vehicles/{vid}/odometer-readings",
                        headers=h, json={"miles": 185000, "note": "fuel stop"})
        assert r.status_code == 201
        d = client.get(f"/api/fleet/vehicles/{vid}", headers=h).json()
        assert d["vehicle"]["odometer_miles"] == 185000
        reads = d["odometer_readings"]
        assert any(x["miles"] == 185000 and x["note"] == "fuel stop" for x in reads)
