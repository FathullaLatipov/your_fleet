"""integrations table (per-company API tokens)

Revision ID: b7e1a2c9d4f0
Revises: ca09afb4800a
Create Date: 2026-11-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b7e1a2c9d4f0'
down_revision = 'ca09afb4800a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'integrations',
        sa.Column('id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_user_id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('token_encrypted', sa.Text(), nullable=True),
        sa.Column('token_last4', sa.String(length=8), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='disconnected'),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('connected_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_user_id', 'provider', name='uq_integration_owner_provider'),
    )
    op.create_index(op.f('ix_integrations_owner_user_id'), 'integrations', ['owner_user_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_integrations_owner_user_id'), table_name='integrations')
    op.drop_table('integrations')
