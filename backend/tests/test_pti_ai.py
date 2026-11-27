"""AI defect suggestions on inspections: Gemini gating + confirm/dismiss."""
from app.models import InspectionDefect, PreTripInspection, Vehicle
from app.services import gemini
from sqlalchemy import select
from tests.test_api import client  # noqa: F401
from tests.test_fleet import fleet_user


def test_gemini_idle_without_key_returns_none():
    # No GEMINI_API_KEY in the test settings -> no network call, no suggestion.
    assert gemini.analyze_photo(b"\xff\xd8\xffdata", "Brakes") is None


def _pti_with_ai(db, owner_id, vehicle_id, unit):
    pti = PreTripInspection(
        owner_user_id=owner_id, vehicle_id=vehicle_id, unit_number=unit,
        driver_name="Rick", inspection_type="pre", result="pass", defect_count=0,
        items=[
            {"key": "brakes", "label": "Brakes", "status": "ok", "note": "", "photos": ["/media/pti/x/a.jpg"],
             "ai": {"defect": True, "severity": "major", "description": "cracked brake line"}},
            {"key": "tires", "label": "Tires", "status": "ok", "note": "", "photos": []},
        ])
    db.add(pti)
    db.commit()
    return pti


class TestPtiAi:
    def test_confirm_creates_defect(self, client, db):
        u, h = fleet_user(client, db, "ai1@example.com")
        veh = Vehicle(owner_user_id=u.id, unit_number="07")
        db.add(veh); db.commit()
        pti = _pti_with_ai(db, u.id, veh.id, "07")

        r = client.post(f"/api/fleet/pti/{pti.id}/items/brakes/confirm", headers=h)
        assert r.status_code == 200
        body = r.json()
        assert body["result"] == "fail" and body["defect_count"] == 1
        brakes = next(i for i in body["items"] if i["key"] == "brakes")
        assert brakes["status"] == "defect" and "cracked brake line" in brakes["note"]
        assert "ai" not in brakes  # suggestion consumed
        d = db.execute(select(InspectionDefect).where(InspectionDefect.vehicle_id == veh.id)).scalar_one()
        assert d.source == "telegram_pti" and d.severity == "major"

    def test_dismiss_clears_suggestion(self, client, db):
        u, h = fleet_user(client, db, "ai2@example.com")
        veh = Vehicle(owner_user_id=u.id, unit_number="08")
        db.add(veh); db.commit()
        pti = _pti_with_ai(db, u.id, veh.id, "08")

        r = client.post(f"/api/fleet/pti/{pti.id}/items/brakes/dismiss", headers=h)
        assert r.status_code == 200
        brakes = next(i for i in r.json()["items"] if i["key"] == "brakes")
        assert "ai" not in brakes and brakes["status"] == "ok"
        assert db.execute(select(InspectionDefect).where(InspectionDefect.vehicle_id == veh.id)).first() is None

    def test_confirm_other_owner_404(self, client, db):
        u1, _ = fleet_user(client, db, "ai3a@example.com")
        _, h2 = fleet_user(client, db, "ai3b@example.com")
        veh = Vehicle(owner_user_id=u1.id, unit_number="09")
        db.add(veh); db.commit()
        pti = _pti_with_ai(db, u1.id, veh.id, "09")
        r = client.post(f"/api/fleet/pti/{pti.id}/items/brakes/confirm", headers=h2)
        assert r.status_code == 404
