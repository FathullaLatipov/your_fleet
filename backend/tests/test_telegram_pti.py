"""Telegram bot: linking drivers and launching the Mini App. The inspection
itself runs in the web app (see test_tg_webapp)."""
from app.models import (
    DriverLinkCode,
    FleetDriver,
    PreTripInspection,
    TelegramLink,
    Vehicle,
)
from app.services import telegram as tg
from sqlalchemy import select
from tests.test_api import client  # noqa: F401
from tests.test_fleet import fleet_user


class FakeClient:
    def __init__(self):
        self.sent = []       # (chat_id, text)
        self.webapps = []    # (chat_id, url)

    def send_message(self, chat_id, text, buttons=None):
        self.sent.append((chat_id, text))

    def send_webapp_button(self, chat_id, text, button_text, url):
        self.sent.append((chat_id, text))
        self.webapps.append((chat_id, url))

    def answer_callback(self, *a, **k):
        pass


def _msg(uid, chat_id, text, uname="rick"):
    return {"update_id": uid, "message": {"chat": {"id": chat_id},
            "from": {"first_name": "Rick", "username": uname}, "text": text}}


class TestTelegramLinking:
    def test_start_links_and_offers_webapp(self, client, db):
        u, _ = fleet_user(client, db, "tg1@example.com")
        db.add(DriverLinkCode(owner_user_id=u.id, code="ABCD2345")); db.commit()
        fc = FakeClient(); states: dict = {}; chat = 555
        tg.handle_update(db, states, _msg(1, chat, "/start ABCD2345"), fc)
        link = db.execute(select(TelegramLink).where(TelegramLink.chat_id == chat)).scalar_one()
        assert link.owner_user_id == u.id and link.driver_name == "Rick"
        assert fc.webapps and fc.webapps[0][0] == chat  # offered the inspection web app

    def test_pti_without_link_prompts_connect(self, client, db):
        fc = FakeClient(); states: dict = {}
        tg.handle_update(db, states, _msg(1, 123, "/pti"), fc)
        assert any("not connected" in t for _, t in fc.sent)

    def test_bad_code_rejected(self, client, db):
        u, _ = fleet_user(client, db, "tg3@example.com")
        db.add(DriverLinkCode(owner_user_id=u.id, code="GOOD2345")); db.commit()
        fc = FakeClient(); states: dict = {}
        tg.handle_update(db, states, _msg(1, 888, "/start WRONGCOD"), fc)
        assert db.execute(select(TelegramLink).where(TelegramLink.chat_id == 888)).first() is None
        assert any("invalid or expired" in t for _, t in fc.sent)

    def test_link_code_and_status_endpoints(self, client, db):
        u, h = fleet_user(client, db, "tg4@example.com")
        r = client.post("/api/fleet/telegram/link-code", headers=h, json={"driver_name": "Sam"})
        assert r.status_code == 200 and len(r.json()["code"]) == 8
        code = r.json()["code"]
        assert db.execute(select(DriverLinkCode).where(DriverLinkCode.code == code)).scalar_one().driver_name == "Sam"

        fc = FakeClient(); states: dict = {}; chat = 999
        tg.handle_update(db, states, _msg(1, chat, f"/start {code}"), fc)
        st = client.get("/api/fleet/telegram/status", headers=h).json()
        assert st["linked_count"] == 1

        # A saved inspection (as the web app would create) shows in the list.
        db.add(PreTripInspection(owner_user_id=u.id, unit_number="500", driver_name="Sam",
                                 inspection_type="pre", result="pass", defect_count=0, items=[]))
        db.commit()
        lst = client.get("/api/fleet/pti", headers=h).json()
        assert len(lst) == 1 and lst[0]["unit_number"] == "500" and lst[0]["inspection_type"] == "pre"

        link_id = st["drivers"][0]["id"]
        assert client.delete(f"/api/fleet/telegram/links/{link_id}", headers=h).status_code == 204
        assert client.get("/api/fleet/telegram/status", headers=h).json()["linked_count"] == 0

    def test_code_is_single_use_per_chat(self, client, db):
        u, _ = fleet_user(client, db, "tg5@example.com")
        db.add(DriverLinkCode(owner_user_id=u.id, code="ONCE2345")); db.commit()
        fc = FakeClient(); states: dict = {}
        tg.handle_update(db, states, _msg(1, 111, "/start ONCE2345"), fc)
        assert db.execute(select(TelegramLink).where(TelegramLink.chat_id == 111)).first() is not None
        tg.handle_update(db, states, _msg(2, 111, "/start ONCE2345"), fc)  # same chat re-taps: ok
        assert db.execute(select(TelegramLink).where(TelegramLink.chat_id == 111)).first() is not None
        tg.handle_update(db, states, _msg(3, 222, "/start ONCE2345"), fc)  # a different chat: rejected
        assert db.execute(select(TelegramLink).where(TelegramLink.chat_id == 222)).first() is None

    def test_unlink_revokes_the_code(self, client, db):
        u, h = fleet_user(client, db, "tg6@example.com")
        code = client.post("/api/fleet/telegram/link-code", headers=h, json={}).json()["code"]
        fc = FakeClient(); states: dict = {}; chat = 1212
        tg.handle_update(db, states, _msg(1, chat, f"/start {code}"), fc)
        link_id = client.get("/api/fleet/telegram/status", headers=h).json()["drivers"][0]["id"]
        assert client.delete(f"/api/fleet/telegram/links/{link_id}", headers=h).status_code == 204
        tg.handle_update(db, states, _msg(2, chat, f"/start {code}"), fc)  # revoked code
        assert client.get("/api/fleet/telegram/status", headers=h).json()["linked_count"] == 0

    def test_link_code_rejects_foreign_driver(self, client, db):
        _, h1 = fleet_user(client, db, "tg7a@example.com")
        u2, _ = fleet_user(client, db, "tg7b@example.com")
        drv = FleetDriver(owner_user_id=u2.id, name="Theirs")
        db.add(drv); db.commit()
        r = client.post("/api/fleet/telegram/link-code", headers=h1, json={"driver_id": str(drv.id)})
        assert r.status_code == 404
