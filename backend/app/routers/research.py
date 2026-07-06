"""
The agentic recipe research workflow — admin-only draft creation, auto-research,
direct field edits, recipe-wide AI edits, review, and publishing.

A research session is a recipe_id whose current-head version has
status="draft" — mutated in place by direct field patches and AI edit actions
rather than creating a new immutable version each time, so autosave doesn't
explode the version history. Brand-new drafts publish in place. Dashboard edits
of published recipes create linked draft copies; publishing those copies can
either replace the original recipe or keep both.
"""
from __future__ import annotations

import json
import re
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
from ..llm_agent import is_web_search_configured, run_web_search
from ..llm_client import is_litellm_configured, is_model_available, litellm_completion
from ..models import Base, IngredientNutritionCache, RecipeVersion, ResearchJob
from ..schemas import ComponentPayload, IngredientPayload, RecipeResearchResponse, StepPayload
from ..services.llm_settings import resolve_task_model
from ..services.audit import audit_admin_action
from ..services.ingredient_canonical import normalize_components_to_grams
from ..services.llm_usage import record_llm_usage
from ..services.recipe_identity import current_head_identity_query, ensure_recipe_identity, generate_admin_ref, unique_public_slug
from ..nutrition import _lookup as lookup_builtin_nutrition
from ..nutrition import _normalize_cache_key, compute_nutrition, estimated_yield_grams

router = APIRouter(prefix="/api/recipes/research")
logger = logging.getLogger(__name__)

PATCHABLE_FIELDS = [
    "name", "category", "cuisine_tags", "base_servings_amount", "base_servings_unit",
    "serving_size_amount", "serving_size_unit",
    "components", "steps", "intro", "history", "prep_time_minutes",
    "cook_time_minutes", "tips", "watch_outs", "suggested_utensils",
    "pan_conversions", "notes", "starting_prompt", "hero_image_url",
]


class StartResearchRequest(BaseModel):
    prompt: str
    model: str | None = None


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
    suggested_utensils: list[str] | None = None
    pan_conversions: list[dict] | None = None
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


class CopyRewriteRequest(BaseModel):
    field_label: str
    text: str
    instruction: str | None = None
    recipe_context: str | None = None


class CopyRewriteResponse(BaseModel):
    text: str


class RecipeWideEditRequest(BaseModel):
    instruction: str


class RecipeWideEditResponse(BaseModel):
    recipe: dict
    changed_fields: list[str]
    review_notes: str | None = None


class AdminAssistantRequest(BaseModel):
    question: str
    history: list[dict] | None = None


class AdminAssistantResponse(BaseModel):
    reply: str


