"""driver link codes: single-use binding (used_at, used_by_chat_id)

Revision ID: e5a9c2d7f3b1
Revises: d4e8f1a2b9c0
Create Date: 2026-11-24 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'e5a9c2d7f3b1'
down_revision = 'd4e8f1a2b9c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('driver_link_codes', sa.Column('used_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('driver_link_codes', sa.Column('used_by_chat_id', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('driver_link_codes', 'used_by_chat_id')
    op.drop_column('driver_link_codes', 'used_at')
