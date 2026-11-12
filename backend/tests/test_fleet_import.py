"""Bulk import of trucks and trailers from Excel/CSV."""
import io

import openpyxl

from tests.test_api import client  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user

TRUCK_HEADERS = ["Make/Model", "Unit Number", "Plate #", "VIN", "Year", "State",
                 "MC Number", "Driver", "Owner", "Odometer", "Trailer", "Status"]
TRAILER_HEADERS = ["Make/Model", "Unit Number", "MC Number", "Plate #", "Type", "VIN",
                   "Year", "Ownership", "State", "Assigned Truck", "Status", "Fleet Status"]


def xlsx(headers, rows) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def upload(client, h, kind, data, name="file.xlsx", dry_run=True):
    return client.post(f"/api/fleet/import/{kind}", headers=h,
                       params={"dry_run": str(dry_run).lower()},
                       files={"file": (name, data, "application/octet-stream")})


TRUCKS = [
    ["FRHT Cascadia", 4300, "P-884512", "3AKJHHDR9MSMF4300", 2021, "Indiana",
     "VKL TRUCKING INC", "MANNIE BROWN", "Owner", 125400, "VT710413", "available"],
    ["INTL/LT625", "043", "P-1", "1HSDJAPR5LH000043", "2020", "Ohio",
     "VKL TRUCKING INC", "Azizbek Abdugofurov", "Ryder Rental", "390855.15", None, "in_transit"],
    ["VOLVO VNL", None, None, None, None, None, None, None, None, None, None, None],  # no unit
    ["KENWORTH T680", 4300, None, "SHORT", 3000, None, None, None, None, None, None, "inactive"],  # dup
]


class TestTruckImport:
    def test_template_matches_client_file(self, client, db):
        _, h = fleet_user(client, db, "imp0@example.com")
        for kind, expected in (("trucks", TRUCK_HEADERS), ("trailers", TRAILER_HEADERS)):
            r = client.get(f"/api/fleet/import/template/{kind}", headers=h)
            ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
            assert [c.value for c in ws[1]] == expected

    def test_preview_writes_nothing(self, client, db):
        _, h = fleet_user(client, db, "imp1@example.com")
        r = upload(client, h, "trucks", xlsx(TRUCK_HEADERS, TRUCKS)).json()
        assert (r["created"], r["updated"], r["errors"]) == (2, 0, 2)
        actions = {row["row"]: row["action"] for row in r["rows"]}
        assert actions == {2: "create", 3: "create", 4: "error", 5: "error"}
        assert client.get("/api/fleet/vehicles", headers=h).json() == []

    def test_import_creates_and_links(self, client, db):
        _, h = fleet_user(client, db, "imp2@example.com")
        r = upload(client, h, "trucks", xlsx(TRUCK_HEADERS, TRUCKS), dry_run=False).json()
        assert r["created"] == 2 and r["dry_run"] is False
        trucks = {v["unit_number"]: v for v in client.get("/api/fleet/vehicles", headers=h).json()}
        t1, t2 = trucks["4300"], trucks["043"]
        assert (t1["make"], t1["model"], t1["year"], t1["vin"]) == ("FRHT", "Cascadia", 2021, "3AKJHHDR9MSMF4300")
        assert t1["odometer_miles"] == 125400 and t1["ownership"] == "Owner"
        assert t1["dispatch_status"] == "available" and t1["trailer_unit"] == "VT710413"
        assert (t2["make"], t2["model"]) == ("INTL", "LT625")
        assert t2["ownership"] == "Leased" and t2["owner_name"] == "Ryder Rental"
        assert t2["dispatch_status"] == "in_transit"
        # Driver and trailer columns became linked roster entries
        drivers = {d["name"]: d["assigned_vehicle_id"] for d in client.get("/api/fleet/drivers", headers=h).json()}
        assert drivers == {"MANNIE BROWN": t1["id"], "Azizbek Abdugofurov": t2["id"]}
        trailers = client.get("/api/fleet/trailers", headers=h).json()
        assert [(t["unit_number"], t["assigned_vehicle_id"]) for t in trailers] == [("VT710413", t1["id"])]

    def test_reimport_updates_without_blanking(self, client, db):
        _, h = fleet_user(client, db, "imp3@example.com")
        upload(client, h, "trucks", xlsx(TRUCK_HEADERS, TRUCKS[:1]), dry_run=False)
        # Second file: only a new plate and a LOWER odometer for the same unit
        r = upload(client, h, "trucks", xlsx(TRUCK_HEADERS, [
            [None, "4300", "NEW-PLATE", None, None, None, None, None, None, 1000, None, None],
        ]), dry_run=False).json()
        assert (r["created"], r["updated"]) == (0, 1)
        assert any("kept current" in m for m in r["rows"][0]["messages"])
        t = client.get("/api/fleet/vehicles", headers=h).json()[0]
        assert t["license_plate"] == "NEW-PLATE"
        assert t["vin"] == "3AKJHHDR9MSMF4300" and t["make"] == "FRHT"  # untouched
        assert t["odometer_miles"] == 125400

    def test_full_tms_export_headers_and_csv(self, client, db):
        _, h = fleet_user(client, db, "imp4@example.com")
        export = xlsx(["Make", "Model", "Unit number", "Plate number", "Vin", "Year", "State",
                       "MC number", "Operator (driver)", "Owner name", "Odometer", "Trailer",
                       "Status", "Fleet Status", "Aging days"],
                      [["PTRB", "579", "77", "X1", None, 2019, "Ohio", "ODO Express LLC",
                        None, "Iegor Trans INC", 0, None, "available", "ACTIVE", 12]])
        r = upload(client, h, "trucks", export, dry_run=False).json()
        assert r["created"] == 1
        assert {"Fleet Status", "Aging days"} <= set(r["ignored_columns"])
        t = client.get("/api/fleet/vehicles", headers=h).json()[0]
        assert (t["make"], t["model"], t["owner_name"], t["ownership"]) == \
            ("PTRB", "579", "Iegor Trans INC", "Owner-operator")
        csv = "Unit Number,Make/Model,Year\n88,VOLVO VNL,2022\n".encode()
        r = upload(client, h, "trucks", csv, name="trucks.csv", dry_run=False).json()
        assert r["created"] == 1

    def test_bad_files(self, client, db):
        _, h = fleet_user(client, db, "imp5@example.com")
        assert upload(client, h, "trucks", b"hello", name="notes.txt").status_code == 422
        r = upload(client, h, "trucks", xlsx(["Name", "Color"], [["a", "b"]]))
        assert r.status_code == 422 and "Unit Number" in r.json()["detail"]
        assert upload(client, h, "planes", xlsx(TRUCK_HEADERS, [])).status_code == 422


