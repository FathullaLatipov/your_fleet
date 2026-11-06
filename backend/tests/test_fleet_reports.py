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

    def test_workorders_report_by_service_type(self, client, db):
        from app.models import WorkOrder, WorkOrderStatus

        h, v = seed(client, db, "rep-wo@example.com")
        for stype, cents in (("towing", 65000), ("truck_wash", 9000), ("towing", 40000)):
            wo = client.post("/api/fleet/work-orders", headers=h, json={
                "vehicle_id": v["id"], "service_type": stype, "priority": "urgent",
                "description": f"{stype} job"}).json()
            row = db.get(WorkOrder, wo["id"])
            row.status = WorkOrderStatus.CLOSED
            row.closed_at = utcnow()
            row.final_amount_cents = cents
        db.commit()

        rep = client.get(f"{BASE}/workorders", headers=h, params={"period": "all"}).json()
        rows = rep["sections"][0]["rows"]
        assert {r[3] for r in rows} == {"Towing", "Truck wash"}
        by_type = {r[0]: (r[1], r[2]) for r in rep["sections"][1]["rows"]}
        assert by_type == {"Towing": (2, 105000), "Truck wash": (1, 9000)}

        # Filter to one service type
        rep = client.get(f"{BASE}/workorders", headers=h,
                         params={"period": "all", "service_type": "towing"}).json()
        assert len(rep["sections"]) == 1
        assert {r[3] for r in rep["sections"][0]["rows"]} == {"Towing"}
        assert ["Service type", "Towing"] in rep["summary"]

        # Catalog exposes the list for the filter
        cat = client.get(BASE, headers=h).json()
        assert {"key": "order_parts", "label": "Order parts"} in cat["service_types"]

    def test_old_priority_and_type_rejected(self, client, db):
        h, v = seed(client, db, "rep-old@example.com")
        for body in ({"priority": "roadside"}, {"service_type": "preventive"}):
            r = client.post("/api/fleet/work-orders", headers=h, json={
                "vehicle_id": v["id"], "description": "Old values", **body})
            assert r.status_code == 422

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
