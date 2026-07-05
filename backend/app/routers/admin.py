"""
Admin dashboard surface — the unified published+draft recipe list (with
analytics), Trash (soft-deleted recipes), restore, and permanent purge.

Distinct from routers/recipes.py (guest-facing CRUD/chat) and
routers/research.py (the research workflow specifically): this router is
purely about managing recipes that already exist, regardless of how they
were created (manual, research, or fork).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..db import get_db
from ..llm_client import is_litellm_configured, is_model_available, litellm_completion
from ..models import AdminAuditLog, LLMUsageLog, RecipeAnalytics, RecipeFeedback, RecipeVersion
from ..services.audit import audit_admin_action
from ..services.llm_settings import available_models, get_llm_settings, resolve_task_model, set_llm_setting
from ..services.llm_usage import record_llm_usage
from ..services.recipe_versions import fork_recipe_version

router = APIRouter(prefix="/api/admin")


class FeedbackDecision(BaseModel):
    approved: bool


class LLMSettingUpdate(BaseModel):
    model: str


class CopyRewriteRequest(BaseModel):
    field_label: str
    text: str
    instruction: str | None = None
    recipe_context: str | None = None


class CopyRewriteResponse(BaseModel):
    text: str


def _rewrite_copy_text(req: CopyRewriteRequest, model: str) -> tuple[str, object]:
    field_label = req.field_label.strip()[:120] or "field"
    source_text = req.text.strip()
    instruction = (req.instruction or "").strip() or "Rewrite this into polished, user-friendly copy."
    context = (req.recipe_context or "").strip()[:600]
    context_line = f"Nearby context: {context}\n" if context else ""
    if not source_text:
        raise HTTPException(400, "Text is required")
    response = litellm_completion(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a precise recipe copy editor inside Curryforward. Rewrite only "
                    "the requested field into clear, warm, publishable recipe copy. Keep the "
                    "same factual meaning. Do not invent facts, ingredients, timings, dietary "
                    "claims, history, or provenance. Return only the rewritten field text, no "
                    "quotes, markdown, labels, or explanation. Preserve list-like formatting "
                    "when the input is a newline-separated list."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Field: {field_label}\n"
                    f"Admin direction: {instruction}\n"
                    f"{context_line}"
                    f"Current text:\n{source_text}"
                ),
            },
        ],
        temperature=0.4,
    )
    return (response.choices[0].message.content or "").strip(), response


@router.get("/recipes")
def list_all_recipes(db: Session = Depends(get_db), role: str = Depends(require_admin)):
    """Unified dashboard list: every non-deleted recipe (published + draft),
    with status and analytics attached."""
    rows = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.is_current_head == True, RecipeVersion.deleted_at.is_(None))  # noqa: E712
        .order_by(RecipeVersion.updated_at.desc())
        .all()
    )
    recipe_ids = [r.recipe_id for r in rows]
    analytics = {
        a.recipe_id: a
        for a in db.query(RecipeAnalytics).filter(RecipeAnalytics.recipe_id.in_(recipe_ids)).all()
    }
    result = []
    for r in rows:
        first_published_at = (
            db.query(func.min(RecipeVersion.created_at))
            .filter(RecipeVersion.recipe_id == r.recipe_id, RecipeVersion.status == "published")
            .scalar()
        )
        result.append({
            "recipe_id": r.recipe_id,
            "version_id": r.version_id,
            "name": r.name,
            "category": r.category,
            "status": r.status or "published",
            "lineage": r.lineage,
            "first_published_at": first_published_at.isoformat() if first_published_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "view_count": analytics[r.recipe_id].view_count if r.recipe_id in analytics else 0,
            "download_count": analytics[r.recipe_id].download_count if r.recipe_id in analytics else 0,
        })
    return result


@router.get("/llm-settings")
def list_llm_settings(db: Session = Depends(get_db), role: str = Depends(require_admin)):
    return {
        "settings": get_llm_settings(db),
        "models": available_models(),
    }


@router.put("/llm-settings/{key}")
def update_llm_setting(
    key: str,
    req: LLMSettingUpdate,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    try:
        result = set_llm_setting(db, key, req.model)
        audit_admin_action(
            db,
            action="llm_setting_updated",
            target_type="llm_setting",
            target_id=key,
            request=request,
            details={"model": req.model},
        )
        db.commit()
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/rewrite", response_model=CopyRewriteResponse)
def rewrite_admin_copy(
    req: CopyRewriteRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    if not is_litellm_configured():
        raise HTTPException(400, "litellm is not installed — check backend/requirements.txt")
    model = resolve_task_model("copy_rewrite", db)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")
    try:
        text, response = _rewrite_copy_text(req, model)
    except HTTPException:
        raise
    except Exception as e:
        record_llm_usage(task="copy_rewrite", model=model, role=role, status="error", error=str(e))
        raise HTTPException(500, f"Rewrite failed: {e}")
    record_llm_usage(task="copy_rewrite", model=model, role=role, response=response)
    if not text:
        raise HTTPException(500, "Rewrite returned an empty response")
    audit_admin_action(
        db,
        action="copy_rewrite_generated",
        target_type="admin",
        request=request,
        details={"field": req.field_label.strip()[:120]},
    )
    db.commit()
    return {"text": text}


@router.post("/recipes/{recipe_id}/edit-draft")
def create_edit_draft(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Dashboard-only edit entry point.

    Draft recipes can be edited in place. Published recipes get a linked draft
    working copy; publishing that copy later can either replace the original or
    keep both recipes.
    """
    current = (
        db.query(RecipeVersion)
        .filter(
            RecipeVersion.recipe_id == recipe_id,
            RecipeVersion.is_current_head == True,  # noqa: E712
            RecipeVersion.deleted_at.is_(None),
        )
        .first()
    )
    if not current:
        raise HTTPException(404, "Recipe not found")
    if (current.status or "published") == "draft":
        audit_admin_action(
            db,
            action="draft_opened",
            target_type="recipe",
            target_id=recipe_id,
            request=request,
            details={"created": False},
        )
        db.commit()
        return {
            "draft": current.to_research_dict(),
            "created": False,
            "note": "This draft is editable in place.",
        }

    existing = (
        db.query(RecipeVersion)
        .filter(
            RecipeVersion.parent_version_id == current.version_id,
            RecipeVersion.status == "draft",
            RecipeVersion.is_current_head == True,  # noqa: E712
            RecipeVersion.deleted_at.is_(None),
        )
        .order_by(RecipeVersion.updated_at.desc())
        .first()
    )
    if existing:
        audit_admin_action(
            db,
            action="edit_draft_opened",
            target_type="recipe",
            target_id=recipe_id,
            request=request,
            details={"draft_recipe_id": existing.recipe_id, "created": False},
        )
        db.commit()
        return {
            "draft": existing.to_research_dict(),
            "created": False,
            "note": "Opened an existing draft copy of the published recipe.",
        }

    draft = fork_recipe_version(current)
    draft.name = f"{current.name} (draft edit)"
    draft.source = "revision_draft"
    db.add(draft)
    audit_admin_action(
        db,
        action="edit_draft_created",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"draft_recipe_id": draft.recipe_id},
    )
    db.commit()
    return {
        "draft": draft.to_research_dict(),
        "created": True,
        "note": "Created a draft copy. The published recipe remains live until you choose how to publish this draft.",
    }


