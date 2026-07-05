from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_role, require_admin
from ..db import get_db
from ..llm_agent import (
    LLMInvalidResponseError,
    customize_recipe,
    draft_recipe_from_conversation,
    generate_recipe_for_gap,
    is_configured,
)
from ..models import RecipeAnalytics, RecipeVersion, ReviewQueueItem
from ..nutrition import compute_nutrition
from ..recipe_export import render_markdown
from ..schemas import RecipeDetailResponse, RecipeSummaryResponse, RecipeUpsertRequest
from ..services.recipe_versions import (
    create_chat_edit_version,
    create_manual_recipe,
    current_head_query,
    fork_recipe_version,
)

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


def _increment_analytics(db: Session, recipe_id: str, field: str) -> None:
    """Get-or-create-then-increment. Non-atomic (read-modify-write) — fine
    for a single-admin local SQLite app with no concurrent writers; a lost
    update under a race would just undercount by one, never corrupt state."""
    row = db.query(RecipeAnalytics).filter(RecipeAnalytics.recipe_id == recipe_id).first()
    if row is None:
        row = RecipeAnalytics(recipe_id=recipe_id)
        db.add(row)
        db.flush()
    setattr(row, field, getattr(row, field) + 1)
    db.commit()


class HistoryTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[HistoryTurn] = []


class DraftRequest(BaseModel):
    message: str
    history: list[HistoryTurn] = []
    draft: dict | None = None  # the in-progress recipe from a prior turn, if any


class GenerateRequest(BaseModel):
    dish_name: str
    dietary: list[str] = []
    cuisine_style: str | None = None
    flavor_profile: list[str] = []


class ReviewDecision(BaseModel):
    approved: bool


@router.get("/recipes", response_model=list[RecipeSummaryResponse], response_model_exclude_none=True)
def list_recipes(db: Session = Depends(get_db), role: str = Depends(get_role)):
    """Returns the current-head version of every distinct recipe_id. Draft
    (unpublished, e.g. still-in-research) and soft-deleted recipes are
    invisible to guests; admins see drafts too (with `status` attached) but
    never soft-deleted ones — those only appear via GET /api/admin/recipes/trash."""
    query = db.query(RecipeVersion).filter(
        RecipeVersion.is_current_head == True,  # noqa: E712
        RecipeVersion.deleted_at.is_(None),
    )
    if role != "admin":
        query = query.filter(RecipeVersion.status == "published")
    heads = query.all()
    return [
        {
            "recipe_id": r.recipe_id,
            "version_id": r.version_id,
            "name": r.name,
            "category": r.category,
            "cuisine_tags": r.cuisine_tags or [],
            "lineage": r.lineage,
            "source": r.source,
            "hero_image_url": r.hero_image_url,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            **({"status": r.status or "published"} if role == "admin" else {}),
        }
        for r in heads
    ]


@router.get("/recipes/{recipe_id}", response_model=RecipeDetailResponse)
def get_recipe(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(get_role)):
    version = current_head_query(db, recipe_id).first()
    # 404 (not 403) for a guest hitting a draft — don't confirm it exists.
    if not version or ((version.status or "published") != "published" and role != "admin"):
        raise HTTPException(404, "Recipe not found")
    if role != "admin":
        # Guest-only, so the admin's own edit/preview traffic doesn't inflate
        # the count shown on the dashboard.
        _increment_analytics(db, recipe_id, "view_count")
    return version.to_dict()


@router.get("/recipes/{recipe_id}/download")
def download_recipe(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(get_role)):
    version = (
        db.query(RecipeVersion)
        .filter(
            RecipeVersion.recipe_id == recipe_id,
            RecipeVersion.is_current_head == True,  # noqa: E712
            RecipeVersion.deleted_at.is_(None),
        )
        .first()
    )
    if not version or ((version.status or "published") != "published" and role != "admin"):
        raise HTTPException(404, "Recipe not found")
    if role != "admin":
        _increment_analytics(db, recipe_id, "download_count")
    text = render_markdown(version.to_dict())
    slug = "".join(c if c.isalnum() or c in " -" else "" for c in version.name).strip().replace(" ", "-").lower()
    return Response(
        content=text,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{slug or "recipe"}.md"'},
    )


@router.get("/recipes/{recipe_id}/history", response_model=list[RecipeDetailResponse])
def get_history(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(require_admin)):
    versions = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.recipe_id == recipe_id)
        .order_by(RecipeVersion.created_at)
        .all()
    )
    return [v.to_dict() for v in versions]


