"""Multi-Bus Consensus Engine for UrbanSense AI.

Requirements (Phase 5):
    Issue states:
        DETECTED -> CONFIRMED -> ASSIGNED -> IN_PROGRESS -> PENDING_VERIFICATION -> RESOLVED -> REOPENED

    Consensus Rules:
        1. Bus A observes defect:
           -> DETECTED (First observation)
        2. Bus B observes same defect (distinct bus within cluster radius):
           -> CONFIRMED (Multi-bus consensus achieved)
        3. Bus C observes same defect:
           -> HIGH_CONFIDENCE (Prioritized for immediate municipal dispatch)
        4. After repair (state == PENDING_VERIFICATION):
           - Requires 3 independent CLEAR observations from different buses before auto-transitioning to RESOLVED.
        5. Future defect observation on resolved issue:
           - Automatically transitions to REOPENED with audit log entry.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Event, Issue, IssueEvent, IssueResolution, VerificationRecord
from backend.app.websocket.manager import ws_manager
from backend.app.services.audit_service import log_action
import logging

log = logging.getLogger(__name__)


class MultiBusConsensusEngine:
    """Manages the progressive multi-bus consensus state transitions."""

    CLEAR_THRESHOLD_REQUIRED = 3

    async def register_bus_observation(
        self,
        issue: Issue,
        bus_id_str: str,
        fused_score: float,
        db: AsyncSession,
    ) -> Issue:
        """Update consensus level and status based on multi-bus observations."""
        distinct_buses: List[str] = list(issue.distinct_buses_observed or [])

        # Add bus if not already in distinct list
        if bus_id_str not in distinct_buses:
            distinct_buses.append(bus_id_str)
            issue.distinct_buses_observed = distinct_buses
            issue.unique_bus_count = len(distinct_buses)

        unique_count = len(distinct_buses)

        old_status = issue.status
        old_consensus = issue.consensus_level or "DETECTED"

        # State transition logic based on unique buses
        if issue.status in ("OPEN", "DETECTED", "CONFIRMED"):
            if unique_count == 1:
                issue.consensus_level = "DETECTED"
                issue.status = "DETECTED"
            elif unique_count == 2:
                issue.consensus_level = "CONFIRMED"
                issue.status = "CONFIRMED"
            elif unique_count >= 3:
                issue.consensus_level = "HIGH_CONFIDENCE"
                issue.status = "CONFIRMED"

            if issue.status != old_status or issue.consensus_level != old_consensus:
                log.info(
                    "Issue %s consensus upgraded: %s -> %s (unique_buses=%d)",
                    issue.issue_id,
                    old_consensus,
                    issue.consensus_level,
                    unique_count,
                )
                await log_action(
                    user_id=None,
                    action="CONSENSUS_UPGRADED",
                    entity_type="ISSUE",
                    entity_id=issue.issue_id,
                    old_value={"status": old_status, "consensus": old_consensus},
                    new_value={"status": issue.status, "consensus": issue.consensus_level, "unique_buses": unique_count},
                    db=db,
                )

        # Reopen logic if previously resolved issue is detected again
        elif issue.status == "RESOLVED":
            issue.status = "REOPENED"
            issue.consensus_level = "REOPENED"
            log.warning("Issue %s re-detected by bus %s; REOPENED.", issue.issue_id, bus_id_str)
            await log_action(
                user_id=None,
                action="ISSUE_REOPENED",
                entity_type="ISSUE",
                entity_id=issue.issue_id,
                old_value={"status": "RESOLVED"},
                new_value={"status": "REOPENED", "reopened_by_bus": bus_id_str},
                db=db,
            )

        return issue

    async def evaluate_post_repair_verification(
        self,
        issue: Issue,
        db: AsyncSession,
    ) -> Tuple[bool, int]:
        """Evaluate if issue in PENDING_VERIFICATION has 3 distinct CLEAR buses.

        Returns (is_resolved, distinct_clear_buses).
        """
        if issue.status != "PENDING_VERIFICATION":
            return False, 0

        # Query distinct bus_ids that reported CLEAR on this issue
        q = (
            select(func.count(func.distinct(VerificationRecord.bus_id)))
            .where(
                VerificationRecord.issue_id == issue.id,
                VerificationRecord.detection_result == "CLEAR",
            )
        )
        res = await db.execute(q)
        distinct_clear_count = res.scalar() or 0

        if distinct_clear_count >= self.CLEAR_THRESHOLD_REQUIRED:
            issue.status = "RESOLVED"
            issue.consensus_level = "RESOLVED_VERIFIED"
            issue.last_seen = datetime.now(timezone.utc)

            # Record resolution in history
            resolution = IssueResolution(
                issue_id=issue.id,
                authority_id=None,
                action="FLEET_VERIFIED_RESOLVE",
                from_status="PENDING_VERIFICATION",
                to_status="RESOLVED",
                notes=f"Auto-resolved via {distinct_clear_count} independent fleet bus verifications.",
            )
            db.add(resolution)

            await log_action(
                user_id=None,
                action="ISSUE_AUTO_RESOLVED",
                entity_type="ISSUE",
                entity_id=issue.issue_id,
                old_value={"status": "PENDING_VERIFICATION"},
                new_value={"status": "RESOLVED", "distinct_clear_buses": distinct_clear_count},
                db=db,
            )
            return True, distinct_clear_count

        return False, distinct_clear_count
