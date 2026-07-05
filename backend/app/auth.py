"""
Minimal role model for local/personal use:
- Admin (you): full access — fork, persist chat edits, and manage recipes.
- Guest (anyone else you share the app with): can browse recipes and use chat
  to customize DURING THEIR SESSION, but nothing they do is persisted or
  forkable. This is enforced server-side, not just hidden in the UI.

Still a single-shared-secret model (ADMIN_TOKEN in .env) — appropriate for
"share my laptop's local app with family/friends for testing", not a
multi-tenant production auth system. What changed from v0: instead of the
frontend asking the user to paste that secret into a token field on every
visit, there's a real /login form that exchanges the secret for a signed,
httpOnly session cookie (via itsdangerous), so the raw secret never sits in
localStorage or gets attached to every request. The X-Admin-Token header
path is kept alongside it for API/script access and to avoid breaking existing
callers/tests.

If this app ever needs real multi-user accounts, replace this file with
proper auth — don't extend it.
"""
from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Header, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

from .services.security import is_production

SESSION_COOKIE_NAME = "curryforward_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7  # 7 days


def _secret_key() -> str:
    # Falls back to the admin token itself so a session survives as long as
    # ADMIN_TOKEN doesn't change, without requiring a second secret in .env.
    return os.environ.get("SESSION_SECRET") or os.environ.get("ADMIN_TOKEN") or "insecure-dev-secret"


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_secret_key(), salt="curryforward-session")


def _create_session_cookie_value() -> str:
    return _serializer().dumps({"role": "admin"})


def _session_is_valid_admin(cookie_value: str | None) -> bool:
    if not cookie_value:
        return False
    try:
        data = _serializer().loads(cookie_value, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    return data.get("role") == "admin"


def get_role(request: Request, x_admin_token: str | None = Header(default=None)) -> str:
    admin_token = os.environ.get("ADMIN_TOKEN")
    if admin_token and x_admin_token and hmac.compare_digest(x_admin_token, admin_token):
        return "admin"
    if _session_is_valid_admin(request.cookies.get(SESSION_COOKIE_NAME)):
        return "admin"
    return "guest"


def require_admin(request: Request, x_admin_token: str | None = Header(default=None)) -> str:
    role = get_role(request, x_admin_token)
    if role != "admin":
        raise HTTPException(403, "This action requires admin access.")
    return role


class LoginRequest(BaseModel):
    password: str


router = APIRouter(prefix="/api/auth")


@router.post("/login")
def login(req: LoginRequest, response: Response):
    admin_token = os.environ.get("ADMIN_TOKEN")
    if not admin_token or not hmac.compare_digest(req.password, admin_token):
        raise HTTPException(401, "Incorrect password")
    response.set_cookie(
        SESSION_COOKIE_NAME,
        _create_session_cookie_value(),
        httponly=True,
        secure=is_production(),
        samesite="lax",
        max_age=SESSION_MAX_AGE_SECONDS,
    )
    return {"role": "admin"}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME, secure=is_production(), samesite="lax")
    return {"role": "guest"}
