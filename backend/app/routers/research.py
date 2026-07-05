"""
The agentic recipe research workflow — a step-by-step recipe editing and
development workspace. Every endpoint here is
admin-only.

A research session is a recipe_id whose current-head version has
status="draft" — mutated in place turn by turn (chat replies, direct field
patches) rather than creating a new immutable version each time, so autosave
doesn't explode the version history. Brand-new drafts publish in place.
Dashboard edits of published recipes create linked draft copies; publishing
those copies can either replace the original recipe or keep both.
"""
from __future__ import annotations

import threading
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..crew_research import extract_dish_name, propose_search_batch, refine_section, run_auto_research_crew
from ..db import SessionLocal, get_db
from ..llm_agent import (
    continue_research_turn,
    is_tavily_configured,
    run_tavily_search,
    start_research_turn,
)
from ..llm_client import is_litellm_configured, is_model_available
from ..models import RecipeVersion, ResearchJob
from ..services.llm_settings import resolve_task_model
from ..services.audit import audit_admin_action
from ..services.llm_usage import record_llm_usage
from ..nutrition import compute_nutrition

router = APIRouter(prefix="/api/recipes/research")
logger = logging.getLogger(__name__)

PATCHABLE_FIELDS = [
    "name", "category", "cuisine_tags", "base_servings_amount", "base_servings_unit",
    "serving_size_amount", "serving_size_unit",
    "components", "steps", "intro", "history", "prep_time_minutes",
    "cook_time_minutes", "tips", "watch_outs", "notes", "starting_prompt",
    "hero_image_url",
]


class StartResearchRequest(BaseModel):
    prompt: str
    model: str | None = None


class ResearchChatRequest(BaseModel):
    message: str | None = None
    tool_use_id: str | None = None
    query: str | None = None
    approved: bool | None = None


class ResearchPatchRequest(BaseModel):
    name: str | None = None
    category: str | None = None
    cuisine_tags: list[str] | None = None
    base_servings_amount: float | None = None
    base_servings_unit: str | None = None
    serving_size_amount: float | None = None
    serving_size_unit: str | None = None
    components: list[dict] | None = None
    steps: list[dict] | None = None
    intro: str | None = None
    history: str | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    tips: list[str] | None = None
    watch_outs: list[str] | None = None
    notes: str | None = None
    starting_prompt: str | None = None
    hero_image_url: str | None = None
    model: str | None = None  # session's chosen LiteLLM model string — session
    # metadata, not recipe content, so it's handled separately from
    # PATCHABLE_FIELDS/_apply_patch below.


class AutoResearchRunRequest(BaseModel):
    approved_queries: list[str]


class PublishResearchRequest(BaseModel):
    mode: str = "keep_both"  # keep_both | replace_original


class RefineSectionRequest(BaseModel):
    section: str
    instruction: str


