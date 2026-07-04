from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_role, require_admin
from ..db import get_db
from ..llm_agent import customize_recipe, generate_recipe_for_gap, is_configured
from ..models import RecipeVersion, ReviewQueueItem
from ..nutrition import compute_nutrition

router = APIRouter(prefix="/api")


class ChatRequest(BaseModel):
    message: str


class GenerateRequest(BaseModel):
    dish_name: str
    dietary: list[str] = []
    cuisine_style: str | None = None
    flavor_profile: list[str] = []


class ReviewDecision(BaseModel):
    approved: bool


@router.get("/recipes")
def list_recipes(db: Session = Depends(get_db)):
    """Returns the current-head version of every distinct recipe_id."""
    heads = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.is_current_head == True)  # noqa: E712
        .all()
    )
    return [
        {
            "recipe_id": r.recipe_id,
            "version_id": r.version_id,
            "name": r.name,
            "category": r.category,
            "lineage": r.lineage,
            "source": r.source,
        }
        for r in heads
    ]


@router.get("/recipes/{recipe_id}")
def get_recipe(recipe_id: str, db: Session = Depends(get_db)):
    version = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.recipe_id == recipe_id, RecipeVersion.is_current_head == True)  # noqa: E712
        .first()
    )
    if not version:
        raise HTTPException(404, "Recipe not found")
    return version.to_dict()


@router.get("/recipes/{recipe_id}/history")
def get_history(recipe_id: str, db: Session = Depends(get_db)):
    versions = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.recipe_id == recipe_id)
        .order_by(RecipeVersion.created_at)
        .all()
    )
    return [v.to_dict() for v in versions]


@router.post("/recipes/{recipe_id}/chat")
def chat_customize(
    recipe_id: str,
    req: ChatRequest,
    db: Session = Depends(get_db),
    role: str = Depends(get_role),
):
    """
    Conversational customization.
    - Admin: creates a NEW VERSION (linear update), persisted, same recipe_id.
    - Guest: returns the customized draft for THIS SESSION ONLY — nothing is
      written to the database. Refreshing the page loses it, and there is
      no way for a guest to make it permanent (no fork, no save).
    """
    current = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.recipe_id == recipe_id, RecipeVersion.is_current_head == True)  # noqa: E712
        .first()
    )
    if not current:
        raise HTTPException(404, "Recipe not found")
    if not is_configured():
        raise HTTPException(400, "ANTHROPIC_API_KEY not set — add it to backend/.env")

    try:
        result = customize_recipe(current.to_dict(), req.message)
    except Exception as e:
        raise HTTPException(500, f"LLM customization failed: {e}")

    nutrition = compute_nutrition(result["components"])

    if role != "admin":
        # Guest path: return the draft, persist nothing.
        return {
            "change_summary": result.get("change_summary", ""),
            "new_version": {
                **current.to_dict(),
                "components": result["components"],
                "steps": result["steps"],
                "nutrition": nutrition,
                "version_id": "session-preview-not-saved",
                "lineage": "session_preview",
                "source": "guest_session_only",
            },
            "persisted": False,
            "note": "You're in guest mode — this change is only visible for your current session and cannot be saved or forked.",
        }

    current.is_current_head = False
    new_version = RecipeVersion(
        recipe_id=recipe_id,
        parent_version_id=current.version_id,
        lineage="edit",
        name=current.name,
        category=current.category,
        cuisine_tags=current.cuisine_tags,
        base_servings_amount=current.base_servings_amount,
        base_servings_unit=current.base_servings_unit,
        components=result["components"],
        steps=result["steps"],
        nutrition=nutrition,
        source="user_customized",
        is_current_head=True,
    )
    db.add(new_version)
    db.commit()
    return {"change_summary": result.get("change_summary", ""), "new_version": new_version.to_dict(), "persisted": True}


