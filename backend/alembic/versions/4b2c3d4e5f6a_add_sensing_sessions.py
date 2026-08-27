"""add sensing_sessions

Revision ID: 4b2c3d4e5f6a
Revises: 3a4b5c6d7e8f
Create Date: 2026-08-27

Adds the sensing_sessions table recording per-edge-device session provenance.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '4b2c3d4e5f6a'
down_revision = '3a4b5c6d7e8f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'sensing_sessions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('session_id', sa.String(length=64), nullable=False),
        sa.Column('bus_id', sa.String(length=64), nullable=False),
        sa.Column('camera_id', sa.String(length=32), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('gps_source', sa.String(length=32), nullable=False),
        sa.Column('ai_mode', sa.String(length=32), nullable=False),
        sa.Column('model_name', sa.String(length=255), nullable=True),
        sa.Column('frame_count', sa.Integer(), nullable=False),
        sa.Column('event_count', sa.Integer(), nullable=False),
        sa.Column('upload_count', sa.Integer(), nullable=False),
        sa.Column('error_count', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('metadata_json', JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_sensing_sessions_session_id', 'sensing_sessions', ['session_id'], unique=True)
    op.create_index('ix_sensing_sessions_bus_id', 'sensing_sessions', ['bus_id'], unique=False)
    op.create_index('ix_sensing_sessions_started_at', 'sensing_sessions', ['started_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_sensing_sessions_started_at', table_name='sensing_sessions')
    op.drop_index('ix_sensing_sessions_bus_id', table_name='sensing_sessions')
    op.drop_index('ix_sensing_sessions_session_id', table_name='sensing_sessions')
    op.drop_table('sensing_sessions')
