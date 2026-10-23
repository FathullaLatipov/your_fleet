import os

# Must be set before app modules import settings.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/yourfleet_test"
)
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models import Base

TEST_URL = os.environ["DATABASE_URL"]


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(TEST_URL)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    with eng.begin() as conn:
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_businesses_earth "
            "ON businesses USING gist (ll_to_earth(lat, lng))"
        ))
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    """Fresh tables per test (truncate is faster than drop/create)."""
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    session = SessionLocal()
    yield session
    session.rollback()
    with engine.begin() as conn:
        tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
        conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    session.close()