@router.post("/recipes")
def create_recipe(
    req: RecipeUpsertRequest,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Manual creation — admin enters every field directly, no AI involved.
    New recipe_id, own lineage (distinct from 'generated' or 'seed'). Starts
    as a draft — same "everything starts as a draft, publish explicitly when
    ready" rule as fork and research, rather than going instantly live."""
    version = create_manual_recipe(req)
    db.add(version)
    db.commit()
    return version.to_dict()


@router.put("/recipes/{recipe_id}")
def update_recipe(
    recipe_id: str,
    req: RecipeUpsertRequest,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Manual edit has been retired. Use the agentic research workspace for
    recipe changes so there is one editing path and one publish/draft model."""
    current = current_head_query(db, recipe_id).first()
    if not current:
        raise HTTPException(404, "Recipe not found")
    raise HTTPException(410, "Manual recipe edits have been removed. Use the agentic editor.")


@router.delete("/recipes/{recipe_id}")
def delete_recipe(
    recipe_id: str,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Soft-deletes the current-head version: sets deleted_at, hiding it from
    every list (guest and admin) while keeping the row — and full version
    history — intact in the DB. Only allowed while the recipe is a draft; a
    published recipe must be unpublished first. Permanent removal is a
    separate action, POST /api/admin/recipes/{id}/purge, reachable only from
    Trash once this soft-delete has already happened."""
    current = current_head_query(db, recipe_id).first()
    if not current:
        raise HTTPException(404, "Recipe not found")
    if (current.status or "published") != "draft":
        raise HTTPException(400, "Unpublish this recipe before deleting it.")
    current.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"deleted": recipe_id}


@router.post("/recipes/draft")
def draft_recipe(req: DraftRequest, role: str = Depends(require_admin)):
    """
    Conversational, admin-only recipe drafting — the create-time counterpart
    to /recipes/{id}/chat. Paste a natural-language draft, name a dish idea
    (web search fills in technique), or ask to refine the `draft` from a
    prior turn. Never touches the database; once satisfied, the admin saves
    the result with a separate POST /api/recipes call.
    """
    if not is_configured():
        raise HTTPException(400, "ANTHROPIC_API_KEY not set — add it to backend/.env")

    try:
        result = draft_recipe_from_conversation(
            req.message,
            history=[h.model_dump() for h in req.history],
            current_draft=req.draft,
        )
    except Exception as e:
        raise HTTPException(500, f"Recipe drafting failed: {e}")
    return result


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
    current = current_head_query(db, recipe_id).first()
    if not current or ((current.status or "published") != "published" and role != "admin"):
        raise HTTPException(404, "Recipe not found")
    if not is_configured():
        raise HTTPException(400, "ANTHROPIC_API_KEY not set — add it to backend/.env")

    try:
        result = customize_recipe(
            current.to_dict(), req.message, history=[h.model_dump() for h in req.history]
        )
    except LLMInvalidResponseError as e:
        raise HTTPException(502, str(e))
    except Exception:
        logger.exception("Unexpected recipe customization failure")
        raise HTTPException(
            500,
            "The assistant could not apply that recipe edit. Try again or ask for a smaller change.",
        )

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
        }

    new_version = create_chat_edit_version(current, result)
    db.add(new_version)
    db.commit()
    return {"change_summary": result.get("change_summary", ""), "new_version": new_version.to_dict(), "persisted": True}


@router.post("/recipes/{recipe_id}/fork")
def fork_recipe(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(require_admin)):
    """
    Fork: NEW recipe_id, independent history, parent_version_id points back
    to the version it was forked from. Does not affect the original's
    history. Starts as a draft — "copy a recipe to start a new draft" —
    rather than instantly publishing a duplicate.
    """
    current = current_head_query(db, recipe_id).first()
    if not current:
        raise HTTPException(404, "Recipe not found")

    forked = fork_recipe_version(current)
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
            "serving_size": result.get("serving_size") or {"amount": None, "unit": None},
            "components": result["components"],
            "steps": result["steps"],
            "nutrition": nutrition,
            "lineage": "session_preview",
            "source": "guest_session_only",
            "persisted": False,
            "note": "This generated recipe isn't saved and can't be forked.",
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
        serving_size_amount=(result.get("serving_size") or {}).get("amount"),
        serving_size_unit=(result.get("serving_size") or {}).get("unit"),
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
def get_review_queue(db: Session = Depends(get_db), role: str = Depends(require_admin)):
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
