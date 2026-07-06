from __future__ import annotations

import re
import uuid

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import RecipeVersion


def generate_admin_ref() -> str:
    return f"ref-{uuid.uuid4().hex[:12]}"


def slugify_recipe_name(name: str | None, fallback: str = "recipe") -> str:
    text = (name or fallback).strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or fallback


def unique_public_slug(db: Session, name: str | None, recipe_id: str | None = None) -> str:
    base = slugify_recipe_name(name, recipe_id or "recipe")
    slug = base
    suffix = 2
    while True:
        existing = (
            db.query(RecipeVersion)
            .filter(
                RecipeVersion.public_slug == slug,
                RecipeVersion.recipe_id != (recipe_id or ""),
            )
            .first()
        )
        if not existing:
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1


def ensure_recipe_identity(row: RecipeVersion, db: Session | None = None) -> None:
    if not row.admin_ref:
        row.admin_ref = generate_admin_ref()
    if (row.status or "published") == "published" and not row.public_slug and db is not None:
        row.public_slug = unique_public_slug(db, row.name, row.recipe_id)


def current_head_identity_query(db: Session, identifier: str):
    return db.query(RecipeVersion).filter(
        or_(
            RecipeVersion.recipe_id == identifier,
            RecipeVersion.public_slug == identifier,
            RecipeVersion.admin_ref == identifier,
        ),
        RecipeVersion.is_current_head == True,  # noqa: E712
        RecipeVersion.deleted_at.is_(None),
    )

