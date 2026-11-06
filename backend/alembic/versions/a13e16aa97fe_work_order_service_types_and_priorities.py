"""work order service types and priorities

Revision ID: a13e16aa97fe
Revises: 0a57eba126e8
Create Date: 2026-11-07 01:31:21.042377

"""
from alembic import op
import sqlalchemy as sa


revision = 'a13e16aa97fe'
down_revision = '0a57eba126e8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Service types: repair, pm, inspection, roadside, towing, parking,
    # truck_wash, order_parts (VARCHAR, no DB constraint to alter).
    op.execute("UPDATE work_orders SET service_type = 'pm' WHERE service_type = 'preventive'")
    op.execute("UPDATE work_orders SET service_type = 'repair' WHERE service_type = 'other'")
    # "Roadside" moved from priority to service type.
    op.execute("""
        UPDATE work_orders SET priority = 'urgent', service_type = 'roadside'
        WHERE priority = 'roadside'
    """)


def downgrade() -> None:
    op.execute("UPDATE work_orders SET service_type = 'preventive' WHERE service_type = 'pm'")
    op.execute("""
        UPDATE work_orders SET service_type = 'other'
        WHERE service_type IN ('towing', 'parking', 'truck_wash', 'order_parts')
    """)
    op.execute("""
        UPDATE work_orders SET priority = 'roadside', service_type = 'repair'
        WHERE service_type = 'roadside'
    """)
