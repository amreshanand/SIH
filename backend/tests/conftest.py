"""Shared fixtures for the UrbanSense AI test suite.

A dedicated PostgreSQL database (``urbansense_test``) is used so tests never
touch live demo data. The schema is created with ``Base.metadata.create_all``
(dropped + recreated once per session) and truncated before every test.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# --- Environment wiring MUST happen before any backend import. --------------
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TEST_DB = "urbansense_test"

sys.path.insert(0, str(REPO_ROOT))


def _env_map() -> dict[str, str]:
    out: dict[str, str] = {}
    envf = REPO_ROOT / ".env"
    if envf.exists():
        for line in envf.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                out[key.strip()] = val.strip()
    return out


ENV = _env_map()
_BASE_URL = os.environ.get("DATABASE_URL") or ENV.get(
    "DATABASE_URL", "postgresql+asyncpg://urbansense:urbansense@localhost:5432/urbansense"
)


def _rewrite_url(base: str, db_name: str, scheme: str) -> str:
    _, rest = base.split("://", 1)
    query = ""
    if "?" in rest:
        rest, query = rest.split("?", 1)
    auth = ""
    if "@" in rest:
        auth, rest = rest.split("@", 1)
    host = rest.rsplit("/", 1)[0] + "/" + db_name
    url = f"{scheme}://"
    if auth:
        url += auth + "@"
    url += host
    if query:
        url += "?" + query
    return url


os.environ["DATABASE_URL"] = _rewrite_url(_BASE_URL, TEST_DB, "postgresql+asyncpg")
os.environ["DATABASE_URL_SYNC"] = _rewrite_url(_BASE_URL, TEST_DB, "postgresql")
os.environ["DEMO_MODE"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["MODEL_MODE"] = "mock"
os.environ["VERIFICATION_SEPARATION_SECONDS"] = "0"

# --- Backend imports (post-env) ---------------------------------------------
import jwt  # noqa: E402
import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from backend.app import create_app  # noqa: E402
from backend.app.core.config import settings  # noqa: E402
from backend.app.database.base import Base  # noqa: E402
from backend.app.database.session import get_db  # noqa: E402
from backend.app.models import Bus, User  # noqa: E402

app = create_app()


# --- Schema setup -----------------------------------------------------------
_DB_AVAILABLE = True


@pytest.fixture(scope="session")
def _schema() -> None:
    global _DB_AVAILABLE
    try:
        import sqlalchemy as sa

        sync_url = settings.database_url_sync
        sync_engine = sa.create_engine(sync_url)
        Base.metadata.create_all(sync_engine)
        sync_engine.dispose()
    except Exception:
        _DB_AVAILABLE = False


@pytest.fixture(autouse=True)
def _clean(_schema) -> None:
    if not _DB_AVAILABLE:
        return
    try:
        import sqlalchemy as sa

        sync_engine = sa.create_engine(settings.database_url_sync)
        with sync_engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                conn.execute(text(f'TRUNCATE TABLE "{table.name}" CASCADE'))
        sync_engine.dispose()
    except Exception:
        pass


# --- App / client -----------------------------------------------------------
@pytest.fixture
def app_context(_clean) -> None:  # noqa: ARG001
    yield None


@pytest.fixture
async def client(app_context) -> AsyncClient:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


@pytest.fixture
async def db_session():
    """A test-scoped async session for direct ORM seeding, bound to its own
    event loop-safe engine (disposed on teardown within the same loop)."""
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


# --- Factory helpers --------------------------------------------------------
def _hash_password(password: str) -> str:
    from passlib.hash import bcrypt

    return bcrypt.hash(password)


def mint_token(username: str, user_id, role: str) -> str:
    return jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "username": username,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        settings.secret_key,
        algorithm="HS256",
    )


async def create_user_in_db(username: str, role: str, password: str = "testpass123") -> User:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            user = User(username=username, password_hash=_hash_password(password), role=role)
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user
    finally:
        await engine.dispose()


async def create_bus_in_db(bus_number: str, status: str = "LIVE") -> Bus:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            bus = Bus(bus_number=bus_number, status=status)
            session.add(bus)
            await session.commit()
            await session.refresh(bus)
            return bus
    finally:
        await engine.dispose()


@pytest.fixture
async def admin_user() -> User:
    return await create_user_in_db("admin_ci", "ADMIN")


@pytest.fixture
async def authority_user() -> User:
    return await create_user_in_db("authority_ci", "AUTHORITY", "authority123")


@pytest.fixture
async def viewer_user() -> User:
    return await create_user_in_db("viewer_ci", "VIEWER", "viewer123")


@pytest.fixture
def admin_token(admin_user: User) -> str:
    return mint_token(admin_user.username, admin_user.id, admin_user.role)


@pytest.fixture
def authority_token(authority_user: User) -> str:
    return mint_token(authority_user.username, authority_user.id, authority_user.role)


@pytest.fixture
def viewer_token(viewer_user: User) -> str:
    return mint_token(viewer_user.username, viewer_user.id, viewer_user.role)


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}