"""Detection class constants for UrbanSense AI.

Central place for the class names emitted by the real YOLO models. The vehicle
classes come from COCO; the road-damage classes come from the custom model.
"""

# COCO classes monitored for vehicle/pedestrian awareness.
VEHICLE_CLASSES = {"car", "motorcycle", "bus", "truck", "bicycle"}
PEDESTRIAN_CLASS = "person"
ALL_DETECTABLE_CLASSES = VEHICLE_CLASSES | {PEDESTRIAN_CLASS}

# Canonical road-damage taxonomy (9 core pavement structural defect classes).
ROAD_DAMAGE_CLASSES = frozenset(
    {
        "pothole",
        "longitudinal_crack",
        "transverse_crack",
        "alligator_crack",
        "edge_break",
        "rutting",
        "surface_wear",
        "patch_failure",
        "utility_cover_damage",
    }
)

EXTENDED_HAZARD_CLASSES = frozenset({"waterlogging"})
ALL_ROAD_HAZARD_CLASSES = ROAD_DAMAGE_CLASSES | EXTENDED_HAZARD_CLASSES

# Sentinel for generic/umbrella RAD labels that MUST NOT be silently aliased
# to a specific defect class (especially not 'pothole'). normalize_road_damage_class()
# returns None for these — the caller sees an explicit rejection.
GENERIC_ROAD_DAMAGE = "GENERIC_ROAD_DAMAGE"

# Explicit negative/suppression classes to reject false positives.
NEGATIVE_EXCLUSION_CLASSES = frozenset(
    {
        "manhole_cover_intact",
        "repaired_patch_intact",
        "lane_marking",
        "zebra_crossing",
        "shadow_artifact",
        "speed_breaker",
    }
)

# Human-readable display labels (used in evidence overlays / dashboards).
ROAD_DAMAGE_LABELS = {
    "pothole": "Pothole",
    "longitudinal_crack": "Longitudinal Crack",
    "transverse_crack": "Transverse Crack",
    "alligator_crack": "Alligator Crack",
    "edge_break": "Edge Break",
    "rutting": "Rutting",
    "surface_wear": "Surface Wear",
    "patch_failure": "Patch Failure",
    "utility_cover_damage": "Utility Cover Damage",
    "waterlogging": "Waterlogging",
}

# Normalization: a real model may be trained with its own class vocabulary
# (e.g. generic "crack", "patch", "surface_failure", or RDD2022 "Crack"/"Pothole").
# This maps raw model outputs onto the canonical 9-class taxonomy so downstream
# routing, severity and analytics always work on a stable vocabulary.
ROAD_DAMAGE_ALIASES = {
    "pothole": "pothole",
    "potholes": "pothole",
    "longitudinal_crack": "longitudinal_crack",
    "longitudinal": "longitudinal_crack",
    "transverse_crack": "transverse_crack",
    "transverse": "transverse_crack",
    "alligator_crack": "alligator_crack",
    "alligator": "alligator_crack",
    "edge_break": "edge_break",
    "edgebreak": "edge_break",
    "rutting": "rutting",
    "surface_wear": "surface_wear",
    "surface_failure": "surface_wear",
    "surfacewear": "surface_wear",
    "wear": "surface_wear",
    "patch_failure": "patch_failure",
    "patchfailure": "patch_failure",
    "patch": "patch_failure",
    "utility_cover_damage": "utility_cover_damage",
    "utility_cover": "utility_cover_damage",
    "manhole": "utility_cover_damage",
    "manhole_cover": "utility_cover_damage",
    "waterlogging": "waterlogging",
    "flooding": "waterlogging",
    # Generic crack collapse onto the taxonomy families only when no finer
    # subclass exists; the 9-class training config disambiguates them.
    "road_crack": "transverse_crack",
    "crack": "transverse_crack",
    # RDD2022 Road Damage Dataset canonical classes (verified from models/training/rdd2022_train.py):
    "d00": "longitudinal_crack",
    "d00_longitudinal_crack": "longitudinal_crack",
    "d10": "transverse_crack",
    "d10_transverse_crack": "transverse_crack",
    "d20": "alligator_crack",
    "d20_alligator_crack": "alligator_crack",
    "d40": "pothole",
    "d40_pothole": "pothole",
    "d40_pothole_rutting": "pothole",
    # RAD (Road Anomaly Detection) Dataset verified classes (generic road damage is NOT aliased to pothole):
    "unsurfacedroad": "surface_wear",
    "unsurfaced_road": "surface_wear",
    "speedbump": "speed_breaker",
    "speed_bump": "speed_breaker",
    # Generic / umbrella RAD labels — explicitly rejected, never aliased to pothole.
    "roaddamage": GENERIC_ROAD_DAMAGE,
    "roaddamages": GENERIC_ROAD_DAMAGE,
    "road_damage": GENERIC_ROAD_DAMAGE,
    "road_damages": GENERIC_ROAD_DAMAGE,
}


def normalize_road_damage_class(raw: str) -> str | None:
    """Map a raw model class name onto the canonical 9-class taxonomy.

    Returns the canonical class name, or ``None`` if the raw class is not a
    recognized road-damage class (e.g. it belongs to the vehicle vocabulary
    or is a generic/umbrella label like ``GENERIC_ROAD_DAMAGE``).
    """
    key = (raw or "").strip().lower()
    canonical = ROAD_DAMAGE_ALIASES.get(key)
    if canonical is None:
        return None
    # GENERIC_ROAD_DAMAGE is deliberately NOT in ROAD_DAMAGE_CLASSES,
    # so it is rejected here — the label is too generic to classify.
    return canonical if canonical in ROAD_DAMAGE_CLASSES else None
