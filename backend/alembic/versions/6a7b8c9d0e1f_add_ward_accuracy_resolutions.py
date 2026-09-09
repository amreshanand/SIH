"""add ward/accuracy to events, ward to issues, issue_resolutions table

Revision ID: 6a7b8c9d0e1f
Revises: 5a6b7c8d9e0f
Create Date: 2026-09-01

WS2 backend schema: persist administrative/spatial enrichment (ward, GPS
accuracy) on events and issues, and add an append-only resolution-history table
so an issue's full lifecycle (creation → assignment → status changes →
resolution) can be audited and replayed.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '6a7b8c9d0e1f'
down_revision = '5a6b7c8d9e0f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('events', sa.Column('ward', sa.String(100), nullable=True))
    op.add_column('events', sa.Column('gps_accuracy', sa.Float(), nullable=True))
    op.create_index('ix_events_ward', 'events', ['ward'])

    op.add_column('issues', sa.Column('ward', sa.String(100), nullable=True))
    op.create_index('ix_issues_ward', 'issues', ['ward'])

    op.create_table(
        'issue_resolutions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('issue_id', UUID(as_uuid=True), sa.ForeignKey('issues.id'), nullable=False),
        sa.Column('authority_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('action', sa.String(30), nullable=False),
        sa.Column('from_status', sa.String(30), nullable=True),
        sa.Column('to_status', sa.String(30), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_issue_resolutions_issue_id', 'issue_resolutions', ['issue_id'])


def downgrade() -> None:
    op.drop_index('ix_issue_resolutions_issue_id', table_name='issue_resolutions')
    op.drop_table('issue_resolutions')

    op.drop_index('ix_issues_ward', table_name='issues')
    op.drop_column('issues', 'ward')

    op.drop_index('ix_events_ward', table_name='events')
    op.drop_column('events', 'gps_accuracy')
    op.drop_column('events', 'ward')
