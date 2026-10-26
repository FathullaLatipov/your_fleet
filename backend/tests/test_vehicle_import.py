"""Carrier fleet xlsx import and document warnings."""
from datetime import timedelta

import openpyxl
from sqlalchemy import select

from app.api.fleet import vehicle_warnings
from app.models import UserRole, Vehicle, VehicleStatus, utcnow
from app.services.vehicle_import import import_vehicles_xlsx
from tests.test_api import client, login, make_user  # noqa: F401

HEADERS = ["Make", "Model", "Unit number", "Plate number", "Vin", "Year", "State",
           "MC number", "Operator (driver)", "Owner name", "Odometer", "Trailer",
           "Status", "Fleet Status", "Aging days", "Tags", "Notes", "Warnings"]


def make_xlsx(tmp_path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(HEADERS)
    for r in rows:
        ws.append(r)
    p = tmp_path / "trucks.xlsx"
    wb.save(p)
    return str(p)


ROW_A = ["FRHT", "Cascadia", "4300", "TEmp..", "3AKJHHDR9MSMF4300", 2021, "Ohio",
         "VKL TRUCKING INC", "MANNIE BROWN", "Owner", 125000, "T-12",
         "available", "ACTIVE", 3, "west", "good truck", "No Insurance document"]
ROW_B = ["INTL", "TT", "55", ",,..,,..", "3HSDJSNRXFN731060", 2015, "Indiana",
         "VKL TRUCKING INC", "JOSE SUAREZ", "Owner", 0, "",
         "in_transit", "INACTIVE", "", "", "", ""]


class TestVehicleImport:
    def test_import_creates_vehicles_with_fields(self, db, tmp_path):
        owner = make_user(db, "imp-fleet@example.com", role=UserRole.FLEET_MANAGER)
        report = import_vehicles_xlsx(db, owner, make_xlsx(tmp_path, [ROW_A, ROW_B]))
        assert report["created"] == 2 and not report["issues"]
        v = db.execute(select(Vehicle).where(Vehicle.unit_number == "4300")).scalar_one()
        assert (v.make, v.model, v.year, v.state) == ("FRHT", "Cascadia", 2021, "Ohio")
        assert v.mc_number == "VKL TRUCKING INC"
        assert v.operator_name == "MANNIE BROWN"
        assert v.ownership == "Owner" and v.trailer_unit == "T-12"
        assert v.dispatch_status == "available" and v.tags == "west"
        assert v.odometer_miles == 125000 and v.odometer_source == "import"
        # junk plate placeholders are dropped, zero odometer means untracked
        b = db.execute(select(Vehicle).where(Vehicle.unit_number == "55")).scalar_one()
        assert b.license_plate is None and b.odometer_miles is None
        assert b.status == VehicleStatus.INACTIVE  # Fleet Status != ACTIVE

    def test_reimport_upserts_and_odometer_never_regresses(self, db, tmp_path):
        owner = make_user(db, "imp-fleet2@example.com", role=UserRole.FLEET_MANAGER)
        import_vehicles_xlsx(db, owner, make_xlsx(tmp_path, [ROW_A]))
        lower = list(ROW_A)
        lower[10] = 90000  # odometer lower than before
        lower[8] = "NEW DRIVER"
        report = import_vehicles_xlsx(db, owner, make_xlsx(tmp_path, [lower]))
        assert report["updated"] == 1 and report["created"] == 0
        v = db.execute(select(Vehicle).where(Vehicle.unit_number == "4300")).scalar_one()
        assert v.operator_name == "NEW DRIVER"
        assert v.odometer_miles == 125000  # kept the higher reading

    def test_dry_run_persists_nothing(self, db, tmp_path):
        owner = make_user(db, "imp-fleet3@example.com", role=UserRole.FLEET_MANAGER)
        report = import_vehicles_xlsx(db, owner, make_xlsx(tmp_path, [ROW_A]), dry_run=True)
        assert report["created"] == 1
        assert db.execute(select(Vehicle)).scalars().first() is None


class TestWarnings:
    def test_warnings_cover_documents_and_vin(self):
        v = Vehicle(unit_number="1", vin=None,
                    insurance_expires_at=utcnow() - timedelta(days=3),
                    inspection_expires_at=utcnow() + timedelta(days=10))
        w = vehicle_warnings(v)
        assert any("Insurance expired" in x for x in w)
        assert any("Inspection expires in" in x for x in w)
        assert "No VIN on file" in w

    def test_no_warnings_when_documents_current(self):
        v = Vehicle(unit_number="1", vin="3AKJHHDR9MSMF4300",
                    insurance_expires_at=utcnow() + timedelta(days=200),
                    inspection_expires_at=utcnow() + timedelta(days=200))
        assert vehicle_warnings(v) == []
