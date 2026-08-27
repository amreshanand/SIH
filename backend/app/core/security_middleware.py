"""Security middleware: response headers + auth-path rate limiting.

Applied at the app level so it holds for every route (including any that are
called directly in tests via their service layer, which bypass HTTP anyway).
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from backend.app.core.config import settings
from backend.app.core.ratelimit import login_limiter, register_limiter


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        return response


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP rate limiting for login/register endpoints.

    Kept at the middleware layer (not endpoint deps) so that the endpoint
    signatures stay callable directly in integration tests.
    """

    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self._limits = {"login": 5, "register": 5}
        self._window = 60.0

    def _check(self, key: tuple[str, str]) -> None:
        now = time.time()
        limit = self._limits.get(key[1], 5)
        q = self._hits[key]
        while q and now - q[0] > self._window:
            q.popleft()
        if len(q) >= limit:
            raise TooManyRequests()
        q.append(now)

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        action = None
        if path.endswith("/auth/login"):
            action = "login"
        elif path.endswith("/auth/register"):
            action = "register"
        if action:
            host = request.client.host if request.client else "unknown"
            self._check((host, action))
        try:
            return await call_next(request)
        except TooManyRequests:
            return Response(status_code=429, content="Rate limit exceeded")


class TooManyRequests(Exception):
    pass
