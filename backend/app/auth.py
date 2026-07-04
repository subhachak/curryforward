"""
Minimal role model for local/personal use:
- Admin (you): full access — fork, persist chat edits, decide review queue items.
- Guest (anyone else you share the app with): can browse recipes and use chat
  to customize DURING THEIR SESSION, but nothing they do is persisted or
  forkable. This is enforced server-side, not just hidden in the UI.

No user accounts, no password hashing — this is a single-shared-secret model
appropriate for "share my laptop's local app with family/friends for testing",
not a multi-tenant production auth system. If this app ever needs real
multi-user accounts, replace this file with proper auth — don't extend it.
"""
from __future__ import annotations

import os

from fastapi import Header, HTTPException


def get_role(x_admin_token: str | None = Header(default=None)) -> str:
    admin_token = os.environ.get("ADMIN_TOKEN")
    if admin_token and x_admin_token == admin_token:
        return "admin"
    return "guest"


def require_admin(x_admin_token: str | None = Header(default=None)) -> str:
    role = get_role(x_admin_token)
    if role != "admin":
        raise HTTPException(403, "This action requires admin access.")
    return role
