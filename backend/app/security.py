from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User, UserRole

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        return False


def create_access_token(user: User) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expires_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


RESET_TOKEN_TTL_MINUTES = 30


def _reset_key() -> str:
    # A separate signing key, so a reset link can never pass as an access token.
    return get_settings().jwt_secret + ":password-reset"


def _password_fingerprint(user: User) -> str:
    return hashlib.sha256(user.password_hash.encode("ascii")).hexdigest()[:32]


def create_password_reset_token(user: User) -> str:
    """Short-lived, single-use reset token.

    It carries a fingerprint of the current password hash, so it stops working
    the moment the password changes — no server-side token storage needed.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "fp": _password_fingerprint(user),
        "iat": now,
        "exp": now + timedelta(minutes=RESET_TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, _reset_key(), algorithm="HS256")


def user_for_reset_token(token: str, db: Session) -> User | None:
    """The user a reset token belongs to, or None if it's invalid/expired/used."""
    try:
        payload = jwt.decode(token, _reset_key(), algorithms=["HS256"])
        user_id = uuid.UUID(payload["sub"])
        fingerprint = payload["fp"]
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    if not hmac.compare_digest(str(fingerprint), _password_fingerprint(user)):
        return None
    return user


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, get_settings().jwt_secret, algorithms=["HS256"])
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


def require_roles(*roles: UserRole):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return dependency
