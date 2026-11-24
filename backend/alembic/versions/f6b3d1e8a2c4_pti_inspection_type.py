"""pre-trip inspections: inspection_type (pre/post)

Revision ID: f6b3d1e8a2c4
Revises: e5a9c2d7f3b1
Create Date: 2026-11-24 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'f6b3d1e8a2c4'
down_revision = 'e5a9c2d7f3b1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('pre_trip_inspections',
                  sa.Column('inspection_type', sa.String(length=8), nullable=False, server_default='pre'))


def downgrade() -> None:
    op.drop_column('pre_trip_inspections', 'inspection_type')