@router.get("/recipes/trash")
def list_trash(db: Session = Depends(get_db), role: str = Depends(require_admin)):
    """Soft-deleted recipes, most recently deleted first."""
    rows = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.is_current_head == True, RecipeVersion.deleted_at.isnot(None))  # noqa: E712
        .order_by(RecipeVersion.deleted_at.desc())
        .all()
    )
    return [
        {
            "recipe_id": r.recipe_id,
            "version_id": r.version_id,
            "name": r.name,
            "category": r.category,
            "deleted_at": r.deleted_at.isoformat() if r.deleted_at else None,
        }
        for r in rows
    ]


@router.get("/feedback/pending")
def list_pending_feedback(db: Session = Depends(get_db), role: str = Depends(require_admin)):
    rows = (
        db.query(RecipeFeedback, RecipeVersion.name)
        .join(
            RecipeVersion,
            (RecipeVersion.recipe_id == RecipeFeedback.recipe_id)
            & (RecipeVersion.is_current_head == True),  # noqa: E712
        )
        .filter(RecipeFeedback.status == "pending_review")
        .order_by(RecipeFeedback.created_at.desc())
        .all()
    )
    return [
        {
            **feedback.to_dict(),
            "recipe_name": recipe_name,
        }
        for feedback, recipe_name in rows
    ]


