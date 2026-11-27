"""Gemini vision: suggest possible defects from an inspection photo.

Optional — idle unless GEMINI_API_KEY is set. It only ever SUGGESTS; a human
(manager) confirms before a defect is recorded. Uses the Generative Language
REST API (generativelanguage.googleapis.com) so there's no SDK dependency.
"""
from __future__ import annotations

import base64

import httpx

from app.config import get_settings

BASE = "https://generativelanguage.googleapis.com/v1beta"

_PROMPT = (
    "You are inspecting a commercial truck during a pre/post-trip inspection. "
    "This photo should show: {label}. Look for a clearly visible defect or "
    "safety issue (damage, leak, flat/low tire, cracked light or glass, missing "
    "or loose part, worn tread, etc.). Be conservative: only flag a problem that "
    "is clearly visible. Respond ONLY as JSON with keys: "
    '"defect" (true/false), "severity" ("minor"|"major" or null), '
    '"description" (a short phrase, or empty string).'
)


def is_configured() -> bool:
    return bool(get_settings().gemini_api_key)


def analyze_photo(image_bytes: bytes, item_label: str, mime: str = "image/jpeg") -> dict | None:
    """Return {"defect": bool, "severity": str|None, "description": str} or None
    if Gemini isn't configured or the call fails. Never raises."""
    s = get_settings()
    if not s.gemini_api_key or not image_bytes:
        return None
    body = {
        "contents": [{
            "parts": [
                {"text": _PROMPT.format(label=item_label)},
                {"inline_data": {"mime_type": mime,
                                 "data": base64.b64encode(image_bytes).decode("ascii")}},
            ],
        }],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"},
    }
    try:
        r = httpx.post(
            f"{BASE}/models/{s.gemini_model}:generateContent",
            params={"key": s.gemini_api_key}, json=body, timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        import json
        out = json.loads(text)
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        return None
    defect = bool(out.get("defect"))
    severity = out.get("severity")
    if severity not in ("minor", "major"):
        severity = "major" if defect else None
    return {
        "defect": defect,
        "severity": severity,
        "description": str(out.get("description") or "")[:300],
    }
