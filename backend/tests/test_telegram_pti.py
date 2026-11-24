"""Driver PTI Telegram flow: link, run the checklist, persist defects."""
from app.models import DriverLinkCode, InspectionDefect, PreTripInspection, TelegramLink, Vehicle
from app.services import telegram as tg
from sqlalchemy import select
from tests.test_api import client  # noqa: F401
from tests.test_fleet import fleet_user


class FakeClient:
    def __init__(self):
        self.sent = []

    def send_message(self, chat_id, text, buttons=None):
        self.sent.append((chat_id, text))

    def answer_callback(self, *a, **k):
        pass


def _msg(uid, chat_id, text, uname="rick"):
    return {"update_id": uid, "message": {"chat": {"id": chat_id},
            "from": {"first_name": "Rick", "username": uname}, "text": text}}


def _cb(uid, chat_id, data):
    return {"update_id": uid, "callback_query": {"id": f"c{uid}", "data": data,
            "message": {"chat": {"id": chat_id}}}}


class TestTelegramPti:
    def test_full_flow_creates_pti_and_defect(self, client, db):
        u, _ = fleet_user(client, db, "tg1@example.com")
        veh = Vehicle(owner_user_id=u.id, unit_number="043")
        db.add(veh)
        code = DriverLinkCode(owner_user_id=u.id, code="ABCD2345")
        db.add(code)
        db.commit()

        fc = FakeClient()
        states: dict = {}
        chat = 555

        tg.handle_update(db, states, _msg(1, chat, "/start ABCD2345"), fc)
        link = db.execute(select(TelegramLink).where(TelegramLink.chat_id == chat)).scalar_one()
        assert link.owner_user_id == u.id and link.driver_name == "Rick"

        tg.handle_update(db, states, _msg(2, chat, "/pti"), fc)
        assert states[chat].stage == "await_unit"
        tg.handle_update(db, states, _msg(3, chat, "043"), fc)
        assert states[chat].stage == "checklist" and states[chat].unit_number == "043"

        # First item -> defect with a note; the rest OK.
        uid = 10
        tg.handle_update(db, states, _cb(uid, chat, "pti:defect"), fc); uid += 1
        assert states[chat].stage == "await_note"
        tg.handle_update(db, states, _msg(uid, chat, "Low tread, needs replacing"), fc); uid += 1
        # Remaining items (len-1) all OK.
        for _ in range(len(tg.PTI_ITEMS) - 1):
            tg.handle_update(db, states, _cb(uid, chat, "pti:ok"), fc); uid += 1

        pti = db.execute(select(PreTripInspection).where(PreTripInspection.owner_user_id == u.id)).scalar_one()
        assert pti.result == "fail" and pti.defect_count == 1
        assert pti.unit_number == "043" and len(pti.items) == len(tg.PTI_ITEMS)
        defects = db.execute(select(InspectionDefect).where(InspectionDefect.vehicle_id == veh.id)).scalars().all()
        assert len(defects) == 1 and defects[0].source == "telegram_pti"
        assert "Low tread" in (defects[0].comment or "")
        # The bot confirmed completion.
        assert any("PTI complete" in t for _, t in fc.sent)

    def test_all_ok_passes_no_defects(self, client, db):
        u, _ = fleet_user(client, db, "tg2@example.com")
        veh = Vehicle(owner_user_id=u.id, unit_number="07")
        db.add(veh)
        db.add(DriverLinkCode(owner_user_id=u.id, code="PASS2345"))
        db.commit()
        fc = FakeClient(); states: dict = {}; chat = 777
        tg.handle_update(db, states, _msg(1, chat, "/start PASS2345"), fc)
        tg.handle_update(db, states, _msg(2, chat, "/pti"), fc)
        tg.handle_update(db, states, _msg(3, chat, "07"), fc)
        uid = 10
        for _ in range(len(tg.PTI_ITEMS)):
            tg.handle_update(db, states, _cb(uid, chat, "pti:ok"), fc); uid += 1
        pti = db.execute(select(PreTripInspection).where(PreTripInspection.owner_user_id == u.id)).scalar_one()
        assert pti.result == "pass" and pti.defect_count == 0
        assert db.execute(select(InspectionDefect).where(InspectionDefect.vehicle_id == veh.id)).first() is None

    def test_bad_code_and_unknown_unit(self, client, db):
        u, _ = fleet_user(client, db, "tg3@example.com")
        db.add(Vehicle(owner_user_id=u.id, unit_number="99"))
        db.add(DriverLinkCode(owner_user_id=u.id, code="GOOD2345"))
        db.commit()
        fc = FakeClient(); states: dict = {}; chat = 888
        tg.handle_update(db, states, _msg(1, chat, "/start WRONGCOD"), fc)
        assert db.execute(select(TelegramLink).where(TelegramLink.chat_id == chat)).first() is None
        assert any("invalid or expired" in t for _, t in fc.sent)
        # Link properly, then give a wrong unit.
        tg.handle_update(db, states, _msg(2, chat, "/start GOOD2345"), fc)
        tg.handle_update(db, states, _msg(3, chat, "/pti"), fc)
        tg.handle_update(db, states, _msg(4, chat, "123"), fc)
        assert states[chat].stage == "await_unit"  # still waiting
        assert any("No truck" in t for _, t in fc.sent)

    def test_link_code_and_pti_endpoints(self, client, db):
        u, h = fleet_user(client, db, "tg4@example.com")
        r = client.post("/api/fleet/telegram/link-code", headers=h, json={"driver_name": "Sam"})
        assert r.status_code == 200
        code = r.json()["code"]
        assert len(code) == 8
        row = db.execute(select(DriverLinkCode).where(DriverLinkCode.code == code)).scalar_one()
        assert row.owner_user_id == u.id and row.driver_name == "Sam"

        st = client.get("/api/fleet/telegram/status", headers=h).json()
        assert st["linked_count"] == 0 and "configured" in st
        # Drive one inspection through the bot, then it shows up in the list.
        veh = Vehicle(owner_user_id=u.id, unit_number="500")
        db.add(veh); db.commit()
        fc = FakeClient(); states: dict = {}; chat = 999
        tg.handle_update(db, states, _msg(1, chat, f"/start {code}"), fc)
        tg.handle_update(db, states, _msg(2, chat, "/pti"), fc)
        tg.handle_update(db, states, _msg(3, chat, "500"), fc)
        uid = 10
        for _ in range(len(tg.PTI_ITEMS)):
            tg.handle_update(db, states, _cb(uid, chat, "pti:ok"), fc); uid += 1
        pti_list = client.get("/api/fleet/pti", headers=h).json()
        assert len(pti_list) == 1 and pti_list[0]["unit_number"] == "500" and pti_list[0]["result"] == "pass"
        assert client.get("/api/fleet/telegram/status", headers=h).json()["linked_count"] == 1
