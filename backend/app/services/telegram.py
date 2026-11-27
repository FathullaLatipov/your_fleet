"""Shared Telegram bot for driver pre-trip inspections (PTI/DVIR).

One bot serves every carrier; a driver links their chat with a per-company
code (/start <code>), then runs a checklist with /pti. Failed items are saved
as InspectionDefect rows so they surface on the truck in YourFleet.

Transport is long-polling (getUpdates) from a worker — no public webhook/HTTPS
needed. Conversation state is kept in memory in the worker; a completed PTI is
persisted. The HTTP layer is a thin wrapper so the flow can be unit-tested.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from datetime import timezone
from urllib.parse import parse_qsl

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DriverLinkCode, TelegramLink, utcnow

API = "https://api.telegram.org"

# The pre-trip checklist. (key, label) — keep labels <= 64 chars (defect_type).
PTI_ITEMS: list[tuple[str, str]] = [
    ("brakes", "Brakes"),
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

    def send_webapp_button(self, chat_id: int, text: str, button_text: str, url: str) -> None:
        self._call("sendMessage", {
            "chat_id": chat_id, "text": text, "parse_mode": "HTML",
            "reply_markup": {"inline_keyboard": [[{"text": button_text, "web_app": {"url": url}}]]},
        })

    def set_menu_button(self, text: str, url: str) -> None:
        try:
            self._call("setChatMenuButton", {
                "menu_button": {"type": "web_app", "text": text, "web_app": {"url": url}}})
        except httpx.HTTPError:
            pass


HELP = ("👋 This is the YourFleet driver bot.\n\n"
        "• <b>/start &lt;code&gt;</b> — connect to your carrier (ask dispatch for the code)\n"
        "• <b>/pti</b> — open your pre-trip inspection")


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
    # Single-use: once a chat claims a code, only that chat may reuse it.
    if row.used_by_chat_id is not None and row.used_by_chat_id != chat_id:
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
    row.used_at = row.used_at or utcnow()
    row.used_by_chat_id = chat_id
    db.commit()
    return link


def handle_update(db: Session, states: dict, update: dict, client: TelegramClient) -> None:
    """Handle one Telegram update: connect a driver and launch the Mini App.
    The inspection itself runs in the web app, so there is no chat checklist.
    `states` is unused (kept for the worker's call signature)."""
    cb = update.get("callback_query")
    if cb:
        client.answer_callback(cb.get("id", ""))
        return
    msg = update.get("message")
    if not msg:
        return
    chat_id = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    frm = msg.get("from") or {}
    tg_name = ((frm.get("first_name") or "")
               + (f" {frm.get('last_name')}" if frm.get("last_name") else "")).strip()
    tg_username = frm.get("username")

    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) == 2 and parts[1].strip():
            link = _link(db, chat_id, parts[1], tg_name, tg_username)
            if link is None:
                client.send_message(chat_id, "❌ That code is invalid or expired. Ask dispatch for a new one.")
            else:
                client.send_webapp_button(
                    chat_id, f"✅ Connected, {link.driver_name}! Tap below to start an inspection 👇",
                    "🔧 Start inspection", mini_app_url())
        else:
            client.send_message(chat_id, HELP)
        return

    if text == "/pti":
        link = db.execute(
            select(TelegramLink).where(TelegramLink.chat_id == chat_id)).scalar_one_or_none()
        if link is None:
            client.send_message(chat_id, "You're not connected yet. Send <b>/start &lt;code&gt;</b> (ask dispatch).")
            return
        client.send_webapp_button(chat_id, "Tap below to start your inspection 👇",
                                  "🔧 Start inspection", mini_app_url())
        return

    client.send_message(chat_id, HELP)


def mini_app_url() -> str:
    from app.config import get_settings
    return f"{get_settings().frontend_url.rstrip('/')}/tg/pti"


def make_client() -> TelegramClient:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set.")
    return TelegramClient(token)


def validate_init_data(init_data: str, max_age_seconds: int = 86400) -> dict | None:
    """Verify a Telegram Web App initData string and return the parsed user.

    The hash is HMAC-SHA256 of the sorted data-check-string, keyed by
    HMAC-SHA256("WebAppData", bot_token). Returns {"id", "name", "username",
    "auth_date"} when valid and fresh, else None.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token or not init_data:
        return None
    try:
        pairs = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        return None
    received = pairs.pop("hash", None)
    if not received:
        return None
    check = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    calc = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc, received):
        return None
    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        auth_date = 0
    if max_age_seconds and auth_date and (time.time() - auth_date) > max_age_seconds:
        return None
    try:
        user = json.loads(pairs.get("user") or "null")
    except ValueError:
        user = None
    if not user or "id" not in user:
        return None
    name = " ".join(x for x in [user.get("first_name"), user.get("last_name")] if x).strip()
    return {"id": int(user["id"]), "name": name or "Driver",
            "username": user.get("username"), "auth_date": auth_date}
