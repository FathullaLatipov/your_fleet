"""integrations: allow multiple accounts per provider (+ label)

Revision ID: a1c7e9b2d5f8
Revises: f6b3d1e8a2c4
Create Date: 2026-11-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'a1c7e9b2d5f8'
down_revision = 'f6b3d1e8a2c4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('integrations', sa.Column('label', sa.String(length=64), nullable=True))
    op.drop_constraint('uq_integration_owner_provider', 'integrations', type_='unique')
    op.create_index('ix_integration_owner_provider', 'integrations', ['owner_user_id', 'provider'])


def downgrade() -> None:
    op.drop_index('ix_integration_owner_provider', table_name='integrations')
    op.create_unique_constraint('uq_integration_owner_provider', 'integrations',
                                ['owner_user_id', 'provider'])
    op.drop_column('integrations', 'label')
