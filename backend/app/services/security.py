from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def is_production() -> bool:
    return (
        os.environ.get("APP_ENV", "").lower() == "production"
        or os.environ.get("ENVIRONMENT", "").lower() == "production"
        or os.environ.get("RAILWAY_ENVIRONMENT", "").lower() == "production"
    )


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; "
            "font-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'",
        )
        if is_production() or env_bool("FORCE_HTTPS", default=False):
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.enabled = env_bool("RATE_LIMIT_ENABLED", default=True)
        self.window_seconds = _int_env("RATE_LIMIT_WINDOW_SECONDS", 60)
        self.default_limit = _int_env("RATE_LIMIT_DEFAULT_PER_MINUTE", 600)
        self.login_limit = _int_env("RATE_LIMIT_LOGIN_PER_MINUTE", 8)
        self.feedback_limit = _int_env("RATE_LIMIT_FEEDBACK_PER_MINUTE", 20)
        self.llm_limit = _int_env("RATE_LIMIT_LLM_PER_MINUTE", 120)
        self.upload_limit = _int_env("RATE_LIMIT_UPLOAD_PER_MINUTE", 20)
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if not self.enabled:
            return await call_next(request)
        key_name, limit = self._bucket_for(request)
        if limit <= 0:
            return await call_next(request)
        ip = self._client_ip(request)
        bucket = self._hits[(ip, key_name)]
        now = time.monotonic()
        while bucket and now - bucket[0] > self.window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            return JSONResponse(
                {"detail": "Too many requests. Please wait a moment and try again."},
                status_code=429,
                headers={"Retry-After": str(self.window_seconds)},
            )
        bucket.append(now)
        return await call_next(request)

    def _bucket_for(self, request: Request) -> tuple[str, int]:
        path = request.url.path
        method = request.method.upper()
        if path == "/api/auth/login" and method == "POST":
            return "login", self.login_limit
        if path.endswith("/feedback") and method == "POST":
            return "feedback", self.feedback_limit
        if path == "/api/uploads" and method == "POST":
            return "upload", self.upload_limit
        if method == "POST" and (
            path.endswith("/chat")
            or path.endswith("/chat/")
            or path.endswith("/auto/plan")
            or path.endswith("/auto/run")
            or path.endswith("/refine")
            or path.endswith("/rewrite")
            or path.endswith("/wide-edit")
            or path in {"/api/admin/rewrite", "/api/recipes/draft", "/api/recipes/generate"}
        ):
            return "llm", self.llm_limit
        return "default", self.default_limit

    @staticmethod
    def _client_ip(request: Request) -> str:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
        return request.client.host if request.client else "unknown"
