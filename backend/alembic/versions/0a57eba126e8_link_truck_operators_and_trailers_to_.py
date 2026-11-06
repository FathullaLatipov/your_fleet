"""link truck operators and trailers to roster

Revision ID: 0a57eba126e8
Revises: cfd5a8c68d8f
Create Date: 2026-11-07 01:04:28.736775

"""
from alembic import op
import sqlalchemy as sa


revision = '0a57eba126e8'
down_revision = 'cfd5a8c68d8f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Trucks whose driver/trailer exists only as text get a real roster link,
    # same rule as app/services/fleet_links.py: reuse a roster entry with the
    # same name/unit, otherwise create one.
    op.execute("""
        UPDATE fleet_drivers d SET assigned_vehicle_id = v.id
        FROM vehicles v
        WHERE d.owner_user_id = v.owner_user_id
          AND d.assigned_vehicle_id IS NULL
          AND nullif(trim(v.operator_name), '') IS NOT NULL
          AND lower(trim(d.name)) = lower(trim(v.operator_name))
          AND NOT EXISTS (SELECT 1 FROM fleet_drivers x
                          WHERE x.assigned_vehicle_id = v.id
                            AND lower(trim(x.name)) = lower(trim(v.operator_name)))
    """)
    op.execute("""
        INSERT INTO fleet_drivers (id, owner_user_id, name, status, assigned_vehicle_id, created_at)
        SELECT gen_random_uuid(), v.owner_user_id, trim(v.operator_name), 'active', v.id, now()
        FROM vehicles v
        WHERE nullif(trim(v.operator_name), '') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM fleet_drivers x
                          WHERE x.assigned_vehicle_id = v.id
                            AND lower(trim(x.name)) = lower(trim(v.operator_name)))
    """)
    op.execute("""
        UPDATE trailers t SET assigned_vehicle_id = v.id
        FROM vehicles v
        WHERE t.owner_user_id = v.owner_user_id
          AND t.assigned_vehicle_id IS NULL
          AND nullif(trim(v.trailer_unit), '') IS NOT NULL
          AND lower(trim(t.unit_number)) = lower(trim(ltrim(trim(v.trailer_unit), '#')))
    """)
    op.execute("""
        INSERT INTO trailers (id, owner_user_id, unit_number, status, assigned_vehicle_id, created_at)
        SELECT DISTINCT ON (v.owner_user_id, lower(trim(ltrim(trim(v.trailer_unit), '#'))))
               gen_random_uuid(), v.owner_user_id, trim(ltrim(trim(v.trailer_unit), '#')),
               'active', v.id, now()
        FROM vehicles v
        WHERE nullif(trim(v.trailer_unit), '') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM trailers x
                          WHERE x.owner_user_id = v.owner_user_id
                            AND lower(trim(x.unit_number))
                                = lower(trim(ltrim(trim(v.trailer_unit), '#'))))
    """)


def downgrade() -> None:
    # Data backfill only; the created roster rows are real data now.
    pass
