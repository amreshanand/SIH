"""Pure operational-state calculation — no I/O, no settings, no side-effects.

The system's truthful operational state is derived from a handful of boolean
health conditions. By expressing this as a pure function we can unit-test every
branch deterministically without a running database or web server.
"""
from __future__ import annotations


# All legal operational states.
OPERATIONAL_STATES = frozenset({
    "REAL",
    "SIMULATED",
    "DEMO",
    "MODEL_MISSING",
    "DEGRADED",
    "OFFLINE",
})


def compute_operational_state(
    *,
    db_ok: bool,
    demo_mode: bool,
    vehicle_model_available: bool,
    road_damage_model_available: bool,
    gps_simulated: bool,
    postgis_ok: bool = True,
) -> str:
    """Compute the system's truthful operational state.

    Returns one of the ``OPERATIONAL_STATES`` constants:

    * **OFFLINE** — database is unreachable; nothing works.
    * **DEMO** — demo mode is active (simulated data pipeline).
    * **MODEL_MISSING** — *either* required model weight file is absent.
    * **SIMULATED** — GPS is in simulated mode (models present).
    * **DEGRADED** — both models present but PostGIS is unavailable.
    * **REAL** — fully operational: both models, real GPS, PostGIS available.
    """
    if not db_ok:
        return "OFFLINE"

    if demo_mode:
        return "DEMO"

    # Either model missing → MODEL_MISSING (never silently degrade)
    if not (vehicle_model_available and road_damage_model_available):
        return "MODEL_MISSING"

    if gps_simulated:
        return "SIMULATED"

    if not postgis_ok:
        return "DEGRADED"

    return "REAL"
