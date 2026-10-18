"""Phase 0 — Edge detection taxonomy truthfulness tests.

Verify that the normalize_road_damage_class() function:
  • Rejects generic RAD labels (roaddamages, roaddamage, road_damage,
    road_damages) — they must NEVER map to 'pothole' or any specific class.
  • Still correctly maps confirmed specific classes (D40→pothole, etc.).
  • Handles edge-cases (None, empty string, mixed case) gracefully.

These tests are pure-Python unit tests with no I/O or server dependency.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure repo root is on sys.path so ``edge.*`` imports resolve.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from edge.detection.classes import (
    GENERIC_ROAD_DAMAGE,
    ROAD_DAMAGE_ALIASES,
    ROAD_DAMAGE_CLASSES,
    normalize_road_damage_class,
)


# ── Generic RAD labels MUST be rejected / GENERIC_ROAD_DAMAGE ───────────────

_GENERIC_RAD_LABELS = ["roaddamages", "roaddamage", "road_damage", "road_damages"]


class TestGenericRADLabelsRejected:
    """Generic RAD labels must never silently map to 'pothole'."""

    @pytest.mark.parametrize("label", _GENERIC_RAD_LABELS)
    def test_never_pothole(self, label: str):
        """Core truthfulness guarantee: generic ≠ pothole."""
        result = normalize_road_damage_class(label)
        assert result != "pothole", (
            f"'{label}' was aliased to 'pothole' — this is a Phase 0 violation"
        )

    @pytest.mark.parametrize("label", _GENERIC_RAD_LABELS)
    def test_rejected_or_generic(self, label: str):
        """Generic labels must be rejected (None) or tagged GENERIC_ROAD_DAMAGE."""
        result = normalize_road_damage_class(label)
        assert result is None or result == GENERIC_ROAD_DAMAGE, (
            f"'{label}' returned '{result}' — expected None or GENERIC_ROAD_DAMAGE"
        )

    @pytest.mark.parametrize("label", _GENERIC_RAD_LABELS)
    def test_alias_table_entry_explicit(self, label: str):
        """Each generic label must have an explicit entry in the alias table
        (not silently fall through as unknown)."""
        key = label.strip().lower()
        assert key in ROAD_DAMAGE_ALIASES, (
            f"'{label}' is not explicitly listed in ROAD_DAMAGE_ALIASES — "
            f"it could be accidentally aliased in the future"
        )
        assert ROAD_DAMAGE_ALIASES[key] == GENERIC_ROAD_DAMAGE

    @pytest.mark.parametrize("label", _GENERIC_RAD_LABELS)
    def test_not_in_taxonomy(self, label: str):
        """Generic labels must NOT end up in the canonical 9-class taxonomy."""
        result = normalize_road_damage_class(label)
        if result is not None:
            assert result not in ROAD_DAMAGE_CLASSES


# ── Confirmed specific labels MUST still work ───────────────────────────────

class TestSpecificLabelsPreserved:
    """Specific, confirmed road-damage labels must map correctly."""

    def test_d40_pothole(self):
        assert normalize_road_damage_class("d40") == "pothole"

    def test_d40_pothole_variant(self):
        assert normalize_road_damage_class("d40_pothole") == "pothole"

    def test_pothole_direct(self):
        assert normalize_road_damage_class("pothole") == "pothole"

    def test_unsurfaced_road_to_surface_wear(self):
        assert normalize_road_damage_class("unsurfacedroad") == "surface_wear"

    def test_d00_longitudinal_crack(self):
        assert normalize_road_damage_class("d00") == "longitudinal_crack"

    def test_d10_transverse_crack(self):
        assert normalize_road_damage_class("d10") == "transverse_crack"

    def test_d20_alligator_crack(self):
        assert normalize_road_damage_class("d20") == "alligator_crack"

    def test_flooding_to_waterlogging(self):
        # waterlogging is in EXTENDED_HAZARD_CLASSES, not ROAD_DAMAGE_CLASSES
        result = normalize_road_damage_class("flooding")
        # waterlogging is NOT in the 9-class ROAD_DAMAGE_CLASSES, so normalize rejects it
        assert result is None or result == "waterlogging"


# ── Edge-case handling ──────────────────────────────────────────────────────

class TestEdgeCases:

    def test_none_input(self):
        assert normalize_road_damage_class(None) is None

    def test_empty_string(self):
        assert normalize_road_damage_class("") is None

    def test_whitespace_only(self):
        assert normalize_road_damage_class("   ") is None

    def test_case_insensitive(self):
        assert normalize_road_damage_class("Pothole") == "pothole"
        assert normalize_road_damage_class("POTHOLE") == "pothole"

    def test_unknown_class_returns_none(self):
        assert normalize_road_damage_class("spaceship") is None

    def test_vehicle_class_not_road_damage(self):
        assert normalize_road_damage_class("car") is None
        assert normalize_road_damage_class("bus") is None
