"""Normalization helpers. Originals are always preserved; these produce
comparison keys and canonical formats alongside them."""
from __future__ import annotations

import math
import re

_SUFFIXES = re.compile(
    r"\b(llc|inc|co|corp|corporation|company|ltd|incorporated)\b\.?", re.I
)
_NON_ALNUM = re.compile(r"[^a-z0-9 ]+")
_WS = re.compile(r"\s+")


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    s = name.lower().replace("&", " and ")
    s = _SUFFIXES.sub(" ", s)
    s = _NON_ALNUM.sub(" ", s)
    return _WS.sub(" ", s).strip()


def normalize_phone(phone: str | None) -> str | None:
    """Return E.164 (+1XXXXXXXXXX) for US numbers, or None if not recognizable."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"+1{digits}"
    return None


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def valid_coords(lat: float | None, lng: float | None) -> bool:
    if lat is None or lng is None:
        return False
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return False
    if lat == 0 and lng == 0:
        return False
    return True
