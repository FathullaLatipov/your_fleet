"""Shared Telegram bot for driver pre-trip inspections (PTI/DVIR).

One bot serves every carrier; a driver links their chat with a per-company
code (/start <code>), then runs a checklist with /pti. Failed items are saved
as InspectionDefect rows so they surface on the truck in YourFleet.

Transport is long-polling (getUpdates) from a worker — no public webhook/HTTPS
needed. Conversation state is kept in memory in the worker; a completed PTI is
persisted. The HTTP layer is a thin wrapper so the flow can be unit-tested.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    DriverLinkCode,
    InspectionDefect,
    PreTripInspection,
    TelegramLink,
    Vehicle,
    utcnow,
)

API = "https://api.telegram.org"

# The pre-trip checklist. (key, label) — keep labels <= 64 chars (defect_type).
PTI_ITEMS: list[tuple[str, str]] = [
    ("brakes", "Brakes (service & parking)"),
    ("tires", "Tires & wheels"),
    ("lights", "Lights & signals"),
    ("leaks", "Leaks / fluid levels"),
    ("mirrors", "Mirrors & windshield"),
    ("wipers", "Wipers & washer"),
    ("coupling", "Coupling / trailer connection"),
    ("emergency", "Emergency equipment (triangles, extinguisher)"),
    ("gauges", "Horn, gauges & warning lights"),
]


class TelegramClient:
    def __init__(self, token: str):
        self._token = token
        self._http = httpx.Client(base_url=f"{API}/bot{token}", timeout=65)

    def _call(self, method: str, payload: dict) -> dict:
        r = self._http.post(f"/{method}", json=payload)
        r.raise_for_status()
        return r.json()

    def get_updates(self, offset: int | None, timeout: int = 50) -> list[dict]:
        payload = {"timeout": timeout, "allowed_updates": ["message", "callback_query"]}
        if offset is not None:
            payload["offset"] = offset
        return self._call("getUpdates", payload).get("result", [])

    def send_message(self, chat_id: int, text: str,
                     buttons: list[tuple[str, str]] | None = None) -> None:
        payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        if buttons:
            payload["reply_markup"] = {
                "inline_keyboard": [[{"text": t, "callback_data": d} for t, d in buttons]]
            }
        self._call("sendMessage", payload)

    def answer_callback(self, callback_query_id: str, text: str = "") -> None:
        try:
            self._call("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text})
        except httpx.HTTPError:
            pass


@dataclass
class ConvState:
    stage: str = "idle"            # idle | await_unit | checklist | await_note
    owner_user_id: object = None
    driver_name: str = ""
    vehicle_id: object = None
    unit_number: str = ""
    idx: int = 0
    results: list[dict] = field(default_factory=list)


HELP = ("👋 This is the YourFleet driver bot.\n\n"
        "• <b>/start &lt;code&gt;</b> — connect to your carrier (ask dispatch for the code)\n"
        "• <b>/pti</b> — start a pre-trip inspection\n"
        "• <b>/cancel</b> — cancel the current inspection")


def _item_buttons() -> list[tuple[str, str]]:
    return [("✅ OK", "pti:ok"), ("⚠️ Defect", "pti:defect")]


def _send_item(client: TelegramClient, chat_id: int, st: ConvState) -> None:
    key, label = PTI_ITEMS[st.idx]
    client.send_message(
        chat_id,
        f"<b>Step {st.idx + 1}/{len(PTI_ITEMS)}</b> — {label}\n\nIs this OK?",
        buttons=_item_buttons(),
    )


def _finish(db: Session, client: TelegramClient, chat_id: int, st: ConvState) -> None:
    defects = [r for r in st.results if r["status"] == "defect"]
    result = "fail" if defects else "pass"
    pti = PreTripInspection(
        owner_user_id=st.owner_user_id, vehicle_id=st.vehicle_id,
        unit_number=st.unit_number, driver_name=st.driver_name, chat_id=chat_id,
        result=result, defect_count=len(defects), items=st.results, performed_at=utcnow(),
    )
    db.add(pti)
    if st.vehicle_id is not None:
        for d in defects:
            db.add(InspectionDefect(
                vehicle_id=st.vehicle_id, source="telegram_pti",
                defect_type=d["label"][:64], comment=d.get("note") or None,
                severity="major",
            ))
    db.commit()
    if defects:
        lines = "\n".join(f"• {d['label']}" + (f" — {d['note']}" if d.get("note") else "")
                          for d in defects)
        client.send_message(
            chat_id,
            f"⚠️ <b>PTI complete for #{st.unit_number}</b>\n"
            f"{len(defects)} defect(s) reported:\n{lines}\n\nDispatch has been notified.")
    else:
        client.send_message(
            chat_id, f"✅ <b>PTI complete for #{st.unit_number}</b>\nNo defects — all good. Safe travels!")
    st.stage = "idle"
    st.results = []


def _link(db: Session, chat_id: int, code: str, tg_name: str, tg_username: str | None) -> TelegramLink | None:
    row = db.execute(select(DriverLinkCode).where(DriverLinkCode.code == code.strip())).scalar_one_or_none()
    if row is None:
        return None
    if row.expires_at is not None:
        exp = row.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < utcnow():
            return None
    name = (row.driver_name or tg_name or "Driver").strip()
    link = db.execute(select(TelegramLink).where(TelegramLink.chat_id == chat_id)).scalar_one_or_none()
    if link is None:
        link = TelegramLink(chat_id=chat_id)
        db.add(link)
    link.owner_user_id = row.owner_user_id
    link.driver_id = row.driver_id
    link.driver_name = name
    link.telegram_username = tg_username
    link.linked_at = utcnow()
    db.commit()
    return link


def _match_vehicle(db: Session, owner_user_id, unit: str) -> Vehicle | None:
    u = unit.strip().lstrip("#").lower()
    return db.execute(
        select(Vehicle).where(
            Vehicle.owner_user_id == owner_user_id,
            func.lower(Vehicle.unit_number) == u,
        )
    ).scalar_one_or_none()


def handle_update(db: Session, states: dict, update: dict, client: TelegramClient) -> None:
    """Process one Telegram update (message or button press)."""
    cb = update.get("callback_query")
    if cb:
        _handle_callback(db, states, cb, client)
        return
    msg = update.get("message")
    if not msg:
        return
    chat_id = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    frm = msg.get("from") or {}
    tg_name = (frm.get("first_name") or "") + (f" {frm.get('last_name')}" if frm.get("last_name") else "")
    tg_username = frm.get("username")
    st = states.setdefault(chat_id, ConvState())

    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) == 2 and parts[1].strip():
            link = _link(db, chat_id, parts[1], tg_name.strip(), tg_username)
            if link is None:
                client.send_message(chat_id, "❌ That code is invalid or expired. Ask dispatch for a new one.")
            else:
                st.stage = "idle"
                client.send_message(
                    chat_id, f"✅ Connected, {link.driver_name}! Send <b>/pti</b> to start a pre-trip inspection.")
        else:
            client.send_message(chat_id, HELP)
        return

    if text == "/cancel":
        st.stage = "idle"
        st.results = []
        client.send_message(chat_id, "Inspection cancelled. Send /pti to start again.")
        return

    if text == "/pti":
        link = db.execute(select(TelegramLink).where(TelegramLink.chat_id == chat_id)).scalar_one_or_none()
        if link is None:
            client.send_message(chat_id, "You're not connected yet. Send <b>/start &lt;code&gt;</b> (ask dispatch).")
            return
        states[chat_id] = ConvState(stage="await_unit", owner_user_id=link.owner_user_id,
                                    driver_name=link.driver_name)
        client.send_message(chat_id, "Which truck? Reply with its <b>unit number</b> (e.g. 043).")
        return

    if st.stage == "await_unit":
        v = _match_vehicle(db, st.owner_user_id, text)
        if v is None:
            client.send_message(chat_id, f"No truck <b>#{text}</b> found. Check the unit number and reply again.")
            return
        st.vehicle_id = v.id
        st.unit_number = v.unit_number
        st.idx = 0
        st.results = []
        st.stage = "checklist"
        client.send_message(chat_id, f"Starting pre-trip inspection for <b>#{v.unit_number}</b>.")
        _send_item(client, chat_id, st)
        return

    if st.stage == "await_note":
        note = "" if text == "/skip" else text
        key, label = PTI_ITEMS[st.idx]
        st.results.append({"key": key, "label": label, "status": "defect", "note": note})
        st.idx += 1
        if st.idx >= len(PTI_ITEMS):
            _finish(db, client, chat_id, st)
        else:
            st.stage = "checklist"
            _send_item(client, chat_id, st)
        return

    client.send_message(chat_id, HELP)


def _handle_callback(db: Session, states: dict, cb: dict, client: TelegramClient) -> None:
    data = cb.get("data") or ""
    msg = cb.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    client.answer_callback(cb["id"])
    if chat_id is None:
        return
    st = states.get(chat_id)
    if st is None or st.stage != "checklist" or not data.startswith("pti:"):
        return
    action = data.split(":", 1)[1]
    key, label = PTI_ITEMS[st.idx]
    if action == "defect":
        st.stage = "await_note"
        client.send_message(chat_id, f"Describe the issue with <b>{label}</b> (reply with text), or send /skip.")
        return
    # OK
    st.results.append({"key": key, "label": label, "status": "ok", "note": ""})
    st.idx += 1
    if st.idx >= len(PTI_ITEMS):
        _finish(db, client, chat_id, st)
    else:
        _send_item(client, chat_id, st)


def make_client() -> TelegramClient:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set.")
    return TelegramClient(token)
