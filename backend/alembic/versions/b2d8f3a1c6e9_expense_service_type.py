"""vehicle_expenses: keep the work-order service type for reports

A cost created by closing a work order was always stored as category=repair,
so the "Service records" report showed every work-order cost as "Repair" even
when the user picked PM, Roadside, Towing, etc. Carry the chosen service type
on the expense, and backfill it for existing work-order costs by matching the
"WO-<n>:" prefix in the description to the work order.

Revision ID: b2d8f3a1c6e9
Revises: a1c7e9b2d5f8
Create Date: 2026-11-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b2d8f3a1c6e9'
down_revision = 'a1c7e9b2d5f8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('vehicle_expenses',
                  sa.Column('service_type', sa.String(length=32), nullable=True))
    # Backfill existing work-order costs: "WO-<n>: ..." -> that WO's service type,
    # matched within the same carrier (wo_number is unique per owner).
    op.execute(
        """
        UPDATE vehicle_expenses AS ve
        SET service_type = wo.service_type
        FROM vehicles AS v, work_orders AS wo
        WHERE ve.vehicle_id = v.id
          AND wo.owner_user_id = v.owner_user_id
          AND ve.service_type IS NULL
          AND ve.description ~ '^WO-[0-9]+:'
          AND wo.wo_number = CAST(substring(ve.description from '^WO-([0-9]+):') AS integer)
        """
    )


def downgrade() -> None:
    op.drop_column('vehicle_expenses', 'service_type')
