"""Straight-line truck depreciation, derived from purchase inputs.

Monthly / annual / accumulated depreciation and net book value are never
stored — they're computed from purchase_price, salvage value and useful life,
so correcting an input never leaves stale numbers behind.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class DepreciationSummary:
    method: str
    purchase_price_cents: int | None
    salvage_value_cents: int
    useful_life_months: int | None
    monthly_cents: int | None
    annual_cents: int | None
    months_elapsed: int | None
    accumulated_cents: int | None
    net_book_value_cents: int | None

    def as_dict(self) -> dict:
        return self.__dict__


def _months_between(start: datetime, now: datetime) -> int:
    whole = (now.year - start.year) * 12 + (now.month - start.month)
    if now.day < start.day:
        whole -= 1
    return whole


def compute(vehicle, now: datetime | None = None) -> DepreciationSummary:
    now = now or datetime.now(timezone.utc)
    price = vehicle.purchase_price_cents
    salvage = vehicle.salvage_value_cents or 0
    life = vehicle.useful_life_months
    method = vehicle.depreciation_method or "straight_line"

    monthly = annual = months = accumulated = nbv = None
    if price and life and life > 0:
        depreciable = max(price - salvage, 0)
        monthly = round(depreciable / life)
        annual = monthly * 12
        pd = vehicle.purchase_date
        if pd is not None:
            if pd.tzinfo is None:
                pd = pd.replace(tzinfo=timezone.utc)
            months = max(_months_between(pd, now), 0)
            accumulated = min(monthly * months, depreciable)
            nbv = price - accumulated
    return DepreciationSummary(
        method=method, purchase_price_cents=price, salvage_value_cents=salvage,
        useful_life_months=life, monthly_cents=monthly, annual_cents=annual,
        months_elapsed=months, accumulated_cents=accumulated, net_book_value_cents=nbv,
    )
