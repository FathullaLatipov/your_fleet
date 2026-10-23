"""geo index earthdistance

Revision ID: 8b3052727cc0
Revises: 745eba89b118
Create Date: 2026-10-23 20:31:31.554782

"""
from alembic import op
import sqlalchemy as sa


revision = '8b3052727cc0'
down_revision = '745eba89b118'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # cube + earthdistance power radius search without PostGIS. Creating the
    # extensions requires superuser on some installs; they are created here
    # idempotently and documented in the deployment guide.
    op.execute("CREATE EXTENSION IF NOT EXISTS cube")
    op.execute("CREATE EXTENSION IF NOT EXISTS earthdistance")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_businesses_earth "
        "ON businesses USING gist (ll_to_earth(lat, lng))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_businesses_earth")
