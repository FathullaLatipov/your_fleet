import hashlib
import html
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, utcnow
from app.rate_limit import rate_limit
from app.schemas import (
    ForgotPasswordIn, LoginIn, RegisterIn, ResendCodeIn, ResetPasswordIn, TokenOut, UserOut,
    VerifyEmailIn,
)
from app.security import (
    RESET_TOKEN_TTL_MINUTES, create_access_token, create_password_reset_token,
    get_current_user, hash_password, user_for_reset_token, verify_password,
)
from app.services import email as email_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

CODE_TTL_MINUTES = 15
MAX_VERIFY_ATTEMPTS = 8


def _code_hash(user_id, code: str) -> str:
    return hashlib.sha256(f"{user_id}:{code}".encode()).hexdigest()


def _issue_code(user: User) -> str:
    """Generate and store a fresh 6-digit code; returns the plain code."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    user.verify_code_hash = _code_hash(user.id, code)
    user.verify_expires_at = utcnow() + timedelta(minutes=CODE_TTL_MINUTES)
    user.verify_attempts = 0
    return code


def _send_code(user: User, code: str) -> None:
    email_service.send(
        user.email,
        f"{code} is your YourFleet verification code",
        email_service.render(
            "Confirm your email",
            f"<p>Hi {user.full_name.split(' ')[0]},</p>"
            f"<p>Your verification code is</p>"
            f'<p style="font-size:32px;font-weight:700;letter-spacing:6px;'
            f'color:#1b1e22;margin:16px 0">{code}</p>'
            f"<p>It expires in {CODE_TTL_MINUTES} minutes. "
            "If you didn't create a YourFleet account, ignore this email.</p>",
        ),
    )


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, "register", limit=10, window_s=3600)
    existing = db.execute(select(User).where(User.email == body.email.lower())).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        phone=body.phone,
        carrier_name=(body.carrier_name or "").strip() or None,
        mc_number=(body.mc_number or "").strip() or None,
        dot_number=(body.dot_number or "").strip() or None,
        role=body.role,
    )
    if email_service.is_configured():
        db.add(user)
        db.flush()  # assigns user.id — the code hash is bound to it
        code = _issue_code(user)
        db.commit()
        _send_code(user, code)
    else:
        # No email provider configured: don't lock people out of signup.
        user.email_verified_at = utcnow()
        db.add(user)
        db.commit()
    return user


@router.post("/verify-email", response_model=TokenOut)
def verify_email(body: VerifyEmailIn, request: Request, db: Session = Depends(get_db)):
    """Confirm the 6-digit code; signs the user in on success."""
    rate_limit(request, "verify", limit=30, window_s=900)
    user = db.execute(select(User).where(User.email == body.email.lower())).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account with this email")
    if user.email_verified_at is not None:
        return TokenOut(access_token=create_access_token(user))
    if user.verify_code_hash is None or user.verify_expires_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "No code was issued - request a new one")
    if user.verify_attempts >= MAX_VERIFY_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Too many wrong codes - request a new one")
    if user.verify_expires_at < utcnow():
        raise HTTPException(status.HTTP_410_GONE, "The code expired - request a new one")
    if _code_hash(user.id, body.code.strip()) != user.verify_code_hash:
        user.verify_attempts += 1
        db.commit()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Wrong code - check the email")
    user.email_verified_at = utcnow()
    user.verify_code_hash = None
    user.verify_expires_at = None
    db.commit()
    return TokenOut(access_token=create_access_token(user))


@router.post("/resend-code", status_code=204)
def resend_code(body: ResendCodeIn, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, "resend-code", limit=6, window_s=3600)
    user = db.execute(select(User).where(User.email == body.email.lower())).scalar_one_or_none()
    # Same response whether or not the account exists or is already verified.
    if user is not None and user.email_verified_at is None and email_service.is_configured():
        code = _issue_code(user)
        db.commit()
        _send_code(user, code)


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, "login", limit=20, window_s=900)
    user = db.execute(select(User).where(User.email == body.email.lower())).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is deactivated")
    if user.email_verified_at is None and email_service.is_configured():
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Email not verified - enter the code we sent you")
    return TokenOut(access_token=create_access_token(user))


@router.post("/forgot-password", status_code=204)
def forgot_password(body: ForgotPasswordIn, request: Request, db: Session = Depends(get_db)):
    """Email a reset link. Same response whether or not the account exists."""
    rate_limit(request, "forgot-password", limit=6, window_s=3600)
    if not email_service.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Password reset by email isn't available - contact support")
    user = db.execute(select(User).where(User.email == body.email.lower())).scalar_one_or_none()
    if user is None or not user.is_active:
        return
    token = create_password_reset_token(user)
    email_service.send(
        user.email,
        "Reset your YourFleet password",
        email_service.render(
            "Reset your password",
            f"<p>Hi {html.escape(user.full_name.split(' ')[0])},</p>"
            "<p>We got a request to reset the password for your YourFleet account. "
            f"The button below works once and expires in {RESET_TOKEN_TTL_MINUTES} minutes.</p>"
            "<p>If you didn't ask for this, ignore this email - your password stays the same.</p>",
            cta_label="Reset password",
            cta_path=f"/reset-password?token={token}",
        ),
    )


@router.post("/reset-password", response_model=TokenOut)
def reset_password(body: ResetPasswordIn, request: Request, db: Session = Depends(get_db)):
    """Set a new password from an emailed link; signs the user in on success."""
    rate_limit(request, "reset-password", limit=20, window_s=900)
    user = user_for_reset_token(body.token, db)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "This reset link is invalid or expired - request a new one")
    user.password_hash = hash_password(body.password)  # also invalidates the link
    if user.email_verified_at is None:
        # Opening the emailed link proves they own the inbox.
        user.email_verified_at = utcnow()
        user.verify_code_hash = None
        user.verify_expires_at = None
    db.commit()
    return TokenOut(access_token=create_access_token(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
