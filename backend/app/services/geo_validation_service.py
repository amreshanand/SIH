"""Geo-Spatial Validation Service for UrbanSense AI.

Requirements (Phase 4):
    1. Deduplicate detections across fleet runs.
    2. Cluster nearby observations with a strict micro-clustering radius (default: 15 meters).
    3. Merge matching events within radius:
       - Update observation_count
       - Update first_seen and last_seen
       - Boost fused confidence score with repeated independent observations
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional, Tuple
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models import Event, Issue
from backend.app.services.spatial import distance_m_async, postgis_available


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on the Earth in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return float(R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a)))


class GeoValidationService:
    """Micro-clustering and spatial deduplication engine."""

    def __init__(self, cluster_radius_meters: float = 15.0) -> None:
        self.cluster_radius_meters = cluster_radius_meters

    async def find_matching_issue(
        self,
        event: Event,
        db: AsyncSession,
    ) -> Optional[Tuple[Issue, float]]:
        """Find an existing active issue matching event_type within the 15m cluster radius.

        Returns (matching_issue, distance_meters) or None if no match.
        """
        use_postgis = await postgis_available(db)

        # Query only active issues of the same class
        result = await db.execute(
            select(Issue).where(
                Issue.issue_type == event.event_type,
                Issue.status.in_(["OPEN", "DETECTED", "CONFIRMED", "ASSIGNED", "IN_PROGRESS", "REOPENED"]),
            )
        )
        active_issues = result.scalars().all()
        if not active_issues:
            return None

        closest_issue: Optional[Issue] = None
        min_dist = float("inf")

        for issue in active_issues:
            if use_postgis:
                dist = await distance_m_async(event.latitude, event.longitude, issue.latitude, issue.longitude, db)
            else:
                dist = haversine_meters(event.latitude, event.longitude, issue.latitude, issue.longitude)

            if dist <= self.cluster_radius_meters and dist < min_dist:
                min_dist = dist
                closest_issue = issue

        if closest_issue is not None:
            return closest_issue, min_dist
        return None

    def boost_confidence(self, current_confidence: float, new_confidence: float) -> float:
        """Boost fused confidence asymptotically: C = 1 - (1 - C_curr) * (1 - 0.25 * C_new)."""
        c1 = max(0.0, min(1.0, current_confidence))
        c2 = max(0.0, min(1.0, new_confidence))
        boosted = 1.0 - (1.0 - c1) * (1.0 - 0.25 * c2)
        return round(float(boosted), 4)