def _get_draft(db: Session, recipe_id: str) -> RecipeVersion:
    row = (
        db.query(RecipeVersion)
        .filter(
            RecipeVersion.recipe_id == recipe_id,
            RecipeVersion.is_current_head == True,  # noqa: E712
            RecipeVersion.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(404, "Recipe not found")
    if row.status != "draft":
        raise HTTPException(400, "This recipe is no longer a draft")
    return row


def _apply_patch(row: RecipeVersion, patch: dict, allow_null: bool = False) -> None:
    """Shallow-merges `patch` onto `row`. `allow_null=True` (direct admin
    edits) treats an explicit null as "clear this field". `allow_null=False`
    (LLM-sourced recipe_patch) skips nulls instead, since a model asked to
    return "only what changed" may still emit untouched keys as null — we
    don't want that to silently wipe existing content."""
    for key, value in patch.items():
        if key not in PATCHABLE_FIELDS:
            continue
        if value is None and not allow_null:
            continue
        setattr(row, key, value)
    if "components" in patch and (patch["components"] is not None or allow_null):
        row.nutrition = compute_nutrition(row.components or [])


@router.post("")
def start_research(
    req: StartResearchRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Starts a new research session: an empty, draft-status recipe the
    admin builds up conversationally (and/or by direct edit) before
    publishing. `req.prompt` is freeform — a dish name, a longer description,
    or a full pasted draft recipe — stored verbatim as `starting_prompt` and
    also used to derive the short `name` needed for the DB row and page
    headers. Deriving a good name needs a working model, so this gates on
    is_model_available() the same way /chat and /auto do (unlike before,
    when creating a draft had no AI dependency at all)."""
    model = req.model or resolve_task_model("dish_name_extraction", db)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")

    try:
        name = extract_dish_name(req.prompt, model)
    except Exception as e:
        record_llm_usage(task="dish_name_extraction", model=model, role=role, status="error", error=str(e))
        raise
    record_llm_usage(task="dish_name_extraction", model=model, role=role)
    recipe_id = f"research-{uuid.uuid4().hex[:8]}"
    version = RecipeVersion(
        recipe_id=recipe_id,
        parent_version_id=None,
        lineage="researched",
        name=name,
        components=[],
        steps=[],
        tips=[],
        watch_outs=[],
        nutrition={},
        status="draft",
        source="researched",
        is_current_head=True,
        research_conversation={"messages": [], "pending_tool_use": None},
        research_model=req.model,
        starting_prompt=req.prompt,
    )
    db.add(version)
    audit_admin_action(
        db,
        action="research_draft_created",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"model": req.model, "name": name},
    )
    db.commit()
    return version.to_research_dict()


@router.get("/drafts")
def list_drafts(db: Session = Depends(get_db), role: str = Depends(require_admin)):
    """Draft-status recipes in progress, most recently touched first."""
    rows = (
        db.query(RecipeVersion)
        .filter(
            RecipeVersion.status == "draft",
            RecipeVersion.is_current_head == True,  # noqa: E712
            RecipeVersion.deleted_at.is_(None),
        )
        .order_by(RecipeVersion.updated_at.desc())
        .all()
    )
    return [
        {
            "recipe_id": r.recipe_id,
            "version_id": r.version_id,
            "name": r.name,
            "category": r.category,
            "status": r.status,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


@router.get("/{recipe_id}/jobs")
def list_research_jobs(
    recipe_id: str,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    rows = (
        db.query(ResearchJob)
        .filter(ResearchJob.recipe_id == recipe_id)
        .order_by(ResearchJob.started_at.desc())
        .all()
    )
    return [job.to_dict() for job in rows]


@router.get("/{recipe_id}")
def get_research_recipe(
    recipe_id: str,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    row = (
        db.query(RecipeVersion)
        .filter(
            RecipeVersion.recipe_id == recipe_id,
            RecipeVersion.is_current_head == True,  # noqa: E712
            RecipeVersion.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(404, "Recipe not found")
    return row.to_research_dict()


@router.patch("/{recipe_id}")
def patch_research_recipe(
    recipe_id: str,
    req: ResearchPatchRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Direct field edits (notes textarea, manual ingredient/step tweaks) —
    mutates the draft row in place. Not available once published."""
    row = _get_draft(db, recipe_id)
    patch = req.model_dump(exclude_unset=True)
    if "model" in patch:
        row.research_model = patch.pop("model")
    _apply_patch(row, patch, allow_null=True)
    audit_admin_action(
        db,
        action="research_draft_updated",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"fields": sorted(patch.keys())},
    )
    db.commit()
    return row.to_research_dict()


@router.post("/{recipe_id}/chat")
def research_chat(
    recipe_id: str,
    req: ResearchChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """
    One turn of the research conversation. Two shapes of request:
    - A fresh message: {"message": "..."}.
    - A decision on a previously proposed search: {"tool_use_id", "query",
      "approved"}. On approval, actually calls Tavily; on decline, tells the
      model so without running a search.
    Either way, the conversation and any recipe content produced are
    persisted immediately (autosave) before responding.
    """
    row = _get_draft(db, recipe_id)
    model = resolve_task_model("research_chat", db, row.research_model)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")

    conversation = row.research_conversation or {"messages": [], "pending_tool_use": None}
    messages = list(conversation.get("messages") or [])

    try:
        if req.tool_use_id is not None:
            if req.approved:
                if not is_tavily_configured():
                    raise HTTPException(400, "TAVILY_API_KEY not set — add it to backend/.env")
                result_text = run_tavily_search(req.query or "")
                envelope = continue_research_turn(messages, req.tool_use_id, result_text, model)
            else:
                decline_text = (
                    "The user declined this search. Do not repeat the same or a "
                    "very similar query — proceed with what you already know, or "
                    "ask a clarifying question instead."
                )
                envelope = continue_research_turn(messages, req.tool_use_id, decline_text, model)
            # continue_research_turn() injects a tool result message that must
            # be persisted — otherwise the next turn replays a tool call with
            # no matching result and the provider rejects the request.
            messages = envelope["messages"]
        else:
            if not req.message:
                raise HTTPException(400, "message is required")
            messages = messages + [{"role": "user", "content": req.message}]
            envelope = start_research_turn(messages, model)
    except HTTPException:
        raise
    except Exception as e:
        record_llm_usage(task="research_chat", model=model, role=role, status="error", error=str(e))
        raise HTTPException(500, f"Research chat failed: {e}")
    record_llm_usage(task="research_chat", model=model, role=role)

    messages = messages + [envelope["assistant_message"]]

    if envelope["tool_use"]:
        row.research_conversation = {"messages": messages, "pending_tool_use": envelope["tool_use"]}
        db.commit()
        return {
            "type": "search_proposal",
            "query": envelope["tool_use"]["query"],
            "tool_use_id": envelope["tool_use"]["id"],
        }

    row.research_conversation = {"messages": messages, "pending_tool_use": None}
    patch = envelope.get("recipe_patch")
    if patch:
        _apply_patch(row, patch)
    audit_admin_action(
        db,
        action="research_chat_turn",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"had_patch": bool(patch), "tool_use": bool(envelope.get("tool_use"))},
    )
    db.commit()
    return {
        "type": "reply",
        "reply": envelope.get("reply") or "",
        "recipe": row.to_research_dict(),
        "notes_suggestion": envelope.get("notes_suggestion"),
    }


@router.post("/{recipe_id}/auto/plan")
def auto_research_plan(
    recipe_id: str,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Proposes a batch of candidate search queries via one lightweight LLM
    call — no side effects, no crew execution, nothing persisted. The admin
    reviews/edits/unchecks the batch client-side before calling /auto/run."""
    row = _get_draft(db, recipe_id)
    if not is_litellm_configured():
        raise HTTPException(400, "litellm is not installed — check backend/requirements.txt")
    model = resolve_task_model("research_plan", db, row.research_model)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")
    try:
        plan = propose_search_batch(row.name, row.starting_prompt, model)
    except Exception as e:
        record_llm_usage(task="research_plan", model=model, role=role, status="error", error=str(e))
        raise HTTPException(500, f"Planning failed: {e}")
    record_llm_usage(task="research_plan", model=model, role=role)
    return plan


@router.post("/{recipe_id}/auto/run")
def auto_research_run(
    recipe_id: str,
    req: AutoResearchRunRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Kicks off the auto-research crew on a background thread and returns
    immediately with auto_research_status="running" — the crew (four
    concurrent specialist LLM calls plus an orchestrator merge) can take a
    minute or more, longer than typical dev-proxy/gateway timeouts hold a
    single HTTP request open for. The frontend polls the existing
    GET /{recipe_id} endpoint and watches auto_research_status flip away
    from "running" instead of awaiting one long response."""
    row = _get_draft(db, recipe_id)
    if row.auto_research_status == "running":
        raise HTTPException(409, "Auto-research is already running for this recipe")
    if not is_tavily_configured():
        raise HTTPException(400, "TAVILY_API_KEY not set — add it to backend/.env")
    model = resolve_task_model("auto_research_crew", db, row.research_model)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")

    job_id = uuid.uuid4().hex
    job = ResearchJob(
        job_id=job_id,
        recipe_id=recipe_id,
        model=model,
        approved_queries=list(req.approved_queries),
        status="running",
        progress=[],
    )
    db.add(job)
    row.auto_research_status = "running"
    row.auto_research_error = None
    row.auto_research_progress = []
    row.auto_research_job_id = job_id
    audit_admin_action(
        db,
        action="auto_research_started",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"job_id": job_id, "model": model, "query_count": len(req.approved_queries)},
    )
    db.commit()
    logger.info("auto_research_started", extra={"recipe_id": recipe_id, "job_id": job_id, "model": model})

    thread = threading.Thread(
        target=_run_auto_research_job,
        args=(recipe_id, list(req.approved_queries), model, row.starting_prompt, job_id),
        daemon=True,
    )
    thread.start()

    return row.to_research_dict()


def _mark_task_done(recipe_id: str, job_id: str, section: str) -> None:
    """task_callback for the crew — invoked once per completed task, and for
    the four concurrent specialists, from up to four different threads at
    once (see crew_research.py's module docstring). Opens its own short-lived
    session per call rather than sharing the job's session across threads."""
    db = SessionLocal()
    try:
        row = (
            db.query(RecipeVersion)
            .filter(RecipeVersion.recipe_id == recipe_id, RecipeVersion.is_current_head == True)  # noqa: E712
            .first()
        )
        if not row or row.auto_research_job_id != job_id:
            return  # cancelled/superseded — don't resurrect progress for a dead job
        progress = list(row.auto_research_progress or [])
        if section not in progress:
            progress.append(section)
        row.auto_research_progress = progress
        job = db.query(ResearchJob).filter(ResearchJob.job_id == job_id).first()
        if job:
            job.progress = progress
        db.commit()
    finally:
        db.close()


def _run_auto_research_job(
    recipe_id: str, approved_queries: list[str], model: str, starting_prompt: str | None, job_id: str
) -> None:
    """Runs on a background thread with its own DB session — SQLAlchemy
    sessions aren't safe to share across threads/requests, so this can't
    reuse the request-scoped session from Depends(get_db)."""
    db = SessionLocal()
    try:
        row = (
            db.query(RecipeVersion)
            .filter(
                RecipeVersion.recipe_id == recipe_id,
                RecipeVersion.is_current_head == True,  # noqa: E712
                RecipeVersion.deleted_at.is_(None),
            )
            .first()
        )
        if not row:
            return
        try:
            search_results = []
            for q in approved_queries:
                result_text = run_tavily_search(q)
                search_results.append({"query": q, "result": result_text})
            job = db.query(ResearchJob).filter(ResearchJob.job_id == job_id).first()
            if job:
                job.search_results = search_results
                db.commit()
            patch = run_auto_research_crew(
                dish_name=row.name,
                current_document=row.to_research_dict(),
                search_results=search_results,
                starting_prompt=starting_prompt,
                model=model,
                on_task_done=lambda section: _mark_task_done(recipe_id, job_id, section),
            )
            # Re-fetch — a lot of wall-clock time (the crew's real work) has
            # passed since `row` was loaded above. db.refresh() re-syncs this
            # row's attributes by primary key — it does NOT re-apply the
            # original query filter, so a soft-delete that happened mid-job
            # must be checked explicitly here, not just via the job_id fence.
            db.refresh(row)
            if row.auto_research_job_id != job_id or row.deleted_at is not None:
                job = db.query(ResearchJob).filter(ResearchJob.job_id == job_id).first()
                if job:
                    job.status = "superseded"
                    job.finished_at = datetime.now(timezone.utc)
                    db.commit()
                return
            _apply_patch(row, patch)
            row.auto_research_status = None
            row.auto_research_error = None
            row.auto_research_job_id = None
            job = db.query(ResearchJob).filter(ResearchJob.job_id == job_id).first()
            if job:
                job.status = "completed"
                job.finished_at = datetime.now(timezone.utc)
                job.progress = row.auto_research_progress or []
            logger.info("auto_research_completed", extra={"recipe_id": recipe_id, "job_id": job_id})
            record_llm_usage(task="auto_research_crew", model=model, role="admin")
        except Exception as e:
            logger.exception("auto_research_failed", extra={"recipe_id": recipe_id, "job_id": job_id})
            record_llm_usage(task="auto_research_crew", model=model, role="admin", status="error", error=str(e))
            db.rollback()
            db.refresh(row)
            if row.auto_research_job_id != job_id or row.deleted_at is not None:
                return
            row.auto_research_status = "error"
            row.auto_research_error = str(e)
            row.auto_research_job_id = None
            job = db.query(ResearchJob).filter(ResearchJob.job_id == job_id).first()
            if job:
                job.status = "error"
                job.error = str(e)
                job.finished_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


@router.post("/{recipe_id}/auto/cancel")
def auto_research_cancel(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Soft-cancel: unblocks the UI immediately by clearing status and the
    fencing job id. There's no way to interrupt an in-flight crew.kickoff()
    call (CrewAI has no cooperative cancellation), so the abandoned
    background thread keeps running — but once it finishes, its job id won't
    match the row's (now-cleared) job id, so _run_auto_research_job discards
    its result instead of applying it."""
    row = _get_draft(db, recipe_id)
    row.auto_research_status = None
    row.auto_research_error = None
    row.auto_research_progress = None
    job_id = row.auto_research_job_id
    row.auto_research_job_id = None
    if job_id:
        job = db.query(ResearchJob).filter(ResearchJob.job_id == job_id).first()
        if job:
            job.status = "cancelled"
            job.finished_at = datetime.now(timezone.utc)
    audit_admin_action(
        db,
        action="auto_research_cancelled",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"job_id": job_id},
    )
    db.commit()
    logger.info("auto_research_cancelled", extra={"recipe_id": recipe_id, "job_id": job_id})
    return row.to_research_dict()


@router.post("/{recipe_id}/refine")
def refine_recipe_section(
    recipe_id: str,
    req: RefineSectionRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """One-shot AI refinement of a single section (history/ingredients/steps/
    tips) — a single LLM call, not a crew, so this stays synchronous like
    /chat."""
    row = _get_draft(db, recipe_id)
    model = resolve_task_model("section_refine", db, row.research_model)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")
    try:
        patch = refine_section(req.section, row.to_research_dict(), req.instruction, model)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        record_llm_usage(task="section_refine", model=model, role=role, status="error", error=str(e))
        raise HTTPException(500, f"Refinement failed: {e}")
    record_llm_usage(task="section_refine", model=model, role=role)
    _apply_patch(row, patch)
    audit_admin_action(
        db,
        action="research_section_refined",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"section": req.section},
    )
    db.commit()
    return row.to_research_dict()


@router.post("/{recipe_id}/publish")
def publish_research_recipe(
    recipe_id: str,
    request: Request,
    req: PublishResearchRequest | None = None,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    row = _get_draft(db, recipe_id)
    if row.auto_research_status == "running":
        raise HTTPException(409, "Wait for auto-research to finish or stop it before publishing.")
    if not row.name or not row.components or not row.steps:
        raise HTTPException(
            400, "Add a name, at least one ingredient, and at least one step before publishing."
        )
    mode = (req.mode if req else "keep_both")
    if mode not in {"keep_both", "replace_original"}:
        raise HTTPException(400, "Publish mode must be keep_both or replace_original.")
    if mode == "replace_original":
        if not row.parent_version_id:
            raise HTTPException(400, "This draft is not linked to an original recipe.")
        original = db.query(RecipeVersion).filter(RecipeVersion.version_id == row.parent_version_id).first()
        if not original:
            raise HTTPException(404, "Original recipe not found")
        current_original = (
            db.query(RecipeVersion)
            .filter(
                RecipeVersion.recipe_id == original.recipe_id,
                RecipeVersion.is_current_head == True,  # noqa: E712
                RecipeVersion.deleted_at.is_(None),
            )
            .first()
        )
        if not current_original or (current_original.status or "published") != "published":
            raise HTTPException(400, "Original recipe is not currently published.")

        replacement = RecipeVersion(
            recipe_id=original.recipe_id,
            parent_version_id=current_original.version_id,
            lineage="edit",
            name=row.name.replace(" (draft edit)", ""),
            category=row.category,
            cuisine_tags=row.cuisine_tags,
            base_servings_amount=row.base_servings_amount,
            base_servings_unit=row.base_servings_unit,
            serving_size_amount=row.serving_size_amount,
            serving_size_unit=row.serving_size_unit,
            components=row.components,
            steps=row.steps,
            nutrition=row.nutrition or compute_nutrition(row.components or []),
            hero_image_url=row.hero_image_url,
            intro=row.intro,
            history=row.history,
            prep_time_minutes=row.prep_time_minutes,
            cook_time_minutes=row.cook_time_minutes,
            tips=row.tips,
            watch_outs=row.watch_outs,
            status="published",
            source=row.source if row.source != "revision_draft" else current_original.source,
            is_current_head=True,
        )
        current_original.is_current_head = False
        row.is_current_head = False
        row.deleted_at = datetime.now(timezone.utc)
        db.add(replacement)
        audit_admin_action(
            db,
            action="recipe_published_replace_original",
            target_type="recipe",
            target_id=original.recipe_id,
            request=request,
            details={"draft_recipe_id": recipe_id, "replacement_version_id": replacement.version_id},
        )
        db.commit()
        return replacement.to_dict()

    row.status = "published"
    audit_admin_action(
        db,
        action="recipe_published_keep_both",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
    )
    db.commit()
    return row.to_dict()


@router.post("/{recipe_id}/unpublish")
def unpublish_research_recipe(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    row = (
        db.query(RecipeVersion)
        .filter(
            RecipeVersion.recipe_id == recipe_id,
            RecipeVersion.is_current_head == True,  # noqa: E712
            RecipeVersion.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(404, "Recipe not found")
    if row.status != "published":
        raise HTTPException(400, "This recipe is not published")
    row.status = "draft"
    audit_admin_action(db, action="recipe_unpublished", target_type="recipe", target_id=recipe_id, request=request)
    db.commit()
    return row.to_research_dict()
