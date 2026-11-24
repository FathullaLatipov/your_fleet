"""telegram driver links, link codes, and pre-trip inspections

Revision ID: d4e8f1a2b9c0
Revises: c3f2a1b8e5d6
Create Date: 2026-11-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'd4e8f1a2b9c0'
down_revision = 'c3f2a1b8e5d6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'driver_link_codes',
        sa.Column('id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_user_id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('code', sa.String(length=16), nullable=False),
        sa.Column('driver_id', sa.UUID(as_uuid=True), nullable=True),
        sa.Column('driver_name', sa.String(length=128), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['driver_id'], ['fleet_drivers.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code', name='uq_driver_link_code'),
    )
    op.create_index(op.f('ix_driver_link_codes_owner_user_id'), 'driver_link_codes', ['owner_user_id'])
    op.create_index(op.f('ix_driver_link_codes_code'), 'driver_link_codes', ['code'])

    op.create_table(
        'telegram_links',
        sa.Column('id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('chat_id', sa.BigInteger(), nullable=False),
        sa.Column('owner_user_id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('driver_id', sa.UUID(as_uuid=True), nullable=True),
        sa.Column('driver_name', sa.String(length=128), nullable=False),
        sa.Column('telegram_username', sa.String(length=64), nullable=True),
        sa.Column('linked_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['driver_id'], ['fleet_drivers.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('chat_id', name='uq_telegram_link_chat'),
    )
    op.create_index(op.f('ix_telegram_links_chat_id'), 'telegram_links', ['chat_id'])
    op.create_index(op.f('ix_telegram_links_owner_user_id'), 'telegram_links', ['owner_user_id'])

    op.create_table(
        'pre_trip_inspections',
        sa.Column('id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_user_id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('vehicle_id', sa.UUID(as_uuid=True), nullable=True),
        sa.Column('unit_number', sa.String(length=32), nullable=True),
        sa.Column('driver_name', sa.String(length=128), nullable=True),
        sa.Column('chat_id', sa.BigInteger(), nullable=True),
        sa.Column('result', sa.String(length=8), nullable=False),
        sa.Column('defect_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('items', sa.JSON(), nullable=True),
        sa.Column('performed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['vehicle_id'], ['vehicles.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_pre_trip_inspections_owner_user_id'), 'pre_trip_inspections', ['owner_user_id'])
    op.create_index(op.f('ix_pre_trip_inspections_vehicle_id'), 'pre_trip_inspections', ['vehicle_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_pre_trip_inspections_vehicle_id'), table_name='pre_trip_inspections')
    op.drop_index(op.f('ix_pre_trip_inspections_owner_user_id'), table_name='pre_trip_inspections')
    op.drop_table('pre_trip_inspections')
    op.drop_index(op.f('ix_telegram_links_owner_user_id'), table_name='telegram_links')
    op.drop_index(op.f('ix_telegram_links_chat_id'), table_name='telegram_links')
    op.drop_table('telegram_links')
    op.drop_index(op.f('ix_driver_link_codes_code'), table_name='driver_link_codes')
    op.drop_index(op.f('ix_driver_link_codes_owner_user_id'), table_name='driver_link_codes')
    op.drop_table('driver_link_codes')
