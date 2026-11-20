"""Reversible encryption for third-party API tokens at rest.

Integration tokens (Samsara, …) must be read back to call the provider, so they
can't be hashed. They're encrypted with Fernet (AES-128-CBC + HMAC) under a key
derived from INTEGRATIONS_SECRET (falling back to the app's JWT secret). Rotating
that secret invalidates stored tokens — users simply reconnect.
"""
from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    s = get_settings()
    secret = (getattr(s, "integrations_secret", "") or s.jwt_secret).encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: str | None) -> str | None:
    """Plaintext, or None if the value is missing or can't be decrypted
    (e.g. the signing secret changed)."""
    if not ciphertext:
        return None
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def last4(token: str) -> str:
    return token[-4:] if len(token) >= 4 else token