class TestTrailerImport:
    def test_trailers_link_to_trucks(self, client, db):
        _, h = fleet_user(client, db, "imp6@example.com")
        truck = add_vehicle(client, h, unit="4300")
        rows = [
            ["Utility 4000D-X", "VT710413", "VKL TRUCKING INC", "512 884", "53' Dry Van",
             "1UYVS2539NU112045", 2022, "Leased", "Illinois", "#4300", "loaded", "Ready at EZ"],
            ["Great Dane Everest", "TS044768", None, None, "Reefer", None, 2023, "Owned",
             None, "9999", "inactive", "Home with truck"],
        ]
        preview = upload(client, h, "trailers", xlsx(TRAILER_HEADERS, rows)).json()
        assert preview["created"] == 2
        assert any("isn't in your fleet" in m for m in preview["rows"][1]["messages"])
        upload(client, h, "trailers", xlsx(TRAILER_HEADERS, rows), dry_run=False)
        trailers = {t["unit_number"]: t for t in client.get("/api/fleet/trailers", headers=h).json()}
        a, b = trailers["VT710413"], trailers["TS044768"]
        assert a["assigned_vehicle_id"] == truck["id"] and a["ownership"] == "leased"
        assert (a["make"], a["model"], a["mc_number"]) == ("Utility", "4000D-X", "VKL TRUCKING INC")
        assert a["dispatch_status"] == "loaded" and a["fleet_status"] == "Ready at EZ"
        assert b["trailer_type"] == "reefer" and b["status"] == "inactive"
        assert b["assigned_vehicle_id"] is None and b["ownership"] == "owned"
        # The truck now shows the hooked trailer
        t = client.get(f"/api/fleet/vehicles/{truck['id']}", headers=h).json()["vehicle"]
        assert t["trailer_unit"] == "VT710413"

    def test_other_carriers_trucks_are_not_matched(self, client, db):
        _, h1 = fleet_user(client, db, "imp7@example.com")
        add_vehicle(client, h1, unit="555")
        _, h2 = fleet_user(client, db, "imp8@example.com")
        r = upload(client, h2, "trailers", xlsx(TRAILER_HEADERS, [
            [None, "T-1", None, None, None, None, None, None, None, "555", None, None]]),
            dry_run=False).json()
        assert any("isn't in your fleet" in m for m in r["rows"][0]["messages"])
        assert client.get("/api/fleet/trailers", headers=h2).json()[0]["assigned_vehicle_id"] is None
