"""Samsara fuel, engine hours and engine fault codes: sync + read endpoints."""
from app.models import UserRole, Vehicle
from app.services.samsara import SamsaraFault, SamsaraStats, SamsaraVehicle, sync_samsara
from sqlalchemy import select
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user


def dtc(spn, fmi, tx, count, spn_desc="Primary Vehicle Network", fmi_desc="Erratic"):
    return SamsaraFault(vehicle_id="sam-1", protocol="j1939", spn=spn, fmi=fmi, tx_id=tx,
                        source_name="Body Controller", spn_description=spn_desc,
                        fmi_description=fmi_desc, occurrence_count=count, mil_status=0,
                        check_engine_light=True)


class TestTelematics:
    def test_fuel_hours_and_faults_sync_and_read(self, client, db):
        u, h = fleet_user(client, db, "tel1@example.com")
        add_vehicle(client, h, unit="01", vin="4V4NC9EH1KN214702")
        stats = SamsaraStats(vehicle_id="sam-1", odometer_meters=1_153_000_000,
                             lat=43.0, lng=-89.0, located_at=None,
                             fuel_percent=100, engine_seconds=101_483_820)
        report = sync_samsara(
            db, u,
            vehicles_fn=lambda: [SamsaraVehicle(id="sam-1", name="01", vin="4V4NC9EH1KN214702")],
            stats_fn=lambda: [stats], defects_fn=lambda: [],
            faults_fn=lambda: [dtc(639, 2, 11, 126), dtc(520761, 5, 33, 12)],
        )
        assert report.fuel_updated == 1 and report.engine_hours_updated == 1
        assert report.faults_active == 2

        fuel = client.get("/api/fleet/fuel", headers=h).json()
        assert fuel["summary"] == {"trucks": 1, "connected": 1, "reporting_fuel": 1,
                                   "avg_fuel_percent": 100.0, "trucks_with_faults": 1}
        it = fuel["items"][0]
        assert it["fuel_percent"] == 100 and it["active_faults"] == 2
        assert round(it["engine_hours"]) == 28190  # 101,483,820 s / 3600
        assert it["connected"] is True and round(it["odometer_miles"]) == 716_441

        v = db.execute(select(Vehicle).where(Vehicle.owner_user_id == u.id)).scalar_one()
        vf = client.get(f"/api/fleet/vehicles/{v.id}/faults", headers=h).json()
        assert len(vf["active"]) == 2 and vf["cleared"] == []
        f = next(x for x in vf["active"] if x["spn"] == 639)
        assert f["fmi"] == 2 and f["occurrence_count"] == 126 and f["check_engine_light"] is True
        assert f["source_name"] == "Body Controller"

        faults = client.get("/api/fleet/faults", headers=h).json()
        assert len(faults) == 2 and faults[0]["unit_number"] == "01"

    def test_fault_clears_when_gone(self, client, db):
        u, h = fleet_user(client, db, "tel2@example.com")
        add_vehicle(client, h, unit="01", vin="4V4NC9EH1KN214702")
        args = dict(
            vehicles_fn=lambda: [SamsaraVehicle(id="sam-1", name="01", vin="4V4NC9EH1KN214702")],
            stats_fn=lambda: [], defects_fn=lambda: [])
        sync_samsara(db, u, faults_fn=lambda: [dtc(639, 2, 11, 10)], **args)
        # Next reading: fault gone -> cleared, count unchanged for the 639 row
        report = sync_samsara(db, u, faults_fn=lambda: [], **args)
        assert report.faults_cleared == 1 and report.faults_active == 0
        v = db.execute(select(Vehicle).where(Vehicle.owner_user_id == u.id)).scalar_one()
        vf = client.get(f"/api/fleet/vehicles/{v.id}/faults", headers=h).json()
        assert vf["active"] == [] and len(vf["cleared"]) == 1
        assert client.get("/api/fleet/faults", headers=h).json() == []  # active-only default
        assert len(client.get("/api/fleet/faults?active=false", headers=h).json()) == 1

    def test_duplicate_device_same_fault_is_deduped(self, client, db):
        # One truck, two Samsara gateways, both report the same code in one run.
        u, h = fleet_user(client, db, "tel-dup@example.com")
        add_vehicle(client, h, unit="07", vin="1XKYD49X0RJ442871")
        both = [SamsaraVehicle(id="old", name="07", vin="1XKYD49X0RJ442871"),
                SamsaraVehicle(id="new", name="07", vin="1XKYD49X0RJ442871")]
        faults = [
            SamsaraFault(vehicle_id="old", protocol="j1939", spn=639, fmi=2, tx_id=11,
                         source_name="Body Controller", spn_description="Net", fmi_description="Erratic",
                         occurrence_count=120, mil_status=0, check_engine_light=False),
            SamsaraFault(vehicle_id="new", protocol="j1939", spn=639, fmi=2, tx_id=11,
                         source_name="Body Controller", spn_description="Net", fmi_description="Erratic",
                         occurrence_count=126, mil_status=0, check_engine_light=True),
        ]
        report = sync_samsara(db, u, vehicles_fn=lambda: both, stats_fn=lambda: [],
                              defects_fn=lambda: [], faults_fn=lambda: faults)
        assert report.faults_active == 1  # merged, not two rows / no crash
        v = db.execute(select(Vehicle).where(Vehicle.owner_user_id == u.id)).scalar_one()
        active = client.get(f"/api/fleet/vehicles/{v.id}/faults", headers=h).json()["active"]
        assert len(active) == 1
        assert active[0]["occurrence_count"] == 126 and active[0]["check_engine_light"] is True

    def test_missing_fuel_stays_null_not_faked(self, client, db):
        u, h = fleet_user(client, db, "tel3@example.com")
        add_vehicle(client, h, unit="02", vin="1XKYD49X0RJ442871")
        sync_samsara(
            db, u,
            vehicles_fn=lambda: [SamsaraVehicle(id="s2", name="02", vin="1XKYD49X0RJ442871")],
            stats_fn=lambda: [SamsaraStats(vehicle_id="s2", odometer_meters=1_000_000,
                                           lat=1.0, lng=2.0, located_at=None,
                                           fuel_percent=None, engine_seconds=None)],
            defects_fn=lambda: [], faults_fn=lambda: [])
        it = client.get("/api/fleet/fuel", headers=h).json()["items"][0]
        assert it["fuel_percent"] is None and it["engine_hours"] is None
        assert it["odometer_miles"] is not None  # odometer still came through

    def test_faults_license_error_doesnt_break_sync(self, client, db):
        import httpx

        u, h = fleet_user(client, db, "tel4@example.com")
        add_vehicle(client, h, unit="03", vin="1XKAD49X1KJ211825")

        def no_license():
            req = httpx.Request("GET", "https://api.samsara.com/fleet/vehicles/stats")
            resp = httpx.Response(403, json={"message": "No access to required licenses."},
                                  request=req)
            raise httpx.HTTPStatusError("403", request=req, response=resp)

        report = sync_samsara(
            db, u,
            vehicles_fn=lambda: [SamsaraVehicle(id="s3", name="03", vin="1XKAD49X1KJ211825")],
            stats_fn=lambda: [SamsaraStats(vehicle_id="s3", odometer_meters=1_609_344,
                                           lat=1.0, lng=2.0, located_at=None)],
            defects_fn=lambda: [], faults_fn=no_license)
        assert report.odometers_updated == 1
        assert report.faults_note and "403" in report.faults_note

    def test_rbac(self, client, db):
        make_user(db, "tel-prov@example.com", role=UserRole.PROVIDER)
        hp = login(client, "tel-prov@example.com")
        assert client.get("/api/fleet/fuel", headers=hp).status_code == 403
        assert client.get("/api/fleet/faults", headers=hp).status_code == 403


