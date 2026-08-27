from __future__ import annotations

import json
import random
import time
from pathlib import Path
from typing import Any

from edge.utils.logger import log

QUEUE_FILE = "data/events_queue.json"
MAX_RETRIES = 5
RETRY_DELAYS = [1, 2, 5, 10, 30]
BATCH_SIZE = 10

PENDING = "PENDING"
UPLOADING = "UPLOADING"
UPLOADED = "UPLOADED"
FAILED = "FAILED"
DEAD_LETTER = "DEAD_LETTER"


def _with_jitter(delay: float) -> float:
    return delay * (0.9 + random.random() * 0.2)


class EventUploadQueue:
    """Persistent, crash-safe event queue with a clear per-event state machine.

    States: PENDING -> UPLOADING -> UPLOADED
                               -> FAILED -> (retry) -> PENDING
                               -> (max retries) -> DEAD_LETTER
    4xx responses are routed straight to DEAD_LETTER (validation errors never
    benefit from retrying).
    """

    def __init__(self, queue_file: str = QUEUE_FILE, max_retries: int = MAX_RETRIES) -> None:
        self._queue_file = Path(queue_file)
        self._pending: list[dict[str, Any]] = []
        self._retry_counts: dict[str, int] = {}
        self._retry_timestamps: dict[str, float] = {}
        self._states: dict[str, str] = {}
        self._dead_letters: list[dict[str, Any]] = []
        self._max_retries = max_retries
        self._load_from_disk()

    def enqueue(self, event_data: dict[str, Any]) -> None:
        event_id = event_data.get("event_id", "unknown")
        if event_id in self._states and self._states.get(event_id) == UPLOADED:
            return
        self._retry_counts[event_id] = 0
        self._retry_timestamps[event_id] = time.time()
        self._states[event_id] = PENDING
        self._pending = [e for e in self._pending if e.get("event_id") != event_id]
        self._pending.append(event_data)
        log.info("[QUEUE] Enqueued: %s (total pending: %d)", event_id, len(self._pending))
        self._save_to_disk()

    def dequeue_batch(self, max_batch: int = BATCH_SIZE) -> list[dict[str, Any]]:
        now = time.time()
        ready = []
        for item in self._pending:
            eid = item.get("event_id", "unknown")
            ts = self._retry_timestamps.get(eid, 0)
            if ts <= now:
                self._states[eid] = UPLOADING
                ready.append(item)
            if len(ready) >= max_batch:
                break
        return ready

    def mark_success(self, event_ids: list[str]) -> None:
        self._pending = [e for e in self._pending if e.get("event_id") not in event_ids]
        for eid in event_ids:
            self._retry_counts.pop(eid, None)
            self._retry_timestamps.pop(eid, None)
            self._states[eid] = UPLOADED
        self._save_to_disk()

    def mark_failed(self, event_id: str) -> bool:
        count = self._retry_counts.get(event_id, 0) + 1
        self._retry_counts[event_id] = count
        if count >= self._max_retries:
            self._pending = [e for e in self._pending if e.get("event_id") != event_id]
            self._retry_counts.pop(event_id, None)
            self._retry_timestamps.pop(event_id, None)
            self._states[event_id] = DEAD_LETTER
            log.warning("[QUEUE] Dead-lettered %s after %d retries", event_id, count)
        else:
            delay = RETRY_DELAYS[min(count - 1, len(RETRY_DELAYS) - 1)]
            self._retry_timestamps[event_id] = time.time() + _with_jitter(delay)
            self._states[event_id] = FAILED
            log.warning("[QUEUE] Retry %d/%d for %s in %.1fs", count, self._max_retries, event_id, delay)
        self._save_to_disk()
        return count < self._max_retries

    def dead_letter(self, event_id: str) -> None:
        """Route a permanently-rejected event out of the retry loop."""
        for e in list(self._pending):
            if e.get("event_id") == event_id:
                self._dead_letters.append({**e, "_rejected": True})
                self._pending.remove(e)
        self._retry_counts.pop(event_id, None)
        self._retry_timestamps.pop(event_id, None)
        self._states[event_id] = DEAD_LETTER
        log.warning("[QUEUE] Dead-lettered %s (rejected by backend)", event_id)
        self._save_to_disk()

    def requeue_dead_letters(self) -> int:
        """Re-queue dead letters (e.g. after a backend fix) — returns count."""
        count = 0
        for e in list(self._dead_letters):
            e.pop("_rejected", None)
            eid = e.get("event_id", "unknown")
            self._retry_counts[eid] = 0
            self._retry_timestamps[eid] = time.time()
            self._states[eid] = PENDING
            self._pending.append(e)
            self._dead_letters.remove(e)
            count += 1
        if count:
            self._save_to_disk()
        return count

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    @property
    def dead_letter_count(self) -> int:
        return len(self._dead_letters)

    def state(self, event_id: str) -> str:
        return self._states.get(event_id, "UNKNOWN")

    def _save_to_disk(self) -> None:
        try:
            self._queue_file.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "pending": self._pending,
                "dead_letters": self._dead_letters,
                "retry_counts": {k: v for k, v in self._retry_counts.items()},
                "retry_timestamps": {k: v for k, v in self._retry_timestamps.items()},
                "states": {k: v for k, v in self._states.items()},
            }
            tmp = self._queue_file.with_suffix(".json.tmp")
            with open(tmp, "w") as f:
                json.dump(payload, f)
            tmp.replace(self._queue_file)
        except Exception as e:
            log.warning("[QUEUE] Failed to persist: %s", e)

    def _load_from_disk(self) -> None:
        if not self._queue_file.exists():
            return
        try:
            with open(self._queue_file) as f:
                payload = json.load(f)
            self._pending = payload.get("pending", [])
            self._dead_letters = payload.get("dead_letters", [])
            self._retry_counts = {**payload.get("retry_counts", {})}
            self._retry_timestamps = {k: float(v) for k, v in payload.get("retry_timestamps", {}).items()}
            self._states = {**payload.get("states", {})}
            for e in self._pending:
                self._states.setdefault(e.get("event_id", "unknown"), PENDING)
            log.info("[QUEUE] Restored %d pending + %d dead-letter events", len(self._pending), len(self._dead_letters))
        except Exception as e:
            # Never silently drop confirmed events: back up the corrupt file.
            backup = self._queue_file.with_suffix(".json.corrupt")
            try:
                self._queue_file.replace(backup)
                log.error("[QUEUE] Queue file was corrupt — moved to %s", backup)
            except Exception:
                pass
            self._pending = []
            self._dead_letters = []