@router.post("/feedback/{feedback_id}/decide")
def decide_feedback(
    feedback_id: str,
    req: FeedbackDecision,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    row = db.query(RecipeFeedback).filter(RecipeFeedback.feedback_id == feedback_id).first()
    if not row:
        raise HTTPException(404, "Feedback not found")
    row.status = "approved" if req.approved else "rejected"
    audit_admin_action(
        db,
        action="feedback_decided",
        target_type="feedback",
        target_id=feedback_id,
        request=request,
        details={"approved": req.approved, "recipe_id": row.recipe_id},
    )
    db.commit()
    db.refresh(row)
    return row.to_dict()


@router.post("/recipes/{recipe_id}/restore")
def restore_recipe(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Un-deletes a trashed recipe — clears deleted_at, no other state
    changes. It comes back as whatever status it had when trashed (always
    "draft", since delete is gated to drafts-only)."""
    row = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.recipe_id == recipe_id, RecipeVersion.is_current_head == True)  # noqa: E712
        .first()
    )
    if not row:
        raise HTTPException(404, "Recipe not found")
    if row.deleted_at is None:
        raise HTTPException(400, "This recipe is not in the trash")
    row.deleted_at = None
    audit_admin_action(db, action="recipe_restored", target_type="recipe", target_id=recipe_id, request=request)
    db.commit()
    return row.to_dict()


@router.delete("/recipes/{recipe_id}/purge")
def purge_recipe(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Permanent hard-delete — removes every version row for this recipe_id,
    plus its analytics row. Only allowed once the current-head row is
    already soft-deleted (in Trash), so this can't be used to bypass the
    publish-then-unpublish-then-delete gate on a live recipe."""
    current = (
        db.query(RecipeVersion)
        .filter(RecipeVersion.recipe_id == recipe_id, RecipeVersion.is_current_head == True)  # noqa: E712
        .first()
    )
    if not current:
        raise HTTPException(404, "Recipe not found")
    if current.deleted_at is None:
        raise HTTPException(400, "Only trashed recipes can be permanently purged.")
    versions = db.query(RecipeVersion).filter(RecipeVersion.recipe_id == recipe_id).all()
    for v in versions:
        db.delete(v)
    db.query(RecipeAnalytics).filter(RecipeAnalytics.recipe_id == recipe_id).delete()
    db.query(RecipeFeedback).filter(RecipeFeedback.recipe_id == recipe_id).delete()
    audit_admin_action(db, action="recipe_purged", target_type="recipe", target_id=recipe_id, request=request)
    db.commit()
    return {"purged": recipe_id}


@router.get("/audit-log")
def list_audit_log(limit: int = 100, db: Session = Depends(get_db), role: str = Depends(require_admin)):
    limit = max(1, min(limit, 500))
    rows = db.query(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(limit).all()
    return [row.to_dict() for row in rows]


@router.get("/llm-usage")
def list_llm_usage(limit: int = 100, db: Session = Depends(get_db), role: str = Depends(require_admin)):
    limit = max(1, min(limit, 500))
    rows = db.query(LLMUsageLog).order_by(LLMUsageLog.created_at.desc()).limit(limit).all()
    totals = (
        db.query(
            LLMUsageLog.task,
            LLMUsageLog.model,
            func.count(LLMUsageLog.usage_id),
            func.sum(LLMUsageLog.total_tokens),
        )
        .group_by(LLMUsageLog.task, LLMUsageLog.model)
        .all()
    )
    return {
        "items": [row.to_dict() for row in rows],
        "summary": [
            {
                "task": task,
                "model": model,
                "call_count": count,
                "total_tokens": int(total_tokens or 0),
            }
            for task, model, count, total_tokens in totals
        ],
    }
