from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

# Canonical road-damage classes that map to infrastructure issues. This matches
# the edge's 9-class taxonomy so backend routing and the frontend agree on a
# stable vocabulary.
ROAD_DAMAGE_EVENT_TYPES = {
    "POTHOLE", "LONGITUDINAL_CRACK", "TRANSVERSE_CRACK", "ALLIGATOR_CRACK",
    "EDGE_BREAK", "RUTTING", "SURFACE_WEAR", "PATCH_FAILURE",
    "UTILITY_COVER_DAMAGE",
}
# Legacy / alternative names normalized onto the canonical 9-class set (e.g.
# events ingested from older edge builds or different datasets).
ROAD_DAMAGE_TYPE_ALIASES = {
    "ROAD_CRACK": "TRANSVERSE_CRACK",
    "CRACK": "TRANSVERSE_CRACK",
    "DAMAGED_ROAD": "TRANSVERSE_CRACK",
    "PATCH": "PATCH_FAILURE",
    "SURFACE_FAILURE": "SURFACE_WEAR",
    # Split generic cracks onto families (no finer info available).
    "WATERLOGGING": None,  # routed as infrastructure but not in the 9 classes
}
# Incident classes promoted to command-center alerts.
INCIDENT_EVENT_TYPES = {"RASH_DRIVING", "HIT_AND_RUN", "COLLISION", "PEDESTRIAN_RISK"}


def normalize_event_type(raw: str) -> str:
    """Upper-case and map legacy road-damage names onto the canonical set."""
    key = (raw or "").upper()
    if key in ROAD_DAMAGE_TYPE_ALIASES:
        mapped = ROAD_DAMAGE_TYPE_ALIASES[key]
        return mapped if mapped else key
    return key


class EventCreate(BaseModel):
    event_id: str
    event_type: str
    # Accept either a bus UUID or a bus number (e.g. "BUS-001"); the endpoint
    # resolves a bus number to its UUID so edge devices don't need to know ids.
    bus_id: str
    # Edge devices send a camera position label (e.g. "FRONT"); the endpoint
    # stores it only when it is a valid camera UUID, else None.
    camera_id: Optional[str] = None
    severity: str = "MEDIUM"
    confidence: float = Field(ge=0.0, le=1.0)
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    evidence_url: Optional[str] = None
    metadata_json: Optional[dict[str, Any]] = None
    source: str = "EDGE_AI"
    # Real-inference fields (tracking + model provenance).
    track_id: Optional[int] = None
    track_age_frames: Optional[int] = None
    consecutive_frames: Optional[int] = None
    fused_score: Optional[float] = None
    road_overlap_ratio: Optional[float] = None
    bbox: Optional[list[int]] = None
    source_model: Optional[str] = None
    # Administrative/clustering enrichment.
    ward: Optional[str] = None
    gps_accuracy: Optional[float] = Field(default=None, ge=0.0)

    @field_validator("event_type")
    @classmethod
    def _normalize_type(cls, v: str) -> str:
        return normalize_event_type(v)

    @field_validator("bbox")
    @classmethod
    def _validate_bbox(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        if v is None:
            return None
        if len(v) != 4:
            raise ValueError("bbox must contain exactly 4 integers [x1, y1, x2, y2]")
        for n in v:
            if n < 0:
                raise ValueError("bbox coordinates must be non-negative")
        if not (v[2] > v[0] and v[3] > v[1]):
            raise ValueError("bbox x2/x3 must be greater than x1/y1")
        return v

    def to_metadata_json(self) -> dict[str, Any]:
        """Merge the real-inference fields into the stored metadata_json so the
        backend persists track_id / bbox / model provenance / ward / accuracy
        alongside legacy metadata."""
        meta = dict(self.metadata_json or {})
        if self.track_id is not None:
            meta["track_id"] = self.track_id
        if self.track_age_frames is not None:
            meta["track_age_frames"] = self.track_age_frames
        if self.consecutive_frames is not None:
            meta["consecutive_frames"] = self.consecutive_frames
        if self.fused_score is not None:
            meta["fused_score"] = self.fused_score
        if self.road_overlap_ratio is not None:
            meta["road_overlap_ratio"] = self.road_overlap_ratio
        if self.bbox is not None:
            meta["bbox"] = self.bbox
        if self.source_model is not None:
            meta["source_model"] = self.source_model
        if self.ward is not None:
            meta["ward"] = self.ward
        if self.gps_accuracy is not None:
            meta["gps_accuracy"] = self.gps_accuracy
        return meta

    def has_real_inference(self) -> bool:
        """True when the event carries true YOLO provenance (a detection bbox and
        the model that produced it). The backend rejects road-damage events that
        lack this outside demo mode so no non-inferred data is routed."""
        meta = self.to_metadata_json()
        return (
            meta.get("bbox") is not None
            and meta.get("source_model") is not None
            and meta.get("track_id") is not None
        )

    @property
    def is_incident(self) -> bool:
        return self.event_type in INCIDENT_EVENT_TYPES

    @property
    def is_road_damage(self) -> bool:
        return self.event_type in ROAD_DAMAGE_EVENT_TYPES


class EventResponse(BaseModel):
    id: uuid.UUID
    event_id: str
    event_type: str
    bus_id: uuid.UUID
    camera_id: Optional[uuid.UUID] = None
    severity: str
    confidence: float
    latitude: float
    longitude: float
    evidence_url: Optional[str] = None
    metadata_json: Optional[dict[str, Any]] = None
    source: str
    status: str
    ward: Optional[str] = None
    gps_accuracy: Optional[float] = None
    track_id: Optional[int] = None
    track_age_frames: Optional[int] = None
    consecutive_frames: Optional[int] = None
    fused_score: Optional[float] = None
    road_overlap_ratio: Optional[float] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EventListResponse(BaseModel):
    events: list[EventResponse]
    total: int
