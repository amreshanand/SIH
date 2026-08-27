from __future__ import annotations

import time


ONLINE = "ONLINE"
DEGRADED = "DEGRADED"
OFFLINE = "OFFLINE"
RECONNECTING = "RECONNECTING"


class ComponentState:
    """Tracks the health of a single edge component (CAMERA/GPS/AI/BACKEND/QUEUE).

    A component reports when it is working (mark_online) or failing
    (mark_offline). A reported failure is downgraded from ONLINE to RECONNECTING
    and back to ONLINE once the component recovers.
    """

    def __init__(self, name: str) -> None:
        self.name = name
        self.state = OFFLINE
        self.last_change = time.time()
        self.success_count = 0
        self.failure_count = 0
        self.last_message: str | None = None

    def _set(self, state: str, message: str | None = None) -> None:
        if state != self.state:
            self.state = state
            self.last_change = time.time()
        if message:
            self.last_message = message

    def mark_online(self, message: str | None = None) -> None:
        self.success_count += 1
        self.failure_count = 0
        self._set(ONLINE, message)

    def mark_degraded(self, message: str | None = None) -> None:
        self.success_count += 1
        self._set(DEGRADED, message)

    def mark_failure(self, message: str | None = None) -> None:
        self.failure_count += 1
        if self.state == ONLINE:
            self._set(RECONNECTING, message)
        else:
            self._set(OFFLINE, message)

    def to_dict(self) -> dict:
        return {
            "component": self.name,
            "state": self.state,
            "since": self.last_change,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "message": self.last_message,
        }


class EdgeStateTracker:
    """Registry of per-component states for the whole edge device."""

    def __init__(self) -> None:
        self.components: dict[str, ComponentState] = {
            "CAMERA": ComponentState("CAMERA"),
            "GPS": ComponentState("GPS"),
            "AI": ComponentState("AI"),
            "BACKEND": ComponentState("BACKEND"),
            "QUEUE": ComponentState("QUEUE"),
        }
        self._session_id: str | None = None

    def component(self, name: str) -> ComponentState:
        return self.components.setdefault(name, ComponentState(name))

    def set_session(self, session_id: str) -> None:
        self._session_id = session_id

    @property
    def session_id(self) -> str | None:
        return self._session_id

    def snapshot(self) -> dict:
        return {
            "session_id": self._session_id,
            "components": {k: v.to_dict() for k, v in self.components.items()},
        }

    def online_count(self) -> int:
        return sum(1 for c in self.components.values() if c.state == ONLINE)

    def degraded_count(self) -> int:
        return sum(1 for c in self.components.values() if c.state == DEGRADED)


edge_state = EdgeStateTracker()
