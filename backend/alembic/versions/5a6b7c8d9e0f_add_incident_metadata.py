"""add metadata_json to incidents for real-inference provenance

Revision ID: 5a6b7c8d9e0f
Revises: 4b2c3d4e5f6a
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '5a6b7c8d9e0f'
down_revision = '4b2c3d4e5f6a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'incidents',
        sa.Column('metadata_json', JSONB, nullable=True),
    )
    op.create_index('ix_incidents_incident_id_unique', 'incidents', ['incident_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_incidents_incident_id_unique', table_name='incidents')
    op.drop_column('incidents', 'metadata_json')