class TestStatsParsing:
    """Guard the client's raw-response parsing: the request type is plural
    ("fuelPercents") but Samsara's response field is singular ("fuelPercent").
    Reading the wrong key silently drops fuel for every truck (regression)."""

    def test_stats_reads_fuel_gps_odometer_hours(self):
        from app.services.samsara import SamsaraClient

        c = SamsaraClient("test-token")
        raw = [{
            "id": "281475000312418",
            "name": "07 KYLE TRICE",
            "gps": {"latitude": 43.07, "longitude": -89.4, "time": "2026-11-16T20:25:20Z",
                    "headingDegrees": 270, "speedMilesPerHour": 61},
            "obdOdometerMeters": {"value": 1_152_000_000},
            "fuelPercent": {"time": "2026-11-16T20:25:20Z", "value": 30},
            "obdEngineSeconds": {"value": 101_483_820},
        }]
        c._paged = lambda *a, **k: raw  # type: ignore[assignment]
        [s] = c.stats()
        assert s.fuel_percent == 30           # the bug read "fuelPercents" -> None
        assert s.odometer_meters == 1_152_000_000
        assert s.engine_seconds == 101_483_820
        assert s.heading == 270 and s.speed_mph == 61
        assert s.lat == 43.07 and s.lng == -89.4
        assert s.located_at is not None and s.located_at.year == 2026

    def test_stats_missing_fuel_field_is_none(self):
        from app.services.samsara import SamsaraClient

        c = SamsaraClient("test-token")
        c._paged = lambda *a, **k: [{"id": "x", "name": "02",
                                     "gps": {"latitude": 1.0, "longitude": 2.0}}]  # type: ignore[assignment]
        [s] = c.stats()
        assert s.fuel_percent is None and s.odometer_meters is None
