"""Monday.com export: pushes per-truck expenses into a monday board.

One board, one item per expense: item name carries unit / description / cost;
column values are optional because monday column IDs are account-specific —
set MONDAY_COLUMN_MAP to a JSON object {"date": "date_col_id", "amount":
"numbers_col_id", "unit": "text_col_id", "category": "status_or_text_col_id"}
to fill real columns. Runs only with MONDAY_API_TOKEN set; HTTP layer is
injectable for tests.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Callable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, Vehicle, VehicleExpense

API = "https://api.monday.com/v2"

GqlFn = Callable[[str, dict], dict]


def http_gql_factory(token: str) -> GqlFn:
    client = httpx.Client(timeout=30, headers={
        "Authorization": token, "Content-Type": "application/json",
        "API-Version": "2024-10",
    })

    def gql(query: str, variables: dict) -> dict:
        resp = client.post(API, json={"query": query, "variables": variables})
        resp.raise_for_status()
        body = resp.json()
        if body.get("errors"):
            raise RuntimeError(f"monday.com API error: {body['errors'][:1]}")
        return body["data"]

    return gql


CREATE_ITEM = """
mutation ($boardId: ID!, $name: String!, $columns: JSON) {
  create_item(board_id: $boardId, item_name: $name, column_values: $columns) { id }
}
"""


@dataclass
class ExportReport:
    exported: int = 0
    errors: int = 0
    error_samples: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return self.__dict__ | {"error_samples": self.error_samples[:5]}


def export_expenses(
    db: Session,
    owner: User,
    board_id: str,
    gql: GqlFn,
    column_map: dict | None = None,
) -> ExportReport:
    report = ExportReport()
    rows = db.execute(
        select(VehicleExpense, Vehicle)
        .join(Vehicle, VehicleExpense.vehicle_id == Vehicle.id)
        .where(Vehicle.owner_user_id == owner.id)
        .order_by(VehicleExpense.incurred_at)
    ).all()
    for expense, vehicle in rows:
        name = (
            f"Unit {vehicle.unit_number} — {expense.description} — "
            f"${expense.amount_cents / 100:.2f}"
        )
        columns = {}
        if column_map:
            if "date" in column_map:
                columns[column_map["date"]] = {"date": expense.incurred_at.date().isoformat()}
            if "amount" in column_map:
                columns[column_map["amount"]] = expense.amount_cents / 100
            if "unit" in column_map:
                columns[column_map["unit"]] = vehicle.unit_number
            if "category" in column_map:
                columns[column_map["category"]] = expense.category.value
        try:
            gql(CREATE_ITEM, {
                "boardId": board_id, "name": name[:255],
                "columns": json.dumps(columns) if columns else None,
            })
            report.exported += 1
        except Exception as e:  # noqa: BLE001
            report.errors += 1
            report.error_samples.append(str(e)[:200])
            if report.errors >= 10:
                break
    return report


def make_gql() -> GqlFn:
    token = os.environ.get("MONDAY_API_TOKEN", "")
    if not token:
        raise RuntimeError(
            "MONDAY_API_TOKEN is not set. Create an API token in monday.com "
            "(Admin -> API) and add it to the environment to enable the export."
        )
    return http_gql_factory(token)
