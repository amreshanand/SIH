"""In-memory sliding-window rate limiter.

Prototype-grade limiter that guards login/register/event/verification endpoints.
This is intentionally single-process; a deployment behind multiple workers
should move this to Redis, but for the demo scope it is correct and lightweight.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException


class SlidingWindowLimiter:
    def __init__(self, max_requests: int, window_seconds: int = 60) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.time()
        q = self._hits[key]
        while q and now - q[0] > self._window:
            q.popleft()
        if len(q) >= self._max:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Try again in {int(self._window - (now - q[0]))}s.",
            )
        q.append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


# Shared instances (one per concern so a flood of logins can't starve events).
login_limiter = SlidingWindowLimiter(5)
register_limiter = SlidingWindowLimiter(5)
event_limiter = SlidingWindowLimiter(120)
verification_limiter = SlidingWindowLimiter(120)
