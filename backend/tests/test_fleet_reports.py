"""Reports: catalog, JSON preview, XLSX/PDF downloads, filters, RBAC."""
import io

from app.models import ExpenseCategory, UserRole, VehicleExpense, utcnow
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user
from tests.test_fleet_finance import LOAN

BASE = "/api/fleet/reports"


def seed(client, db, email):
    owner, h = fleet_user(client, db, email)
    v = add_vehicle(client, h, unit="R1")
    client.put(f"/api/fleet/vehicles/{v['id']}/loan", headers=h, json=LOAN)
    db.add(VehicleExpense(vehicle_id=v["id"], category=ExpenseCategory.TIRES,
                          description="Steer tires (2)", amount_cents=118000,
                          created_by=owner.id, incurred_at=utcnow()))
    db.commit()
    return h, v


class TestReports:
    def test_catalog(self, client, db):
        h, v = seed(client, db, "rep1@example.com")
        r = client.get(BASE, headers=h).json()
        keys = {x["key"] for x in r["reports"]}
        assert {"loan", "maint", "cost", "compliance", "drivers", "workorders"} <= keys
        truck = next(t for t in r["trucks"] if t["vehicle_id"] == v["id"])
        assert truck["financed"] is True

    def test_json_preview_and_files(self, client, db):
        h, v = seed(client, db, "rep2@example.com")
        # JSON preview of the loan report
        r = client.get(f"{BASE}/loan", headers=h, params={"vehicle_id": v["id"]})
        assert r.status_code == 200
        rep = r.json()
        assert "Truck #R1" in rep["title"]
        assert len(rep["sections"]) == 2  # overview + schedule
        assert len(rep["sections"][1]["rows"]) == LOAN["term_months"]
        # XLSX parses and contains the data
        r = client.get(f"{BASE}/maint", headers=h, params={"format": "xlsx", "period": "all"})
        assert r.status_code == 200 and r.content[:2] == b"PK"
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(r.content))
        text = "\n".join(str(c.value) for ws in wb.worksheets
                         for row in ws.iter_rows() for c in row if c.value)
        assert "Steer tires (2)" in text
        # PDF magic
        r = client.get(f"{BASE}/cost", headers=h, params={"format": "pdf"})
        assert r.status_code == 200 and r.content[:5] == b"%PDF-"
        assert 'filename="YourFleet' in r.headers["content-disposition"]

    def test_unknown_report_and_rbac(self, client, db):
        h, _ = seed(client, db, "rep3@example.com")
        assert client.get(f"{BASE}/nope", headers=h).status_code == 404
        make_user(db, "rep-prov@example.com", role=UserRole.PROVIDER)
        hp = login(client, "rep-prov@example.com")
        assert client.get(BASE, headers=hp).status_code == 403

    def test_loan_report_without_loans_404(self, client, db):
        _, h = fleet_user(client, db, "rep4@example.com")
        add_vehicle(client, h, unit="R2")
        assert client.get(f"{BASE}/loan", headers=h).status_code == 404