@router.post("/recipes/{recipe_id}/fork")
def fork_recipe(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(require_admin)):
    """
    Fork: NEW recipe_id, independent history, parent_version_id points back
    to the version it was forked from. Does not affect the original's history.
    """
    current = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.recipe_id == recipe_id, RecipeVersion.is_current_head == True)  # noqa: E712
        .first()
    )
    if not current:
        raise HTTPException(404, "Recipe not found")

    new_recipe_id = f"{recipe_id}-fork-{uuid.uuid4().hex[:6]}"
    forked = RecipeVersion(
        recipe_id=new_recipe_id,
        parent_version_id=current.version_id,
        lineage="fork",
        name=f"{current.name} (fork)",
        category=current.category,
        cuisine_tags=current.cuisine_tags,
        base_servings_amount=current.base_servings_amount,
        base_servings_unit=current.base_servings_unit,
        components=current.components,
        steps=current.steps,
        nutrition=current.nutrition,
        source="seed",
        is_current_head=True,
    )
    db.add(forked)
    db.commit()
    return forked.to_dict()


@router.post("/recipes/generate")
def generate_recipe(
    req: GenerateRequest,
    db: Session = Depends(get_db),
    role: str = Depends(get_role),
):
    """
    Called when a requested dish isn't in the seed. Web-search-informed
    ORIGINAL generation (not retrieval) — new recipe_id, lineage='generated'.
    Guests get a session-only preview; only admin persists to the Recipe Store.
    """
    if not is_configured():
        raise HTTPException(400, "ANTHROPIC_API_KEY not set — add it to backend/.env")

    preferences = {
        "dietary": req.dietary,
        "cuisine_style": req.cuisine_style,
        "flavor_profile": req.flavor_profile,
    }
    try:
        result = generate_recipe_for_gap(req.dish_name, preferences)
    except Exception as e:
        raise HTTPException(500, f"Recipe generation failed: {e}")

    nutrition = compute_nutrition(result["components"])

    if role != "admin":
        return {
            "recipe_id": f"session-preview-{req.dish_name[:20]}",
            "name": result["name"],
            "category": result.get("category", "main"),
            "cuisine_tags": result.get("cuisine_tags", []),
            "base_servings": result["base_servings"],
            "components": result["components"],
            "steps": result["steps"],
            "nutrition": nutrition,
            "lineage": "session_preview",
            "source": "guest_session_only",
            "persisted": False,
            "note": "Guest mode — this generated recipe isn't saved and can't be forked.",
        }

    recipe_id = f"gen-{uuid.uuid4().hex[:8]}"
    version = RecipeVersion(
        recipe_id=recipe_id,
        parent_version_id=None,
        lineage="generated",
        name=result["name"],
        category=result.get("category", "main"),
        cuisine_tags=result.get("cuisine_tags", []),
        base_servings_amount=result["base_servings"]["amount"],
        base_servings_unit=result["base_servings"]["unit"],
        components=result["components"],
        steps=result["steps"],
        nutrition=nutrition,
        source="generated",
        is_current_head=True,
    )
    db.add(version)
    db.commit()
    return {**version.to_dict(), "persisted": True}


@router.get("/me")
def whoami(role: str = Depends(get_role)):
    return {"role": role}


@router.get("/review-queue")
def get_review_queue(db: Session = Depends(get_db)):
    items = db.query(ReviewQueueItem).filter(ReviewQueueItem.status == "pending").all()
    return [i.to_dict() for i in items]


@router.post("/review-queue/{item_id}/decide")
def decide_review_item(
    item_id: str,
    decision: ReviewDecision,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Human approval gate — per the locked policy, ambiguous extractions
    (multi-component mappings, prose-format sources) never auto-commit."""
    item = db.query(ReviewQueueItem).filter(ReviewQueueItem.item_id == item_id).first()
    if not item:
        raise HTTPException(404, "Review item not found")

    if decision.approved:
        raw = item.raw_extraction
        nutrition = compute_nutrition(raw.get("components", []))
        version = RecipeVersion(
            recipe_id=raw["recipe_id"],
            parent_version_id=None,
            lineage="seed",
            name=raw["name"],
            category="main",
            base_servings_amount=raw["base_servings"]["amount"],
            base_servings_unit=raw["base_servings"]["unit"],
            components=raw["components"],
            steps=raw["steps"],
            nutrition=nutrition,
            source="seed",
            is_current_head=True,
        )
        db.add(version)
        item.status = "approved"
    else:
        item.status = "rejected"

    db.commit()
    return {"status": item.status}
