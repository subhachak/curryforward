from __future__ import annotations

import json
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
from ..llm_client import is_litellm_configured, is_model_available, litellm_completion
from ..models import RecipeAnalytics, RecipeFeedback, RecipeVersion
from ..nutrition import compute_nutrition
from ..recipe_export import render_markdown
from ..schemas import (
    RecipeDetailResponse,
    RecipeFeedbackCreateRequest,
    RecipeFeedbackListResponse,
    RecipeFeedbackResponse,
    RecipeSummaryResponse,
    RecipeUpsertRequest,
)
from ..services.llm_settings import anthropic_model_name, resolve_task_model
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


def _recipe_metadata(db: Session, recipe_id: str, current: RecipeVersion) -> dict:
    versions = db.query(RecipeVersion).filter(RecipeVersion.recipe_id == recipe_id).all()
    published_versions = [v for v in versions if (v.status or "published") == "published"]
    first_published = min((v.created_at for v in published_versions if v.created_at), default=None)
    last_published = max((v.created_at for v in published_versions if v.created_at), default=None)
    last_updated = max((v.updated_at for v in versions if v.updated_at), default=current.updated_at)
    return {
        "first_published_at": first_published.isoformat() if first_published else None,
        "last_published_at": last_published.isoformat() if last_published else None,
        "current_version_published_at": current.created_at.isoformat()
        if (current.status or "published") == "published" and current.created_at
        else None,
        "last_updated_at": last_updated.isoformat() if last_updated else None,
        "version_count": len(versions),
        "current_version_id": current.version_id,
    }


def _feedback_summary(db: Session, recipe_id: str) -> dict:
    rows = (
        db.query(RecipeFeedback)
        .filter(RecipeFeedback.recipe_id == recipe_id, RecipeFeedback.status == "approved")
        .order_by(RecipeFeedback.created_at.desc())
        .all()
    )
    ratings = [r.rating for r in rows if r.rating is not None]
    return {
        "average_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
        "rating_count": len(ratings),
        "review_count": len([r for r in rows if r.rating is not None]),
        "comment_count": len(rows),
    }


def _visible_recipe_or_404(recipe_id: str, db: Session, role: str) -> RecipeVersion:
    version = current_head_query(db, recipe_id).first()
    if not version or ((version.status or "published") != "published" and role != "admin"):
        raise HTTPException(404, "Recipe not found")
    return version


def _scan_feedback_with_ai(
    recipe: RecipeVersion,
    author_name: str | None,
    rating: int | None,
    comment: str,
    db: Session | None = None,
) -> dict:
    """Return {"approved": bool, "reason": str}. Fail closed: if scanner
    config/provider/parsing is unavailable, keep the item hidden for admin
    review instead of publishing unscanned public content."""
    model = resolve_task_model("feedback_moderation", db)
    if not is_litellm_configured():
        return {"approved": False, "reason": "AI scanner unavailable: LiteLLM is not installed."}
    if not is_model_available(model):
        return {"approved": False, "reason": f"AI scanner unavailable: no API key configured for {model}."}

    prompt = (
        "You moderate public recipe comments. Return only JSON with keys "
        "`approved` (boolean) and `reason` (short string). Approve normal "
        "recipe feedback, disagreement, and mild criticism. Flag harassment, "
        "hate, sexual content, threats, spam, private data, malware links, or "
        "content unrelated to the recipe.\n\n"
        f"Recipe: {recipe.name}\n"
        f"Author: {author_name or 'Anonymous'}\n"
        f"Rating: {rating if rating is not None else 'none'}\n"
        f"Comment: {comment}"
    )
    try:
        response = litellm_completion(
            model=model,
            messages=[
                {"role": "system", "content": "You are a precise content moderation classifier."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=160,
        )
        content = response.choices[0].message.content
        parsed = json.loads(content)
        approved = bool(parsed.get("approved"))
        reason = str(parsed.get("reason") or ("Approved by AI scan" if approved else "Flagged by AI scan"))
        return {"approved": approved, "reason": reason[:500]}
    except Exception:
        logger.exception("Feedback moderation scan failed")
        return {"approved": False, "reason": "AI scanner failed; queued for admin review."}


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
    version = _visible_recipe_or_404(recipe_id, db, role)
    if role != "admin":
        # Guest-only, so the admin's own edit/preview traffic doesn't inflate
        # the count shown on the dashboard.
        _increment_analytics(db, recipe_id, "view_count")
    return {
        **version.to_dict(),
        "metadata": _recipe_metadata(db, recipe_id, version),
        "feedback_summary": _feedback_summary(db, recipe_id),
    }


@router.get("/recipes/{recipe_id}/feedback", response_model=RecipeFeedbackListResponse)
def list_recipe_feedback(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(get_role)):
    _visible_recipe_or_404(recipe_id, db, role)
    rows = (
        db.query(RecipeFeedback)
        .filter(RecipeFeedback.recipe_id == recipe_id, RecipeFeedback.status == "approved")
        .order_by(RecipeFeedback.created_at.desc())
        .all()
    )
    ratings = [r.rating for r in rows if r.rating is not None]
    return {
        "average_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
        "rating_count": len(ratings),
        "review_count": len([r for r in rows if r.rating is not None]),
        "comment_count": len(rows),
        "items": [r.to_dict() for r in rows],
    }


@router.post("/recipes/{recipe_id}/feedback", response_model=RecipeFeedbackResponse)
def create_recipe_feedback(
    recipe_id: str,
    req: RecipeFeedbackCreateRequest,
    db: Session = Depends(get_db),
    role: str = Depends(get_role),
):
    version = _visible_recipe_or_404(recipe_id, db, role)
    if (version.status or "published") != "published":
        raise HTTPException(400, "Feedback can only be added to published recipes")
    comment = req.comment.strip()
    if not comment:
        raise HTTPException(400, "Comment is required")
    row = RecipeFeedback(
        recipe_id=recipe_id,
        author_name=(req.author_name or "").strip()[:80] or None,
        rating=req.rating,
        comment=comment,
    )
    scan = _scan_feedback_with_ai(version, row.author_name, row.rating, row.comment, db)
    row.status = "approved" if scan["approved"] else "pending_review"
    row.moderation_reason = scan["reason"]
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_dict()


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
def draft_recipe(
    req: DraftRequest,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
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
            model=anthropic_model_name(resolve_task_model("recipe_draft", db)),
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
            current.to_dict(),
            req.message,
            history=[h.model_dump() for h in req.history],
            model=anthropic_model_name(resolve_task_model("recipe_customize", db)),
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
        result = generate_recipe_for_gap(
            req.dish_name,
            preferences,
            model=anthropic_model_name(resolve_task_model("gap_generation", db)),
        )
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
