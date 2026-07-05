from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from ..models import RecipeVersion
from ..nutrition import compute_nutrition
from ..schemas import RecipeUpsertRequest


RICH_CONTENT_FIELDS = [
    "intro",
    "history",
    "prep_time_minutes",
    "cook_time_minutes",
    "tips",
    "watch_outs",
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


def create_manual_recipe(req: RecipeUpsertRequest) -> RecipeVersion:
    components = req.normalized_components()
    return RecipeVersion(
        recipe_id=f"manual-{uuid.uuid4().hex[:8]}",
        parent_version_id=None,
        lineage="manual",
        name=req.name,
        category=req.category,
        cuisine_tags=req.cuisine_tags,
        base_servings_amount=req.base_servings_amount,
        base_servings_unit=req.base_servings_unit,
        serving_size_amount=req.serving_size_amount,
        serving_size_unit=req.serving_size_unit,
        components=components,
        steps=req.normalized_steps(),
        nutrition=compute_nutrition(components),
        hero_image_url=req.hero_image_url,
        status="draft",
        source="manual",
        is_current_head=True,
    )


def create_chat_edit_version(current: RecipeVersion, result: dict) -> RecipeVersion:
    components = result["components"]
    kwargs: dict[str, Any] = {
        "recipe_id": current.recipe_id,
        "parent_version_id": current.version_id,
        "lineage": "edit",
        "name": current.name,
        "category": current.category,
        "cuisine_tags": current.cuisine_tags,
        "base_servings_amount": current.base_servings_amount,
        "base_servings_unit": current.base_servings_unit,
        "serving_size_amount": current.serving_size_amount,
        "serving_size_unit": current.serving_size_unit,
        "components": components,
        "steps": steps_preserving_images(current.steps, result["steps"]),
        "nutrition": compute_nutrition(components),
        "hero_image_url": current.hero_image_url,
        "source": "user_customized",
        "status": current.status,
        "is_current_head": True,
    }
    _copy_rich_fields(current, kwargs)
    current.is_current_head = False
    return RecipeVersion(**kwargs)


def fork_recipe_version(current: RecipeVersion) -> RecipeVersion:
    kwargs: dict[str, Any] = {
        "recipe_id": f"{current.recipe_id}-fork-{uuid.uuid4().hex[:6]}",
        "parent_version_id": current.version_id,
        "lineage": "fork",
        "name": f"{current.name} (copy)",
        "category": current.category,
        "cuisine_tags": current.cuisine_tags,
        "base_servings_amount": current.base_servings_amount,
        "base_servings_unit": current.base_servings_unit,
        "serving_size_amount": current.serving_size_amount,
        "serving_size_unit": current.serving_size_unit,
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
    return db.query(RecipeVersion).filter(
        RecipeVersion.recipe_id == recipe_id,
        RecipeVersion.is_current_head == True,  # noqa: E712
        RecipeVersion.deleted_at.is_(None),
    )
