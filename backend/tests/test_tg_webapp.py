"""Telegram Mini App (PTI web app): initData auth, context, submit with photos."""
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

from app.models import InspectionDefect, PreTripInspection, TelegramLink, Vehicle
from sqlalchemy import select
from tests.test_api import client  # noqa: F401
from tests.test_fleet import fleet_user

TOKEN = "123456:TEST_BOT_TOKEN_abcdef"


def make_init_data(user_id: int, name: str = "Rick") -> str:
    fields = {
        "user": json.dumps({"id": user_id, "first_name": name}),
        "auth_date": str(int(time.time())),
        "query_id": "AAEx",
    }
    check = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


class TestTgWebApp:
    def test_context_returns_trucks_and_checklist(self, client, db, monkeypatch):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
        u, _ = fleet_user(client, db, "tgw1@example.com")
        db.add(Vehicle(owner_user_id=u.id, unit_number="043"))
        db.add(TelegramLink(chat_id=4242, owner_user_id=u.id, driver_name="Rick"))
        db.commit()
        r = client.post("/api/tg/context", data={"init_data": make_init_data(4242)})
        assert r.status_code == 200
        body = r.json()
        assert body["driver_name"] == "Rick"
        assert any(t["unit_number"] == "043" for t in body["trucks"])
        assert len(body["checklist"]) >= 5

    def test_invalid_init_data_rejected(self, client, db, monkeypatch):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
        r = client.post("/api/tg/context", data={"init_data": "user=%7B%7D&hash=bad"})
        assert r.status_code == 401

    def test_not_linked_is_403(self, client, db, monkeypatch):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
        r = client.post("/api/tg/context", data={"init_data": make_init_data(9999)})
        assert r.status_code == 403 and r.json()["detail"] == "not_linked"

    def test_submit_saves_pti_photo_and_defect(self, client, db, monkeypatch, tmp_path):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
        monkeypatch.setattr("app.api.tg.get_settings",
                            lambda: type("S", (), {"media_dir": str(tmp_path)})())
        u, _ = fleet_user(client, db, "tgw2@example.com")
        veh = Vehicle(owner_user_id=u.id, unit_number="07")
        db.add(veh)
        db.add(TelegramLink(chat_id=5555, owner_user_id=u.id, driver_name="Sam"))
        db.commit()
        payload = {
            "vehicle_id": str(veh.id), "inspection_type": "pre", "overall": "found_issue",
            "items": [
                {"key": "brakes", "label": "Brakes", "status": "defect", "note": "soft pedal"},
                {"key": "tires", "label": "Tires", "status": "ok"},
            ],
        }
        r = client.post("/api/tg/submit",
                        data={"init_data": make_init_data(5555), "payload": json.dumps(payload)},
                        files=[("photos", ("brakes__0.jpg", b"\xff\xd8\xff\xe0jpegdata", "image/jpeg"))])
        assert r.status_code == 200, r.text
        assert r.json()["result"] == "fail" and r.json()["defects"] == 1 and r.json()["photos"] == 1

        pti = db.execute(select(PreTripInspection).where(PreTripInspection.owner_user_id == u.id)).scalar_one()
        assert pti.unit_number == "07" and pti.result == "fail" and pti.inspection_type == "pre"
        brakes = next(i for i in pti.items if i["key"] == "brakes")
        assert brakes["status"] == "defect" and brakes["photos"] and brakes["photos"][0].startswith("/media/pti/")
        # Photo file was written.
        assert (tmp_path / "pti" / str(pti.id) / "brakes__0.jpg").exists()
        # Defect created on the truck.
        d = db.execute(select(InspectionDefect).where(InspectionDefect.vehicle_id == veh.id)).scalar_one()
        assert d.source == "telegram_pti" and "soft pedal" in (d.comment or "")

    def test_submit_all_ok_passes(self, client, db, monkeypatch, tmp_path):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
        monkeypatch.setattr("app.api.tg.get_settings",
                            lambda: type("S", (), {"media_dir": str(tmp_path)})())
        u, _ = fleet_user(client, db, "tgw3@example.com")
        veh = Vehicle(owner_user_id=u.id, unit_number="88")
        db.add(veh)
        db.add(TelegramLink(chat_id=6666, owner_user_id=u.id, driver_name="Lee"))
        db.commit()
        payload = {"vehicle_id": str(veh.id), "inspection_type": "post", "overall": "all_good",
                   "items": [{"key": "tires", "label": "Tires", "status": "ok"}]}
        r = client.post("/api/tg/submit",
                        data={"init_data": make_init_data(6666), "payload": json.dumps(payload)})
        assert r.status_code == 200 and r.json()["result"] == "pass"
        pti = db.execute(select(PreTripInspection).where(PreTripInspection.owner_user_id == u.id)).scalar_one()
        assert pti.inspection_type == "post" and pti.defect_count == 0
