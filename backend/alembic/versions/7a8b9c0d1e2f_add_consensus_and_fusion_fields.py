"""add consensus and fusion fields to issues and events

Revision ID: 7a8b9c0d1e2f
Revises: 6a7b8c9d0e1f
Create Date: 2026-09-03

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '7a8b9c0d1e2f'
down_revision = '6a7b8c9d0e1f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add fusion and consensus tracking to issues
    op.add_column('issues', sa.Column('consensus_level', sa.String(30), server_default='DETECTED', nullable=True))
    op.add_column('issues', sa.Column('fused_confidence_score', sa.Float(), server_default='0.0', nullable=True))
    op.add_column('issues', sa.Column('unique_bus_count', sa.Integer(), server_default='1', nullable=True))
    op.add_column('issues', sa.Column('distinct_buses_observed', JSONB, server_default='[]', nullable=True))
    op.add_column('issues', sa.Column('road_mask_overlap_ratio', sa.Float(), nullable=True))
    op.add_column('issues', sa.Column('track_age_frames', sa.Integer(), nullable=True))

    # Index for fast spatial clustering
    op.create_index('ix_issues_consensus', 'issues', ['consensus_level'])

    # 2. Add temporal & fusion fields to events
    op.add_column('events', sa.Column('track_id', sa.BigInteger(), nullable=True))
    op.add_column('events', sa.Column('track_age_frames', sa.Integer(), nullable=True))
    op.add_column('events', sa.Column('consecutive_frames', sa.Integer(), nullable=True))
    op.add_column('events', sa.Column('fused_score', sa.Float(), nullable=True))
    op.add_column('events', sa.Column('road_overlap_ratio', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('events', 'road_overlap_ratio')
    op.drop_column('events', 'fused_score')
    op.drop_column('events', 'consecutive_frames')
    op.drop_column('events', 'track_age_frames')
    op.drop_column('events', 'track_id')

    op.drop_index('ix_issues_consensus', table_name='issues')
    op.drop_column('issues', 'track_age_frames')
    op.drop_column('issues', 'road_mask_overlap_ratio')
    op.drop_column('issues', 'distinct_buses_observed')
    op.drop_column('issues', 'unique_bus_count')
    op.drop_column('issues', 'fused_confidence_score')
    op.drop_column('issues', 'consensus_level')
