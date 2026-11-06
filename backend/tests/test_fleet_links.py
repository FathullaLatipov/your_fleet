"""Truck operator/trailer text stays linked to the driver and trailer roster."""
from tests.test_api import client  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user


def roster(client, h):
    drivers = client.get("/api/fleet/drivers", headers=h).json()
    trailers = client.get("/api/fleet/trailers", headers=h).json()
    return drivers, trailers


class TestFleetLinks:
    def test_new_truck_creates_linked_driver_and_trailer(self, client, db):
        _, h = fleet_user(client, db, "links1@example.com")
        r = client.post("/api/fleet/vehicles", headers=h, json={
            "unit_number": "043", "operator_name": "MANNIE BROWN", "trailer_unit": "#T-77"})
        v = r.json()
        drivers, trailers = roster(client, h)
        assert [(d["name"], d["assigned_vehicle_id"]) for d in drivers] == [("MANNIE BROWN", v["id"])]
        assert [(t["unit_number"], t["assigned_vehicle_id"]) for t in trailers] == [("T-77", v["id"])]

        # And a work order for the truck picks both up
        wo = client.post("/api/fleet/work-orders", headers=h, json={
            "vehicle_id": v["id"], "description": "Brake light out"}).json()
        assert wo["driver_name"] == "MANNIE BROWN" and wo["trailer_unit"] == "T-77"

    def test_existing_roster_entry_is_reused_not_duplicated(self, client, db):
        _, h = fleet_user(client, db, "links2@example.com")
        client.post("/api/fleet/drivers", headers=h, json={"name": "Mannie Brown"})
        v = add_vehicle(client, h, unit="044")
        client.patch(f"/api/fleet/vehicles/{v['id']}", headers=h,
                     json={"operator_name": "mannie brown"})
        drivers, _ = roster(client, h)
        assert len(drivers) == 1 and drivers[0]["assigned_vehicle_id"] == v["id"]

    def test_changing_operator_moves_the_link(self, client, db):
        _, h = fleet_user(client, db, "links3@example.com")
        v = client.post("/api/fleet/vehicles", headers=h, json={
            "unit_number": "045", "operator_name": "Driver One"}).json()
        client.patch(f"/api/fleet/vehicles/{v['id']}", headers=h,
                     json={"operator_name": "Driver Two"})
        drivers = {d["name"]: d["assigned_vehicle_id"] for d in roster(client, h)[0]}
        assert drivers == {"Driver One": None, "Driver Two": v["id"]}

    def test_hooking_a_trailer_updates_the_truck(self, client, db):
        _, h = fleet_user(client, db, "links4@example.com")
        v = add_vehicle(client, h, unit="046")
        t = client.post("/api/fleet/trailers", headers=h, json={"unit_number": "T-9"}).json()
        client.patch(f"/api/fleet/trailers/{t['id']}", headers=h,
                     json={"assigned_vehicle_id": v["id"]})
        truck = client.get(f"/api/fleet/vehicles/{v['id']}", headers=h).json()["vehicle"]
        assert truck["trailer_unit"] == "T-9"
        # Unhooking clears it again
        client.patch(f"/api/fleet/trailers/{t['id']}", headers=h,
                     json={"assigned_vehicle_id": None})
        truck = client.get(f"/api/fleet/vehicles/{v['id']}", headers=h).json()["vehicle"]
        assert truck["trailer_unit"] is None
