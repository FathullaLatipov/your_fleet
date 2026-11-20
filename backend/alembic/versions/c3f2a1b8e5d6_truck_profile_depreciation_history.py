"""truck profile: purchase/depreciation fields + driver & mileage history

Revision ID: c3f2a1b8e5d6
Revises: b7e1a2c9d4f0
Create Date: 2026-11-20 00:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'c3f2a1b8e5d6'
down_revision = 'b7e1a2c9d4f0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('vehicles', sa.Column('registration_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('vehicles', sa.Column('purchase_price_cents', sa.Integer(), nullable=True))
    op.add_column('vehicles', sa.Column('purchase_date', sa.DateTime(timezone=True), nullable=True))
    op.add_column('vehicles', sa.Column('odometer_at_purchase', sa.Float(), nullable=True))
    op.add_column('vehicles', sa.Column('salvage_value_cents', sa.Integer(), nullable=True))
    op.add_column('vehicles', sa.Column('useful_life_months', sa.Integer(), nullable=True))
    op.add_column('vehicles', sa.Column('depreciation_method', sa.String(length=24), nullable=True))

    op.create_table(
        'driver_assignments',
        sa.Column('id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('vehicle_id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('driver_id', sa.UUID(as_uuid=True), nullable=True),
        sa.Column('driver_name', sa.String(length=128), nullable=False),
        sa.Column('start_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['vehicle_id'], ['vehicles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['driver_id'], ['fleet_drivers.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_driver_assignments_vehicle_id'), 'driver_assignments', ['vehicle_id'])
    op.create_index('ix_driver_assignment_vehicle_open', 'driver_assignments', ['vehicle_id', 'end_date'])

    op.create_table(
        'odometer_readings',
        sa.Column('id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('vehicle_id', sa.UUID(as_uuid=True), nullable=False),
        sa.Column('miles', sa.Float(), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('source', sa.String(length=16), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['vehicle_id'], ['vehicles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_odometer_readings_vehicle_id'), 'odometer_readings', ['vehicle_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_odometer_readings_vehicle_id'), table_name='odometer_readings')
    op.drop_table('odometer_readings')
    op.drop_index('ix_driver_assignment_vehicle_open', table_name='driver_assignments')
    op.drop_index(op.f('ix_driver_assignments_vehicle_id'), table_name='driver_assignments')
    op.drop_table('driver_assignments')
    for col in ('depreciation_method', 'useful_life_months', 'salvage_value_cents',
                'odometer_at_purchase', 'purchase_date', 'purchase_price_cents',
                'registration_expires_at'):
        op.drop_column('vehicles', col)
