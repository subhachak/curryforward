from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from ..models import RecipeVersion
from ..nutrition import compute_nutrition, estimated_yield_grams
from ..schemas import RecipeUpsertRequest
from .ingredient_canonical import normalize_components_to_grams
from .recipe_identity import current_head_identity_query, ensure_recipe_identity, generate_admin_ref


RICH_CONTENT_FIELDS = [
    "intro",
    "history",
    "prep_time_minutes",
    "cook_time_minutes",
    "tips",
    "watch_outs",
    "suggested_utensils",
    "pan_conversions",
]


def steps_preserving_images(current_steps: list[dict] | None, next_steps: list[dict]) -> list[dict]:
    """Preserve existing step images by row position when an older/manual
    editor does not send image_url."""
    current_steps = current_steps or []
    merged = []
    for idx, step in enumerate(next_steps):
        next_step = dict(step)
        if "image_url" not in next_step and idx < len(current_steps):
            image_url = (current_steps[idx] or {}).get("image_url")
            if image_url:
                next_step["image_url"] = image_url
        merged.append(next_step)
    return merged


def _copy_rich_fields(source: RecipeVersion, target_kwargs: dict[str, Any]) -> None:
    for field in RICH_CONTENT_FIELDS:
        target_kwargs[field] = getattr(source, field)


def create_manual_recipe(req: RecipeUpsertRequest, db: Session | None = None) -> RecipeVersion:
    components = normalize_components_to_grams(req.normalized_components())
    yield_grams = estimated_yield_grams(components)
    version = RecipeVersion(
        recipe_id=f"manual-{uuid.uuid4().hex[:8]}",
        admin_ref=generate_admin_ref(),
        parent_version_id=None,
        lineage="manual",
        name=req.name,
        category=req.category,
        cuisine_tags=req.cuisine_tags,
        base_servings_amount=yield_grams,
        base_servings_unit="g",
        serving_size_amount=req.serving_size_amount or 100,
        serving_size_unit="g",
        components=components,
        steps=req.normalized_steps(),
        nutrition=compute_nutrition(components, db),
        hero_image_url=req.hero_image_url,
        status="draft",
        source="manual",
        is_current_head=True,
    )
    ensure_recipe_identity(version, db)
    return version


def create_chat_edit_version(current: RecipeVersion, result: dict, db: Session | None = None) -> RecipeVersion:
    components = normalize_components_to_grams(result["components"])
    yield_grams = estimated_yield_grams(components)
    kwargs: dict[str, Any] = {
        "recipe_id": current.recipe_id,
        "public_slug": current.public_slug,
        "admin_ref": generate_admin_ref(),
        "parent_version_id": current.version_id,
        "lineage": "edit",
        "name": current.name,
        "category": current.category,
        "cuisine_tags": current.cuisine_tags,
        "base_servings_amount": yield_grams,
        "base_servings_unit": "g",
        "serving_size_amount": current.serving_size_amount,
        "serving_size_unit": "g",
        "components": components,
        "steps": steps_preserving_images(current.steps, result["steps"]),
        "nutrition": compute_nutrition(components, db),
        "hero_image_url": current.hero_image_url,
        "source": "user_customized",
        "status": current.status,
        "is_current_head": True,
    }
    _copy_rich_fields(current, kwargs)
    current.is_current_head = False
    version = RecipeVersion(**kwargs)
    ensure_recipe_identity(version, db)
    return version


def fork_recipe_version(current: RecipeVersion) -> RecipeVersion:
    yield_grams = estimated_yield_grams(current.components or [])
    kwargs: dict[str, Any] = {
        "recipe_id": f"{current.recipe_id}-fork-{uuid.uuid4().hex[:6]}",
        "admin_ref": generate_admin_ref(),
        "parent_version_id": current.version_id,
        "lineage": "fork",
        "name": f"{current.name} (copy)",
        "category": current.category,
        "cuisine_tags": current.cuisine_tags,
        "base_servings_amount": yield_grams,
        "base_servings_unit": "g",
        "serving_size_amount": current.serving_size_amount,
        "serving_size_unit": "g",
        "components": current.components,
        "steps": current.steps,
        "nutrition": current.nutrition,
        "hero_image_url": current.hero_image_url,
        "status": "draft",
        "source": current.source or "seed",
        "is_current_head": True,
    }
    _copy_rich_fields(current, kwargs)
    return RecipeVersion(**kwargs)


def current_head_query(db: Session, recipe_id: str):
    return current_head_identity_query(db, recipe_id)
