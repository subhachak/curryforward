"""
Admin dashboard surface — the unified published+draft recipe list (with
analytics), Trash (soft-deleted recipes), restore, and permanent purge.

Distinct from routers/recipes.py (guest-facing CRUD/chat) and
routers/research.py (the research workflow specifically): this router is
purely about managing recipes that already exist, regardless of how they
were created (manual, research, or fork).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..db import get_db
from ..models import RecipeAnalytics, RecipeVersion
from ..services.recipe_versions import fork_recipe_version

router = APIRouter(prefix="/api/admin")


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
    return [
        {
            "recipe_id": r.recipe_id,
            "version_id": r.version_id,
            "name": r.name,
            "category": r.category,
            "status": r.status or "published",
            "lineage": r.lineage,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "view_count": analytics[r.recipe_id].view_count if r.recipe_id in analytics else 0,
            "download_count": analytics[r.recipe_id].download_count if r.recipe_id in analytics else 0,
        }
        for r in rows
    ]


@router.post("/recipes/{recipe_id}/edit-draft")
def create_edit_draft(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(require_admin)):
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
        return {
            "draft": existing.to_research_dict(),
            "created": False,
            "note": "Opened an existing draft copy of the published recipe.",
        }

    draft = fork_recipe_version(current)
    draft.name = f"{current.name} (draft edit)"
    draft.source = "revision_draft"
    db.add(draft)
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


@router.post("/recipes/{recipe_id}/restore")
def restore_recipe(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(require_admin)):
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
    db.commit()
    return row.to_dict()


@router.delete("/recipes/{recipe_id}/purge")
def purge_recipe(recipe_id: str, db: Session = Depends(get_db), role: str = Depends(require_admin)):
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
    db.commit()
    return {"purged": recipe_id}
