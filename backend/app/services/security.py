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


def client_ip(request: Request) -> str:
    """The client IP for rate-limiting and audit logging.

    Deliberately does NOT parse X-Forwarded-For/X-Real-IP itself — those are
    client-supplied headers, and parsing them here a second time would just
    duplicate (and risk conflicting with) uvicorn's own ProxyHeadersMiddleware,
    which already rewrites `request.client` for us when it decides to trust
    the immediate upstream hop (see --forwarded-allow-ips in run.sh/Dockerfile/
    launch.json). That's the single place this decision should be made: by
    default uvicorn trusts nothing, so this always reflects the real TCP
    peer; only when explicitly deployed behind a known reverse proxy (with
    --forwarded-allow-ips set to that proxy's address) does uvicorn — and
    therefore this — honor the forwarded headers. Trusting the header here
    too, independently, is exactly how the earlier version of this function
    was trivially spoofable: any direct caller could set X-Forwarded-For to
    whatever it wanted and get a fresh rate-limit bucket every request.
    """
    return request.client.host if request.client else "unknown"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        forwarded_proto = (request.headers.get("x-forwarded-proto") or "").lower()
        force_https = (
            is_production()
            or env_bool("FORCE_HTTPS", default=False)
            or request.url.scheme == "https"
            or "https" in {part.strip() for part in forwarded_proto.split(",")}
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; "
            "font-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        if force_https:
            csp = f"{csp}; upgrade-insecure-requests; block-all-mixed-content"
        response.headers.setdefault(
            "Content-Security-Policy",
            csp,
        )
        if force_https:
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
        ip = client_ip(request)
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
