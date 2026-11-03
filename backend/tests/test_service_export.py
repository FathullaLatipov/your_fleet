"""Service-records export: formats, period filter, RBAC."""
from datetime import timedelta

from app.models import ExpenseCategory, UserRole, VehicleExpense, utcnow
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user


def seed(client, db, email="exp-fleet@example.com"):
    owner, h = fleet_user(client, db, email)
    v = add_vehicle(client, h, unit="EX1")
    old = VehicleExpense(vehicle_id=v["id"], category=ExpenseCategory.TIRES,
                         description="Old tire job", amount_cents=50000,
                         created_by=owner.id, incurred_at=utcnow() - timedelta(days=200))
    recent = VehicleExpense(vehicle_id=v["id"], category=ExpenseCategory.REPAIR,
                            description="Recent brake job", amount_cents=70000,
                            created_by=owner.id, incurred_at=utcnow() - timedelta(days=5))
    db.add_all([old, recent])
    db.commit()
    return h


class TestServiceExport:
    def test_xlsx_download(self, client, db):
        h = seed(client, db)
        r = client.get("/api/fleet/service-records/export", headers=h,
                       params={"format": "xlsx"})
        assert r.status_code == 200
        assert r.content[:2] == b"PK"  # zip/xlsx magic
        assert "spreadsheetml" in r.headers["content-type"]
        assert 'filename="service-records_' in r.headers["content-disposition"]

    def test_pdf_download(self, client, db):
        h = seed(client, db, "exp-fleet2@example.com")
        r = client.get("/api/fleet/service-records/export", headers=h,
                       params={"format": "pdf"})
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"
        assert r.headers["content-type"] == "application/pdf"

    def test_period_filter_limits_rows(self, client, db):
        h = seed(client, db, "exp-fleet3@example.com")
        date_from = (utcnow() - timedelta(days=30)).date().isoformat()
        rows_all = client.get("/api/fleet/service-records", headers=h).json()
        assert len(rows_all) == 2
        r = client.get("/api/fleet/service-records/export", headers=h,
                       params={"format": "xlsx", "date_from": date_from})
        # The recent $700 row is inside the window, the old $500 one is not.
        import io

        import openpyxl
        ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
        text = "\n".join(str(c.value) for row in ws.iter_rows() for c in row if c.value)
        assert "Recent brake job" in text and "Old tire job" not in text

    def test_bad_format_rejected(self, client, db):
        h = seed(client, db, "exp-fleet4@example.com")
        assert client.get("/api/fleet/service-records/export", headers=h,
                          params={"format": "docx"}).status_code == 422

    def test_provider_forbidden(self, client, db):
        make_user(db, "exp-prov@example.com", role=UserRole.PROVIDER)
        hp = login(client, "exp-prov@example.com")
        assert client.get("/api/fleet/service-records/export", headers=hp).status_code == 403