def _get_draft(db: Session, recipe_id: str) -> RecipeVersion:
    row = (
        current_head_identity_query(db, recipe_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "Recipe not found")
    if row.status != "draft":
        raise HTTPException(400, "This recipe is no longer a draft")
    ensure_recipe_identity(row, db)
    return row


def _apply_patch(row: RecipeVersion, patch: dict, db: Session | None = None, allow_null: bool = False) -> None:
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
        if key == "components" and value is not None:
            value = normalize_components_to_grams(value)
        if key in {"base_servings_unit", "serving_size_unit"}:
            value = "g"
        setattr(row, key, value)
    if "components" in patch and (patch["components"] is not None or allow_null):
        row.nutrition = compute_nutrition(row.components or [], db)
        row.base_servings_amount = estimated_yield_grams(row.components or [])
        row.base_servings_unit = "g"
        row.serving_size_unit = "g"


def _extract_json_object(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _schema_context() -> dict:
    """Read-only internal shape context for the admin assistant."""
    return {
        "pydantic": {
            "ingredient": IngredientPayload.model_json_schema(),
            "component": ComponentPayload.model_json_schema(),
            "step": StepPayload.model_json_schema(),
            "research_recipe": RecipeResearchResponse.model_json_schema(),
        },
        "tables": {
            table.name: [column.name for column in table.columns]
            for table in Base.metadata.sorted_tables
        },
    }


def _extract_recipe_ingredient_names(row: RecipeVersion) -> list[str]:
    names = []
    for component in row.components or []:
        for ingredient in component.get("ingredients") or []:
            name = str(ingredient.get("name") or "").strip()
            if name:
                names.append(name)
    return sorted(set(names))


def _question_ingredient_candidates(question: str) -> list[str]:
    normalized = re.sub(r"[^a-zA-Z0-9\s-]", " ", question.lower())
    stopwords = {
        "a", "an", "are", "conversion", "convert", "cup", "cups", "for", "from",
        "gram", "grams", "how", "in", "into", "is", "lb", "lbs", "many", "much",
        "of", "ounce", "ounces", "oz", "pound", "pounds", "tablespoon",
        "tablespoons", "tbsp", "teaspoon", "teaspoons", "the", "this", "to",
        "tsp", "what", "with",
    }
    tokens = [token for token in normalized.split() if token and token not in stopwords and not token.isdigit()]
    candidates: list[str] = []
    for size in range(min(4, len(tokens)), 0, -1):
        for index in range(0, len(tokens) - size + 1):
            phrase = " ".join(tokens[index:index + size]).strip()
            if len(phrase) >= 3 and phrase not in candidates:
                candidates.append(phrase)
    return candidates[:12]


def _ingredient_knowledge_context(db: Session, row: RecipeVersion, question: str) -> dict:
    names = _extract_recipe_ingredient_names(row)
    candidates = names + [candidate for candidate in _question_ingredient_candidates(question) if candidate not in names]
    entries = []
    for name in candidates[:24]:
        key = _normalize_cache_key(name)
        cache_row = db.get(IngredientNutritionCache, key)
        builtin = lookup_builtin_nutrition(name)
        if not cache_row and not builtin:
            continue
        entries.append({
            "ingredient": name,
            "cache_key": key,
            "cached_usda": cache_row.to_dict() if cache_row else None,
            "builtin_per_100g": builtin._asdict() if builtin else None,
        })
    return {
        "recipe_ingredients": names,
        "matched_ingredient_knowledge": entries,
    }


def _assistant_should_search_web(question: str, local_context: dict) -> bool:
    text = question.lower()
    trigger_words = {
        "authentic", "convert", "conversion", "density", "fdc", "gram", "grams",
        "history", "latest", "look up", "lookup", "nutrition", "outside",
        "pan conversion", "pan size", "search", "source", "sources",
        "substitute", "substitution", "temperature", "traditional", "usda", "web",
    }
    if any(word in text for word in trigger_words):
        return True
    return not local_context["ingredients"]["matched_ingredient_knowledge"]


def _build_assistant_web_query(row: RecipeVersion, question: str) -> str:
    if any(unit in question.lower() for unit in ["gram", "grams", "convert", "conversion", "density"]):
        return f"{question} ingredient weight conversion reliable cooking source"
    if "nutrition" in question.lower() or "usda" in question.lower():
        return f"{question} USDA FoodData Central"
    return f"{row.name} recipe editing question: {question}"


def _preserve_step_images(current_steps: list[dict] | None, next_steps: list[dict]) -> list[dict]:
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
    is_model_available() the same way the auto-research endpoints do (unlike before,
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
        admin_ref=generate_admin_ref(),
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
        research_conversation={"messages": []},
        research_model=req.model,
        starting_prompt=req.prompt,
    )
    ensure_recipe_identity(version, db)
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
            "admin_ref": r.admin_ref,
            "public_slug": r.public_slug,
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
    row = _get_draft(db, recipe_id)
    recipe_id = row.recipe_id
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
    row = current_head_identity_query(db, recipe_id).first()
    if not row:
        raise HTTPException(404, "Recipe not found")
    ensure_recipe_identity(row, db)
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
    recipe_id = row.recipe_id
    patch = req.model_dump(exclude_unset=True)
    if "model" in patch:
        row.research_model = patch.pop("model")
    _apply_patch(row, patch, db, allow_null=True)
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


@router.post("/{recipe_id}/nutrition/refresh")
def refresh_research_nutrition(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Explicit admin action to recompute nutrition for the current draft.

    Uses the USDA-backed ingredient cache when configured, refreshes missing
    or expired ingredient rows, and falls back to the local heuristic engine
    when external data is unavailable.
    """
    row = _get_draft(db, recipe_id)
    recipe_id = row.recipe_id
    row.nutrition = compute_nutrition(row.components or [], db)
    row.base_servings_amount = estimated_yield_grams(row.components or [])
    row.base_servings_unit = "g"
    row.serving_size_unit = "g"
    audit_admin_action(
        db,
        action="research_nutrition_refreshed",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={
            "sources": row.nutrition.get("nutrition_sources", []),
            "unmatched_ingredients": row.nutrition.get("unmatched_ingredients", []),
        },
    )
    db.commit()
    return row.to_research_dict()


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
    recipe_id = row.recipe_id
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
    recipe_id = row.recipe_id
    if row.auto_research_status == "running":
        raise HTTPException(409, "Auto-research is already running for this recipe")
    if not is_web_search_configured():
        raise HTTPException(400, "OPENAI_API_KEY not set — add it to backend/.env for native web search")
    model = resolve_task_model("auto_research_crew", db, row.research_model)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")

    job_id = uuid.uuid4().hex
    approved_queries = list(req.approved_queries)[:4]
    job = ResearchJob(
        job_id=job_id,
        recipe_id=recipe_id,
        model=model,
        approved_queries=approved_queries,
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
        details={"job_id": job_id, "model": model, "query_count": len(approved_queries)},
    )
    db.commit()
    logger.info("auto_research_started", extra={"recipe_id": recipe_id, "job_id": job_id, "model": model})

    thread = threading.Thread(
        target=_run_auto_research_job,
        args=(recipe_id, approved_queries, model, row.starting_prompt, job_id),
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
                result_text = run_web_search(q)
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
            _apply_patch(row, patch, db)
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
    recipe_id = row.recipe_id
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
    auto-research endpoint."""
    row = _get_draft(db, recipe_id)
    recipe_id = row.recipe_id
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
    _apply_patch(row, patch, db)
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


@router.post("/{recipe_id}/wide-edit", response_model=RecipeWideEditResponse)
def recipe_wide_edit(
    recipe_id: str,
    req: RecipeWideEditRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """One broad admin instruction that can update multiple recipe fields in
    one pass. The returned `changed_fields` drives frontend review highlights."""
    row = _get_draft(db, recipe_id)
    recipe_id = row.recipe_id
    instruction = req.instruction.strip()
    if not instruction:
        raise HTTPException(400, "Instruction is required")
    if not is_litellm_configured():
        raise HTTPException(400, "litellm is not installed — check backend/requirements.txt")
    model = resolve_task_model("recipe_wide_edit", db, row.research_model)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")

    system_prompt = (
        "You are an expert recipe editor inside CurryForward. Apply the admin's "
        "broad instruction to the existing draft recipe. Return ONLY valid JSON "
        "with keys: recipe_patch, changed_fields, review_notes. recipe_patch must "
        "contain only changed fields from this allowlist: "
        f"{', '.join(PATCHABLE_FIELDS)}. Do not include notes, starting_prompt, "
        "hero_image_url, research metadata, or unchanged fields unless necessary. "
        "When changing ingredients, return the complete components array. When "
        "changing steps, return the complete steps array and do not remove image_url "
        "values you can see. Preserve factual integrity; if the requested diet/style "
        "requires ingredient substitutions, adjust related steps, intro, tips, "
        "watch-outs, utensils, pan conversions, timings, and tags as needed. "
        "changed_fields must list the top-level recipe_patch keys that changed."
    )
    current_document = row.to_research_dict()
    user_prompt = (
        f"Admin instruction:\n{instruction}\n\n"
        f"Current recipe JSON:\n{json.dumps(current_document, ensure_ascii=False)}"
    )
    try:
        response = litellm_completion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.35,
        )
        payload = _extract_json_object(response.choices[0].message.content or "{}")
    except Exception as e:
        record_llm_usage(task="recipe_wide_edit", model=model, role=role, status="error", error=str(e))
        raise HTTPException(500, f"Recipe-wide edit failed: {e}")
    record_llm_usage(task="recipe_wide_edit", model=model, role=role, response=response)

    patch = payload.get("recipe_patch") or {}
    if not isinstance(patch, dict):
        raise HTTPException(500, "Recipe-wide edit returned an invalid patch")
    patch = {key: value for key, value in patch.items() if key in PATCHABLE_FIELDS and key not in {"notes", "starting_prompt"}}
    if "steps" in patch and isinstance(patch["steps"], list):
        patch["steps"] = _preserve_step_images(row.steps or [], patch["steps"])
    changed_fields = payload.get("changed_fields")
    if not isinstance(changed_fields, list):
        changed_fields = list(patch.keys())
    changed_fields = [field for field in changed_fields if field in patch]
    if patch:
        _apply_patch(row, patch, db, allow_null=False)
    audit_admin_action(
        db,
        action="recipe_wide_edit_applied",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"fields": changed_fields, "model": model},
    )
    db.commit()
    return {
        "recipe": row.to_research_dict(),
        "changed_fields": changed_fields,
        "review_notes": payload.get("review_notes") if isinstance(payload.get("review_notes"), str) else None,
    }


@router.post("/{recipe_id}/ask", response_model=AdminAssistantResponse)
def ask_admin_assistant(
    recipe_id: str,
    req: AdminAssistantRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Admin-only utility assistant for edit pages.

    Answers operational questions such as conversions, ingredient reasoning,
    technique checks, or draft-review questions. It has no side effects and
    never patches the recipe.
    """
    row = _get_draft(db, recipe_id)
    recipe_id = row.recipe_id
    question = req.question.strip()
    if not question:
        raise HTTPException(400, "Question is required")
    if not is_litellm_configured():
        raise HTTPException(400, "litellm is not installed — check backend/requirements.txt")
    model = resolve_task_model("admin_assistant", db, row.research_model)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")

    history = []
    for item in (req.history or [])[-6:]:
        role_name = item.get("role")
        content = str(item.get("content") or "").strip()
        if role_name in {"user", "assistant"} and content:
            history.append({"role": role_name, "content": content[:1200]})

    local_context = {
        "schemas": _schema_context(),
        "ingredients": _ingredient_knowledge_context(db, row, question),
    }
    web_context = None
    web_query = None
    if _assistant_should_search_web(question, local_context):
        web_query = _build_assistant_web_query(row, question)
        if is_web_search_configured():
            try:
                web_context = run_web_search(web_query)
            except Exception as e:
                web_context = f"Web search was attempted but failed: {e}"
        else:
            web_context = "Web search is unavailable because OPENAI_API_KEY is not configured."

    system_prompt = (
        "You are CurryForward's admin editing assistant. Answer concise, practical "
        "recipe-editing questions for the admin. You may calculate unit conversions, "
        "reason about ingredient substitutions, explain technique, inspect internal "
        "recipe schemas/data, and use provided web context when local data is not "
        "enough. Do not claim you changed the recipe. Do not return JSON patches. "
        "For grams/conversions, clearly state assumptions when a conversion depends "
        "on ingredient density or form. If exact conversion is uncertain, give a "
        "useful range and say it should be verified. Prefer local USDA/cache data "
        "when present; otherwise use web context cautiously and name the uncertainty."
    )
    recipe_context = row.to_research_dict()
    messages = [
        {"role": "system", "content": system_prompt},
        *history,
        {
            "role": "user",
            "content": (
                "Current draft recipe context:\n"
                f"{json.dumps(recipe_context, ensure_ascii=False)[:12000]}\n\n"
                "Internal schema and local data context:\n"
                f"{json.dumps(local_context, ensure_ascii=False)[:16000]}\n\n"
                "External web context, if needed:\n"
                f"Query: {web_query or 'not used'}\n"
                f"{web_context or 'No web search was needed for this question.'}\n\n"
                f"Admin question:\n{question}"
            ),
        },
    ]
    try:
        response = litellm_completion(model=model, messages=messages, temperature=0.2)
        reply = (response.choices[0].message.content or "").strip()
    except Exception as e:
        record_llm_usage(task="admin_assistant", model=model, role=role, status="error", error=str(e))
        raise HTTPException(500, f"Assistant failed: {e}")
    record_llm_usage(task="admin_assistant", model=model, role=role, response=response)
    audit_admin_action(
        db,
        action="admin_assistant_asked",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"model": model, "web_query": web_query, "used_web": bool(web_query and web_context)},
    )
    db.commit()
    return {"reply": reply or "I could not produce a useful answer for that."}


@router.post("/{recipe_id}/rewrite", response_model=CopyRewriteResponse)
def rewrite_recipe_copy(
    recipe_id: str,
    req: CopyRewriteRequest,
    request: Request,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    """Admin-only microcopy helper for individual editable fields. It returns
    a candidate string only; the caller decides whether to apply it through
    the normal PATCH/autosave path."""
    row = _get_draft(db, recipe_id)
    recipe_id = row.recipe_id
    if not is_litellm_configured():
        raise HTTPException(400, "litellm is not installed — check backend/requirements.txt")
    model = resolve_task_model("copy_rewrite", db, row.research_model)
    if not is_model_available(model):
        raise HTTPException(400, f"No API key configured for model '{model}' — add it to backend/.env")

    field_label = req.field_label.strip()[:120] or "recipe field"
    source_text = req.text.strip()
    instruction = (req.instruction or "").strip() or "Rewrite this into polished, user-friendly copy."
    context = (req.recipe_context or "").strip()[:600]
    context_line = f"Nearby context: {context}\n" if context else ""
    if not source_text:
        raise HTTPException(400, "Text is required")

    system_prompt = (
        "You are a precise recipe copy editor inside CurryForward. Rewrite only "
        "the requested field into clear, warm, publishable recipe copy. Keep the "
        "same factual meaning. Do not invent facts, ingredients, timings, dietary "
        "claims, history, or provenance. Return only the rewritten field text, no "
        "quotes, markdown, labels, or explanation. Preserve list-like formatting "
        "when the input is a newline-separated list."
    )
    user_prompt = (
        f"Recipe: {row.name}\n"
        f"Field: {field_label}\n"
        f"Admin direction: {instruction}\n"
        f"{context_line}"
        f"Current text:\n{source_text}"
    )
    try:
        response = litellm_completion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
        )
        text = (response.choices[0].message.content or "").strip()
    except Exception as e:
        record_llm_usage(task="copy_rewrite", model=model, role=role, status="error", error=str(e))
        raise HTTPException(500, f"Rewrite failed: {e}")
    record_llm_usage(task="copy_rewrite", model=model, role=role, response=response)
    if not text:
        raise HTTPException(500, "Rewrite returned an empty response")
    audit_admin_action(
        db,
        action="copy_rewrite_generated",
        target_type="recipe",
        target_id=recipe_id,
        request=request,
        details={"field": field_label},
    )
    db.commit()
    return {"text": text}


@router.post("/{recipe_id}/publish")
def publish_research_recipe(
    recipe_id: str,
    request: Request,
    req: PublishResearchRequest | None = None,
    db: Session = Depends(get_db),
    role: str = Depends(require_admin),
):
    row = _get_draft(db, recipe_id)
    recipe_id = row.recipe_id
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
            public_slug=current_original.public_slug or unique_public_slug(db, row.name, original.recipe_id),
            admin_ref=generate_admin_ref(),
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
            nutrition=row.nutrition or compute_nutrition(row.components or [], db),
            hero_image_url=row.hero_image_url,
            intro=row.intro,
            history=row.history,
            prep_time_minutes=row.prep_time_minutes,
            cook_time_minutes=row.cook_time_minutes,
            tips=row.tips,
            watch_outs=row.watch_outs,
            suggested_utensils=row.suggested_utensils,
            pan_conversions=row.pan_conversions,
            status="published",
            source=row.source if row.source != "revision_draft" else current_original.source,
            is_current_head=True,
        )
        ensure_recipe_identity(replacement, db)
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
    row.public_slug = row.public_slug or unique_public_slug(db, row.name, row.recipe_id)
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
    row = current_head_identity_query(db, recipe_id).first()
    if not row:
        raise HTTPException(404, "Recipe not found")
    recipe_id = row.recipe_id
    if row.status != "published":
        raise HTTPException(400, "This recipe is not published")
    row.status = "draft"
    audit_admin_action(db, action="recipe_unpublished", target_type="recipe", target_id=recipe_id, request=request)
    db.commit()
    return row.to_research_dict()
