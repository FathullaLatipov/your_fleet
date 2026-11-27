"""Per-company third-party integrations (Samsara, …).

Each carrier connects its OWN API token here; sync then runs per-tenant with
that token. Tokens are encrypted at rest (app.services.crypto) and never
returned to the client — only a last-4 preview and connection status are.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Integration, User, UserRole, utcnow
from app.schemas import (
    IntegrationOut,
    IntegrationTokenIn,
    SamsaraAccountIn,
    SamsaraAccountOut,
)
from app.security import require_roles
from app.services import crypto
from app.services import samsara as samsara_svc

router = APIRouter(prefix="/api/integrations", tags=["integrations"])
owner_user = require_roles(UserRole.DRIVER, UserRole.FLEET_MANAGER, UserRole.ADMIN)

# Catalog. `available` False = shown as "coming soon" (token not accepted yet).
PROVIDERS: dict[str, dict] = {
    "samsara": {
        "label": "Samsara",
        "description": "Live GPS, odometer, fuel level and engine fault codes per truck.",
        "available": True,
    },
    "ringcentral": {
        "label": "RingCentral",
        "description": "Click-to-call and call logging for your dispatch team.",
        "available": False,
    },
    "fuel": {
        "label": "Fuel provider",
        "description": "Fuel-card transactions and discounted pump prices (WEX / Comdata / EFS).",
        "available": False,
    },
}


def _rows(db: Session, owner: User) -> dict[str, Integration]:
    # One representative row per provider for the catalog view; prefer a
    # connected one (a provider like Samsara may have several accounts).
    out: dict[str, Integration] = {}
    for r in db.execute(
        select(Integration).where(Integration.owner_user_id == owner.id)
        .order_by(Integration.created_at)
    ).scalars():
        cur = out.get(r.provider)
        if cur is None or (cur.status != "connected" and r.status == "connected"):
            out[r.provider] = r
    return out


def _samsara_rows(db: Session, owner: User) -> list[Integration]:
    return db.execute(
        select(Integration).where(
            Integration.owner_user_id == owner.id, Integration.provider == "samsara")
        .order_by(Integration.created_at)
    ).scalars().all()


def _acct_out(row: Integration) -> SamsaraAccountOut:
    return SamsaraAccountOut(
        id=row.id, label=row.label, status=row.status, token_last4=row.token_last4,
        last_error=row.last_error, last_checked_at=row.last_checked_at,
        connected_at=row.connected_at)


def _first_sync(db: Session, owner: User, token: str) -> None:
    """Best-effort first Samsara sync so the fleet shows data right away."""
    try:
        c = samsara_svc.client_for(token)
        samsara_svc.sync_samsara(db, owner, vehicles_fn=c.vehicles, stats_fn=c.stats,
                                 defects_fn=c.open_defects, faults_fn=c.faults)
    except Exception:  # noqa: BLE001
        pass


def _out(provider: str, meta: dict, row: Integration | None) -> IntegrationOut:
    if not meta["available"]:
        status_ = "unavailable"
    else:
        status_ = row.status if row else "disconnected"
    return IntegrationOut(
        provider=provider, label=meta["label"], description=meta["description"],
        available=meta["available"], status=status_,
        token_last4=row.token_last4 if row else None,
        last_error=row.last_error if row else None,
        last_checked_at=row.last_checked_at if row else None,
        connected_at=row.connected_at if row else None,
    )


def _check(provider: str, token: str) -> tuple[bool, str | None]:
    if provider == "samsara":
        return samsara_svc.check_token(token)
    return True, None  # other providers: format-only for now


@router.get("", response_model=list[IntegrationOut])
def list_integrations(owner: User = Depends(owner_user), db: Session = Depends(get_db)):
    rows = _rows(db, owner)
    return [_out(p, meta, rows.get(p)) for p, meta in PROVIDERS.items()]


# -------- Samsara: multiple accounts per carrier, their data merges into the fleet

@router.get("/samsara/accounts", response_model=list[SamsaraAccountOut])
def list_samsara_accounts(owner: User = Depends(owner_user), db: Session = Depends(get_db)):
    return [_acct_out(r) for r in _samsara_rows(db, owner)]


@router.post("/samsara/accounts", response_model=SamsaraAccountOut, status_code=201)
def add_samsara_account(body: SamsaraAccountIn, owner: User = Depends(owner_user),
                        db: Session = Depends(get_db)):
    token = body.token.strip()
    ok, err = samsara_svc.check_token(token)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, err or "Couldn't connect.")
    existing = _samsara_rows(db, owner)
    label = (body.label or "").strip() or ("Samsara" if not existing else f"Samsara #{len(existing) + 1}")
    now = utcnow()
    row = Integration(
        owner_user_id=owner.id, provider="samsara", label=label,
        token_encrypted=crypto.encrypt(token), token_last4=crypto.last4(token),
        status="connected", connected_at=now, last_checked_at=now)
    db.add(row)
    db.commit()
    db.refresh(row)
    _first_sync(db, owner, token)
    return _acct_out(row)


@router.post("/samsara/accounts/{account_id}/test", response_model=SamsaraAccountOut)
def test_samsara_account(account_id: uuid.UUID, owner: User = Depends(owner_user),
                         db: Session = Depends(get_db)):
    row = db.get(Integration, account_id)
    if row is None or row.owner_user_id != owner.id or row.provider != "samsara":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    token = crypto.decrypt(row.token_encrypted)
    ok, err = (False, "Stored token couldn't be read.") if token is None else samsara_svc.check_token(token)
    row.last_checked_at = utcnow()
    row.status = "connected" if ok else "error"
    row.last_error = None if ok else err
    db.commit()
    db.refresh(row)
    return _acct_out(row)


@router.delete("/samsara/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_samsara_account(account_id: uuid.UUID, owner: User = Depends(owner_user),
                           db: Session = Depends(get_db)):
    row = db.get(Integration, account_id)
    if row is not None and row.owner_user_id == owner.id and row.provider == "samsara":
        db.delete(row)
        db.commit()


@router.put("/{provider}", response_model=IntegrationOut)
def connect(provider: str, body: IntegrationTokenIn,
            owner: User = Depends(owner_user), db: Session = Depends(get_db)):
    meta = PROVIDERS.get(provider)
    if meta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown integration")
    if provider == "samsara":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Use /api/integrations/samsara/accounts to add a Samsara account.")
    if not meta["available"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{meta['label']} isn't available yet.")

    token = body.token.strip()
    ok, err = _check(provider, token)

    row = _rows(db, owner).get(provider)
    if row is None:
        row = Integration(owner_user_id=owner.id, provider=provider)
        db.add(row)
    row.last_checked_at = utcnow()
    if not ok:
        row.status = "error"
        row.last_error = err
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, err or "Couldn't connect.")

    row.token_encrypted = crypto.encrypt(token)
    row.token_last4 = crypto.last4(token)
    row.status = "connected"
    row.last_error = None
    row.connected_at = row.connected_at or utcnow()
    db.commit()
    db.refresh(row)

    # Best-effort first sync so the fleet shows data immediately. Never fail the
    # connect on a sync hiccup — the token is already saved and validated.
    if provider == "samsara":
        try:
            c = samsara_svc.client_for(token)
            samsara_svc.sync_samsara(db, owner, vehicles_fn=c.vehicles, stats_fn=c.stats,
                                     defects_fn=c.open_defects, faults_fn=c.faults)
        except Exception:  # noqa: BLE001
            pass
    return _out(provider, meta, row)


@router.post("/{provider}/test", response_model=IntegrationOut)
def test(provider: str, owner: User = Depends(owner_user), db: Session = Depends(get_db)):
    meta = PROVIDERS.get(provider)
    if meta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown integration")
    row = _rows(db, owner).get(provider)
    if row is None or not row.token_encrypted:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not connected.")
    token = crypto.decrypt(row.token_encrypted)
    ok, err = (False, "Stored token couldn't be read.") if token is None else _check(provider, token)
    row.last_checked_at = utcnow()
    row.status = "connected" if ok else "error"
    row.last_error = None if ok else err
    db.commit()
    db.refresh(row)
    return _out(provider, meta, row)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect(provider: str, owner: User = Depends(owner_user), db: Session = Depends(get_db)):
    row = _rows(db, owner).get(provider)
    if row is not None:
        row.status = "disconnected"
        row.token_encrypted = None
        row.token_last4 = None
        row.last_error = None
        row.connected_at = None
        db.commit()
