"""postgis geometry columns (guarded)

Revision ID: 3a4b5c6d7e8f
Revises: 2a3b4c5d6e7f
Create Date: 2026-08-27

Adds optional GEOGRAPHY(Point,4326) columns and GiST indexes to spatial
entities WHEN the PostGIS extension is available. The migration queries the
pg_extension catalog; if PostGIS is not installed it logs a notice and adds
nothing (the application keeps using the haversine fallback), so upgrading on
a plain database never fails.
"""
from alembic import op
import sqlalchemy as sa

revision = '3a4b5c6d7e8f'
down_revision = '2a3b4c5d6e7f'
branch_labels = None
depends_on = None

SPATIAL_TABLES = [
    "events",
    "issues",
    "incidents",
    "gps_points",
    "traffic_records",
    "verification_records",
]


def _postgis_installed(connection) -> bool:
    try:
        row = connection.execute(
            sa.text("SELECT 1 FROM pg_extension WHERE extname = 'postgis'")
        ).fetchone()
        return bool(row)
    except Exception:
        return False


def upgrade() -> None:
    bind = op.get_bind()
    if not _postgis_installed(bind):
        print("PostGIS extension not detected — skipping geometry columns (haversine fallback in use).")
        return

    try:
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    except Exception as e:
        print(f"PostGIS extension could not be created at migration time: {e}")
        return

    for table in SPATIAL_TABLES:
        try:
            op.execute(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS geog "
                "geography(Point, 4326)"
            )
        except Exception:
            continue
        try:
            op.execute(
                f"UPDATE {table} SET geog = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography "
                f"WHERE geog IS NULL AND longitude IS NOT NULL AND latitude IS NOT NULL"
            )
        except Exception:
            pass
        try:
            op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_geog_gist ON {table} USING gist (geog)")
        except Exception:
            pass


def downgrade() -> None:
    bind = op.get_bind()
    if not _postgis_installed(bind):
        return
    for table in SPATIAL_TABLES:
        try:
            op.execute(f"DROP INDEX IF EXISTS ix_{table}_geog_gist")
        except Exception:
            pass
        try:
            op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS geog")
        except Exception:
            pass
