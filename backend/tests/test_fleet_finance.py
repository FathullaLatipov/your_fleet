"""Loans: amortization math, CRUD, monthly cost roll-up, RBAC."""
from datetime import datetime, timedelta, timezone

from app.models import UserRole, VehicleExpense, ExpenseCategory, utcnow
from tests.test_api import client, login, make_user  # noqa: F401
from tests.test_fleet import add_vehicle, fleet_user

LOAN = {
    "lender": "Crossroads Equipment Credit",
    "purchase_price_cents": 18800000,
    "down_payment_cents": 2000000,
    "principal_cents": 16800000,   # $168,000
    "apr": 8.9,
    "term_months": 60,
    "start_date": "2024-02-15T00:00:00Z",
}


class TestLoans:
    def test_upsert_and_schedule_math(self, client, db):
        _, h = fleet_user(client, db, "loan1@example.com")
        v = add_vehicle(client, h, unit="L1")
        r = client.put(f"/api/fleet/vehicles/{v['id']}/loan", headers=h, json=LOAN)
        assert r.status_code == 200
        body = r.json()
        # Annuity payment for $168k, 8.9% APR, 60 months is about $3,480.93
        assert abs(body["payment_cents"] - 348093) <= 200
        assert len(body["schedule"]) == 60
        first = body["schedule"][0]
        # First month interest = 168000 * 8.9%/12 = $1,246
        assert abs(first["interest_cents"] - 124600) <= 100
        assert first["payment_cents"] == body["payment_cents"]
        # Final payment clears the balance exactly
        assert body["schedule"][-1]["balance_cents"] == 0
        # Payments due before today count as paid
        assert body["paid_count"] >= 30
        assert body["next_due"] is not None
        assert body["remaining_cents"] > 0
        # Update (same endpoint) changes terms in place
        r2 = client.put(f"/api/fleet/vehicles/{v['id']}/loan", headers=h,
                        json={**LOAN, "apr": 0.0})
        assert r2.json()["payment_cents"] == 280000  # 168k / 60, zero interest

    def test_list_and_delete(self, client, db):
        _, h = fleet_user(client, db, "loan2@example.com")
        v1 = add_vehicle(client, h, unit="L2")
        add_vehicle(client, h, unit="L3")  # unfinanced
        client.put(f"/api/fleet/vehicles/{v1['id']}/loan", headers=h, json=LOAN)
        r = client.get("/api/fleet/loans", headers=h).json()
        assert len(r["loans"]) == 1
        assert r["totals"]["monthly_cents"] == r["loans"][0]["payment_cents"]
        assert any(u["unit_number"] == "L3" for u in r["unfinanced_units"])
        assert client.delete(f"/api/fleet/vehicles/{v1['id']}/loan",
                             headers=h).status_code == 204
        assert client.get(f"/api/fleet/vehicles/{v1['id']}/loan",
                          headers=h).status_code == 404

    def test_monthly_costs(self, client, db):
        owner, h = fleet_user(client, db, "loan3@example.com")
        v = add_vehicle(client, h, unit="L4")
        client.put(f"/api/fleet/vehicles/{v['id']}/loan", headers=h, json=LOAN)
        client.post("/api/fleet/trailers", headers=h, json={
            "unit_number": "T-9", "ownership": "leased", "lease_cents_monthly": 115000,
        })
        db.add(VehicleExpense(vehicle_id=v["id"], category=ExpenseCategory.REPAIR,
                              description="Brake job", amount_cents=140000,
                              created_by=owner.id, incurred_at=utcnow()))
        db.commit()
        r = client.get("/api/fleet/finance/monthly", headers=h).json()
        assert len(r["months"]) == 6
        last = r["months"][-1]
        assert last["repairs_cents"] == 140000
        assert last["leases_cents"] == 115000
        assert last["loans_cents"] == r["loan_monthly_cents"] > 0
        assert last["total_cents"] == sum(
            last[k] for k in ("repairs_cents", "loans_cents", "leases_cents"))
        assert r["leased_trailers"] == 1

    def test_rbac_and_ownership(self, client, db):
        _, h = fleet_user(client, db, "loan4@example.com")
        v = add_vehicle(client, h, unit="L5")
        client.put(f"/api/fleet/vehicles/{v['id']}/loan", headers=h, json=LOAN)
        make_user(db, "loan-prov@example.com", role=UserRole.PROVIDER)
        hp = login(client, "loan-prov@example.com")
        assert client.get("/api/fleet/loans", headers=hp).status_code == 403
        _, h2 = fleet_user(client, db, "loan5@example.com")
        # Another carrier can't see this truck's loan (403 from _own_vehicle)
        assert client.get(f"/api/fleet/vehicles/{v['id']}/loan",
                          headers=h2).status_code == 403
