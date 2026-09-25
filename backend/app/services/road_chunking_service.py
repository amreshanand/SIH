"""500-Meter Road Chunking & Linear Referencing Service.

Discretizes urban transit corridors into standard 500-meter physical segments.
Each chunk carries:
  - Permanent unique ID (e.g. CHK-FCR-001, CHK-KOT-002)
  - Linear chainage (e.g. 0m - 500m, 500m - 1000m)
  - Geometric polyline [start_lat/lon, center_lat/lon, end_lat/lon]
  - Ward and corridor association
  - Dynamic 0-100 Pavement Condition Index (PCI) / Health Score
  - Real-time aggregated active issues count and defect taxonomy
"""

from __future__ import annotations

import math
from typing import Any, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.issue import Issue


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two decimal degree points."""
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def point_to_segment_distance_m(
    plat: float, plon: float,
    alat: float, alon: float,
    blat: float, blon: float,
) -> float:
    """Perpendicular or endpoint distance from P to line segment AB in meters."""
    d_ab = haversine_m(alat, alon, blat, blon)
    if d_ab < 1e-6:
        return haversine_m(plat, plon, alat, alon)

    # Convert to approximate local Cartesian coordinates in meters
    avg_lat = math.radians((alat + blat) / 2.0)
    cos_lat = math.cos(avg_lat)
    m_per_deg_lat = 111132.95
    m_per_deg_lon = 111412.84 * cos_lat

    ax, ay = alon * m_per_deg_lon, alat * m_per_deg_lat
    bx, by = blon * m_per_deg_lon, blat * m_per_deg_lat
    px, py = plon * m_per_deg_lon, plat * m_per_deg_lat

    dx, dy = bx - ax, by - ay
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))

    closest_x = ax + t * dx
    closest_y = ay + t * dy

    dist = math.hypot(px - closest_x, py - closest_y)
    return dist


# Master corridor definitions for Pune metropolitan transit corridors
CORRIDOR_WAYPOINTS = [
    {
        "id": "FC_ROAD_VIMAN_NAGAR",
        "prefix": "FCR",
        "name": "FC Road – Viman Nagar BRT Corridor",
        "ward": "Shivajinagar - Ward 4",
        "stops": [
            ("Swargate Bus Bay", 18.5010, 73.8610),
            ("Tilak Road Crossing", 18.5080, 73.8540),
            ("Alka Talkies Chowk", 18.5140, 73.8470),
            ("Deccan Gymkhana", 18.5180, 73.8420),
            ("Goodluck Chowk", 18.5220, 73.8415),
            ("FC Road Main", 18.5270, 73.8410),
            ("Agriculture College", 18.5300, 73.8420),
            ("Shivajinagar Depot", 18.5318, 73.8428),
            ("COEP Flyover", 18.5300, 73.8510),
            ("Sangamwadi BRT", 18.5360, 73.8690),
            ("Yerawada Bridge", 18.5480, 73.8810),
            ("Yerawada Chowk", 18.5520, 73.8820),
            ("Shastri Nagar", 18.5570, 73.8960),
            ("Ramwadi Metro", 18.5600, 73.9040),
            ("Phoenix Marketcity", 18.5630, 73.9100),
            ("Viman Nagar Main Road", 18.5679, 73.9143),
            ("Symbiosis College", 18.5720, 73.9160),
            ("Airport Approach Road", 18.5820, 73.9180),
        ],
    },
    {
        "id": "KOTHRUD_HINJAWADI_EXPRESS",
        "prefix": "KOT",
        "name": "Kothrud – Hinjawadi Transit Expressway",
        "ward": "Kothrud - Ward 12",
        "stops": [
            ("Kothrud Stand", 18.5074, 73.8077),
            ("Karve Road Divider", 18.5100, 73.8320),
            ("Law College Road", 18.5190, 73.8330),
            ("SB Road Junction", 18.5320, 73.8340),
            ("Pune University Circle", 18.5523, 73.8294),
            ("Aundh Parihar Chowk", 18.5572, 73.8106),
            ("Baner Road Metro Pillar", 18.5592, 73.7884),
            ("Balewadi High Street", 18.5780, 73.7720),
            ("Wakad Bridge Highway Merge", 18.5890, 73.7780),
            ("Hinjawadi Phase 1 Wipro Circle", 18.5950, 73.7420),
        ],
    },
    {
        "id": "PUNE_STATION_KHARADI_LINE",
        "prefix": "STN",
        "name": "Pune Station – Kharadi IT Corridor",
        "ward": "Pune Station - Ward 2",
        "stops": [
            ("Pune Station", 18.5306, 73.8730),
            ("Ruby Hall Clinic", 18.5320, 73.8810),
            ("Bund Garden", 18.5390, 73.8860),
            ("Koregaon Park South Main Rd", 18.5360, 73.8990),
            ("Kalyani Nagar Bridge", 18.5470, 73.9040),
            ("Vadgaon Sheri Main", 18.5520, 73.9240),
            ("Kharadi Bypass Crossing", 18.5490, 73.9390),
            ("EON Free Zone IT Park", 18.5530, 73.9510),
            ("Wagholi Outer Junction", 18.5800, 73.9800),
        ],
    },
    {
        "id": "KATRAJ_HADAPSAR_CORRIDOR",
        "prefix": "KAT",
        "name": "Katraj – Hadapsar Outer Ring Corridor",
        "ward": "Hadapsar - Ward 9",
        "stops": [
            ("Katraj Snake Park", 18.4550, 73.8560),
            ("Bharati Vidyapeeth", 18.4620, 73.8540),
            ("Bibvewadi Chowk", 18.4770, 73.8650),
            ("Market Yard Gate", 18.4910, 73.8700),
            ("Lullanagar Signal", 18.4980, 73.8860),
            ("Fatima Nagar Incline", 18.5040, 73.8990),
            ("Hadapsar Gadital Depot", 18.5020, 73.9280),
            ("Magarpatta South Gate", 18.5140, 73.9310),
        ],
    },
    {
        "id": "OLD_HIGHWAY_PCMC_METRO_LINK",
        "prefix": "PCM",
        "name": "Old Highway – PCMC Metro Transit Link",
        "ward": "Pimpri-Chinchwad Ward 1",
        "stops": [
            ("Shivajinagar Station", 18.5318, 73.8428),
            ("Khadki Bazaar", 18.5600, 73.8520),
            ("Bopodi Chowk", 18.5720, 73.8380),
            ("Dapodi Bridge", 18.5800, 73.8290),
            ("Kasarwadi", 18.5950, 73.8210),
            ("Pimpri Chowk", 18.6150, 73.8070),
            ("Chinchwad Station", 18.6330, 73.7950),
            ("Akurdi Chowk", 18.6470, 73.7850),
            ("Nigdi / Ravet Terminal", 18.6300, 73.7500),
        ],
    },
    {
        "id": "AIRPORT_DHANORI_CIRCULAR",
        "prefix": "ARP",
        "name": "Airport – Dhanori Transit Route",
        "ward": "Yerawada - Ward 6",
        "stops": [
            ("Pune Station", 18.5306, 73.8730),
            ("Sangam Bridge", 18.5360, 73.8690),
            ("Holkar Bridge", 18.5510, 73.8650),
            ("Vishrantwadi Circle", 18.5670, 73.8780),
            ("Tingre Nagar", 18.5740, 73.8890),
            ("Dhanori Police Chowki", 18.5810, 73.9010),
            ("Lohegaon Airport Arrival", 18.5867, 73.9200),
        ],
    },
]


class RoadChunkService:
    """Manages 500-meter road segments across municipal corridors."""

    _instance: Optional[RoadChunkService] = None

    def __init__(self, chunk_size_m: float = 500.0) -> None:
        self.chunk_size_m = chunk_size_m
        self.chunks: list[dict[str, Any]] = []
        self._chunks_by_id: dict[str, dict[str, Any]] = {}
        self._generate_chunks()

    @classmethod
    def get_instance(cls) -> RoadChunkService:
        if cls._instance is None:
            cls._instance = RoadChunkService()
        return cls._instance

    def _generate_chunks(self) -> None:
        """Discretizes each corridor polyline into uniform 500-meter chunks."""
        chunks: list[dict[str, Any]] = []

        for corridor in CORRIDOR_WAYPOINTS:
            prefix = corridor["prefix"]
            corridor_id = corridor["id"]
            corridor_name = corridor["name"]
            default_ward = corridor["ward"]
            stops = corridor["stops"]

            cum_dist = 0.0
            chunk_idx = 1

            for i in range(len(stops) - 1):
                start_name, s_lat, s_lon = stops[i]
                end_name, e_lat, e_lon = stops[i + 1]
                leg_dist = haversine_m(s_lat, s_lon, e_lat, e_lon)
                if leg_dist <= 0:
                    continue

                # Subdivide leg into ~500m chunks
                num_steps = max(1, math.ceil(leg_dist / self.chunk_size_m))
                for step in range(num_steps):
                    frac_start = step / num_steps
                    frac_end = (step + 1) / num_steps

                    c_start_lat = s_lat + frac_start * (e_lat - s_lat)
                    c_start_lon = s_lon + frac_start * (e_lon - s_lon)
                    c_end_lat = s_lat + frac_end * (e_lat - s_lat)
                    c_end_lon = s_lon + frac_end * (e_lon - s_lon)

                    c_center_lat = (c_start_lat + c_end_lat) / 2.0
                    c_center_lon = (c_start_lon + c_end_lon) / 2.0

                    seg_len = haversine_m(c_start_lat, c_start_lon, c_end_lat, c_end_lon)
                    chain_start = cum_dist
                    chain_end = cum_dist + seg_len
                    cum_dist += seg_len

                    chunk_id = f"CHK-{prefix}-{chunk_idx:03d}"
                    chunk_name = f"{corridor_name.split('–')[0].strip()} · {start_name} → {end_name}"

                    chain_label = (
                        f"{int(chain_start)}m - {int(chain_end)}m"
                        if chain_end < 1000
                        else f"{chain_start / 1000:.1f}km - {chain_end / 1000:.1f}km"
                    )

                    chunk_record = {
                        "chunk_id": chunk_id,
                        "corridor_id": corridor_id,
                        "corridor_name": corridor_name,
                        "chunk_name": chunk_name,
                        "chainage": chain_label,
                        "chainage_start_m": round(chain_start, 1),
                        "chainage_end_m": round(chain_end, 1),
                        "length_m": round(seg_len, 1),
                        "start_lat": round(c_start_lat, 6),
                        "start_lon": round(c_start_lon, 6),
                        "end_lat": round(c_end_lat, 6),
                        "end_lon": round(c_end_lon, 6),
                        "center_lat": round(c_center_lat, 6),
                        "center_lon": round(c_center_lon, 6),
                        "ward": default_ward,
                        "polyline": [
                            [round(c_start_lat, 6), round(c_start_lon, 6)],
                            [round(c_end_lat, 6), round(c_end_lon, 6)],
                        ],
                    }
                    chunks.append(chunk_record)
                    self._chunks_by_id[chunk_id] = chunk_record
                    chunk_idx += 1

        self.chunks = chunks

    def assign_chunk(self, lat: float, lon: float) -> dict[str, Any]:
        """Maps any coordinate point (lat, lon) to its closest 500m road chunk."""
        best_chunk: dict[str, Any] | None = None
        min_distance = float("inf")

        for chunk in self.chunks:
            dist = point_to_segment_distance_m(
                lat, lon,
                chunk["start_lat"], chunk["start_lon"],
                chunk["end_lat"], chunk["end_lon"],
            )
            if dist < min_distance:
                min_distance = dist
                best_chunk = chunk

        if best_chunk is None:
            best_chunk = self.chunks[0]
            min_distance = 0.0

        return {
            "chunk_id": best_chunk["chunk_id"],
            "chunk_name": best_chunk["chunk_name"],
            "corridor_name": best_chunk["corridor_name"],
            "corridor_id": best_chunk["corridor_id"],
            "chainage": best_chunk["chainage"],
            "ward": best_chunk["ward"],
            "distance_to_chunk_m": round(min_distance, 1),
        }

    async def get_all_chunks_with_metrics(self, db: AsyncSession) -> list[dict[str, Any]]:
        """Returns all 500m chunks enriched with live active issues & PCI health scores."""
        # Query active issues from DB
        stmt = select(Issue).where(
            Issue.status.in_(["OPEN", "DETECTED", "CONFIRMED", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        )
        res = await db.execute(stmt)
        issues = list(res.scalars().all())

        # Group issues by chunk_id
        chunk_issues_map: dict[str, list[Issue]] = {c["chunk_id"]: [] for c in self.chunks}

        for issue in issues:
            assigned_chunk_id: Optional[str] = None
            if issue.metadata_json and isinstance(issue.metadata_json, dict):
                assigned_chunk_id = issue.metadata_json.get("chunk_id")

            # Fallback to coordinate spatial assignment
            if not assigned_chunk_id or assigned_chunk_id not in chunk_issues_map:
                assigned = self.assign_chunk(issue.latitude, issue.longitude)
                assigned_chunk_id = assigned["chunk_id"]

            if assigned_chunk_id in chunk_issues_map:
                chunk_issues_map[assigned_chunk_id].append(issue)

        # Build output enriched with health scores
        enriched: list[dict[str, Any]] = []

        for chunk in self.chunks:
            c_issues = chunk_issues_map.get(chunk["chunk_id"], [])
            crit = sum(1 for i in c_issues if i.severity == "CRITICAL")
            high = sum(1 for i in c_issues if i.severity == "HIGH")
            med = sum(1 for i in c_issues if i.severity == "MEDIUM")
            low = sum(1 for i in c_issues if i.severity == "LOW")

            # Pavement Condition Index (PCI) / Health calculation
            # Perfect score is 100; defects reduce health based on severity weight
            penalty = crit * 25 + high * 15 + med * 8 + low * 4
            health_score = max(0, 100 - penalty)

            if health_score >= 90:
                status = "EXCELLENT"
            elif health_score >= 75:
                status = "GOOD"
            elif health_score >= 50:
                status = "FAIR"
            else:
                status = "POOR"

            # Count by defect taxonomy
            types_count: dict[str, int] = {}
            for i in c_issues:
                t = i.issue_type
                types_count[t] = types_count.get(t, 0) + 1

            enriched.append({
                **chunk,
                "health_score": health_score,
                "status": status,
                "active_issues_count": len(c_issues),
                "severity_breakdown": {
                    "CRITICAL": crit,
                    "HIGH": high,
                    "MEDIUM": med,
                    "LOW": low,
                },
                "issue_types": types_count,
                "top_severity": "CRITICAL" if crit else "HIGH" if high else "MEDIUM" if med else "LOW" if low else None,
                "issues_preview": [
                    {
                        "issue_id": i.issue_id,
                        "type": i.issue_type,
                        "severity": i.severity,
                        "status": i.status,
                        "lat": i.latitude,
                        "lon": i.longitude,
                    }
                    for i in c_issues[:5]
                ],
            })

        return enriched

    async def get_chunk_details(self, chunk_id: str, db: AsyncSession) -> dict[str, Any] | None:
        """Returns details and full issue list for a specific 500m chunk."""
        chunk = self._chunks_by_id.get(chunk_id)
        if not chunk:
            return None

        all_chunks = await self.get_all_chunks_with_metrics(db)
        matched = next((c for c in all_chunks if c["chunk_id"] == chunk_id), None)
        if not matched:
            return None

        # Fetch full issue objects for this chunk
        stmt = select(Issue).where(
            Issue.status.in_(["OPEN", "DETECTED", "CONFIRMED", "ASSIGNED", "IN_PROGRESS", "REOPENED"])
        )
        res = await db.execute(stmt)
        issues = list(res.scalars().all())

        chunk_issues = []
        for i in issues:
            c_id = i.metadata_json.get("chunk_id") if (i.metadata_json and isinstance(i.metadata_json, dict)) else None
            if not c_id:
                c_id = self.assign_chunk(i.latitude, i.longitude)["chunk_id"]
            if c_id == chunk_id:
                chunk_issues.append({
                    "id": str(i.id),
                    "issue_id": i.issue_id,
                    "issue_type": i.issue_type,
                    "severity": i.severity,
                    "status": i.status,
                    "department": i.department,
                    "latitude": i.latitude,
                    "longitude": i.longitude,
                    "created_at": i.created_at.isoformat() if i.created_at else None,
                    "observation_count": i.observation_count,
                })

        return {
            **matched,
            "issues": chunk_issues,
        }


road_chunk_service = RoadChunkService.get_instance()
