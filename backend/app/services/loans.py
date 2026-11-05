"""Loan amortization, derived from the loan terms.

Standard annuity: payment = P*r / (1 - (1+r)^-n), r = APR/12/100.
Payment i falls due i months after start_date; a payment counts as paid once
its due date has passed (no bank matching yet, and the UI says so).
All money stays in integer cents; the final payment absorbs rounding.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.models import VehicleLoan, utcnow


def add_months(dt: datetime, months: int) -> datetime:
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    # Clamp the day (Jan 31 + 1 month -> Feb 28/29).
    day = dt.day
    while True:
        try:
            return dt.replace(year=year, month=month, day=day)
        except ValueError:
            day -= 1


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def amortization(loan: VehicleLoan) -> dict:
    P = loan.principal_cents
    n = loan.term_months
    r = loan.apr / 1200.0
    pay = P * r / (1 - (1 + r) ** -n) if r > 0 else P / n
    pay_cents = round(pay)

    now = utcnow()
    start = _aware(loan.start_date)
    rows = []
    balance = float(P)
    interest_total = 0.0
    paid_count = 0
    for i in range(1, n + 1):
        interest = balance * r
        principal = pay - interest
        if i == n:  # final payment clears the balance exactly
            principal = balance
        balance = max(0.0, balance - principal)
        due = add_months(start, i)
        paid = due <= now
        if paid:
            paid_count += 1
        interest_total += interest
        rows.append({
            "i": i,
            "due": due.date().isoformat(),
            "payment_cents": round(principal + interest) if i == n else pay_cents,
            "principal_cents": round(principal),
            "interest_cents": round(interest),
            "balance_cents": round(balance),
            "paid": paid,
        })

    next_row = next((row for row in rows if not row["paid"]), None)
    remaining = (rows[paid_count - 1]["balance_cents"] if paid_count else P)
    return {
        "payment_cents": pay_cents,
        "rows": rows,
        "paid_count": paid_count,
        "interest_total_cents": round(interest_total),
        "next_due": next_row["due"] if next_row else None,
        "next_payment_cents": next_row["payment_cents"] if next_row else None,
        "remaining_cents": remaining if next_row else 0,
        "payoff_date": rows[-1]["due"],
    }
