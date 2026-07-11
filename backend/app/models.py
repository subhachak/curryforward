from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Column, DateTime, Float, ForeignKey, Integer, String, Text, Boolean
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def _uid() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _secure_public_url(value: str | None) -> str | None:
    """Avoid browser mixed-content warnings from imported/researched media.

    Local dev URLs are left alone; public remote media is upgraded from http
    to https before it reaches the browser.
    """
    if not value or not isinstance(value, str):
        return value
    lowered = value.lower()
    if not lowered.startswith("http://"):
        return value
    if lowered.startswith(("http://localhost", "http://127.0.0.1", "http://0.0.0.0")):
        return value
    return "https://" + value[len("http://"):]


def _secure_steps(steps: list[dict] | None) -> list[dict]:
    result = []
    for step in steps or []:
        next_step = dict(step)
        next_step["image_url"] = _secure_public_url(next_step.get("image_url"))
        result.append(next_step)
    return result


class RecipeVersion(Base):
    """
    Each row is one version. While `status == "draft"` a row is mutated in
    place (research autosave) — no new version per edit. Once
    `status == "published"`, the existing immutable-new-version-per-edit
    behavior applies again (see routers/recipes.py's update_recipe).
    """
    __tablename__ = "recipe_versions"

    version_id = Column(String, primary_key=True, default=_uid)
    recipe_id = Column(String, index=True, nullable=False)
    public_slug = Column(String, index=True, nullable=True)
    admin_ref = Column(String, index=True, nullable=True)
    parent_version_id = Column(String, ForeignKey("recipe_versions.version_id"), nullable=True)
    lineage = Column(String, default="seed")  # seed | edit | fork | generated | user_customized | researched

    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    cuisine_tags = Column(JSON, default=list)
    hero_image_url = Column(String, nullable=True)

    base_servings_amount = Column(Float, nullable=True)
    base_servings_unit = Column(String, default="servings")
    serving_count = Column(Float, nullable=True)
    serving_size_amount = Column(Float, nullable=True)
    serving_size_unit = Column(String, nullable=True)

    components = Column(JSON, default=list)   # [{component_name, ingredients:[...]}]
    steps = Column(JSON, default=list)        # [{step_number, component_ref, instruction, image_url}]
    nutrition = Column(JSON, default=dict)    # computed nutrition snapshot, per this version

    # Research-flow content — all optional, guest-safe (included in to_dict()).
    intro = Column(Text, nullable=True)
    history = Column(Text, nullable=True)       # origin/tradition/historical significance, one narrative field
    prep_time_minutes = Column(Integer, nullable=True)
    cook_time_minutes = Column(Integer, nullable=True)
    tips = Column(JSON, default=list)           # list[str]
    watch_outs = Column(JSON, default=list)     # list[str]
    suggested_utensils = Column(JSON, default=list)  # list[str]
    pan_conversions = Column(JSON, default=list)     # [{from_count, from_size, to_count, to_size, note}]

    # Admin-only scratch fields — never sent to guests, excluded from to_dict().
    notes = Column(Text, nullable=True)
    research_conversation = Column(JSON, nullable=True)  # legacy transcript field, inert in current flow
    research_model = Column(String, nullable=True)  # LiteLLM model string for this session, e.g. "anthropic/claude-sonnet-5"
    starting_prompt = Column(Text, nullable=True)  # the admin's freeform kickoff text — a name, a description, or a full pasted draft

    # Auto-research (CrewAI) runs in a background thread since it can take a
    # minute or more — longer than typical proxy/gateway timeouts — so the
    # kickoff request returns immediately and the frontend polls this recipe
    # for these fields instead of holding one long HTTP request open.
    auto_research_status = Column(String, nullable=True)  # None | "running" | "error"
    auto_research_error = Column(Text, nullable=True)
    auto_research_progress = Column(JSON, nullable=True)  # list of completed section keys: history/ingredients/steps/tips/merge
    auto_research_activity = Column(JSON, nullable=True)  # human-readable progress events for the polling UI
    # Fencing token: set to a fresh id on every /auto/run kickoff. A
    # background job only applies its result if this still matches the id it
    # was started with — /auto/cancel clears it so an abandoned job's result
    # is silently discarded instead of overwriting a cancelled/superseded run.
    auto_research_job_id = Column(String, nullable=True)

    status = Column(String, default="published")  # draft | published
    source = Column(String, default="seed")   # seed | web_augmented | generated | user_customized | researched
    is_current_head = Column(Boolean, default=True)  # latest version for this recipe_id
    # Soft-delete marker on the current-head row only — hides the recipe from
    # every list (guest and admin) while keeping the row (and full history)
    # intact. Restore clears it. Permanent removal is a separate "purge"
    # action gated on this already being set (see routers/admin.py).
    deleted_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        """Guest-safe shape — excludes notes and research_conversation."""
        return {
            "version_id": self.version_id,
            "recipe_id": self.recipe_id,
            "public_slug": self.public_slug,
            "parent_version_id": self.parent_version_id,
            "lineage": self.lineage,
            "name": self.name,
            "category": self.category,
            "cuisine_tags": self.cuisine_tags or [],
            "hero_image_url": _secure_public_url(self.hero_image_url),
            "base_servings": {"amount": self.base_servings_amount, "unit": self.base_servings_unit},
            "serving_count": self.serving_count,
            "serving_size": {"amount": self.serving_size_amount, "unit": self.serving_size_unit},
            "components": self.components or [],
            "steps": _secure_steps(self.steps),
            "nutrition": self.nutrition or {},
            "intro": self.intro,
            "history": self.history,
            "prep_time_minutes": self.prep_time_minutes,
            "cook_time_minutes": self.cook_time_minutes,
            "tips": self.tips or [],
            "watch_outs": self.watch_outs or [],
            "suggested_utensils": self.suggested_utensils or [],
            "pan_conversions": self.pan_conversions or [],
            "status": self.status or "published",
            "source": self.source,
            "is_current_head": self.is_current_head,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_research_dict(self) -> dict:
        """Admin-only shape for the research workspace — adds notes and draft metadata."""
        return {
            **self.to_dict(),
            "admin_ref": self.admin_ref,
            "notes": self.notes,
            "research_conversation": self.research_conversation or {"messages": []},
            "research_model": self.research_model,
            "starting_prompt": self.starting_prompt,
            "auto_research_status": self.auto_research_status,
            "auto_research_error": self.auto_research_error,
            "auto_research_progress": self.auto_research_progress or [],
            "auto_research_activity": self.auto_research_activity or [],
        }


class RecipeAnalytics(Base):
    """Simple per-recipe counters — keyed by recipe_id (not version_id),
    since a version changes on every edit and counts must survive that.
    Not an event log/time-series; just aggregate totals, matching the scope
    of "views, downloads" the admin dashboard actually asked for."""
    __tablename__ = "recipe_analytics"

    recipe_id = Column(String, primary_key=True)
    view_count = Column(Integer, default=0, nullable=False)
    download_count = Column(Integer, default=0, nullable=False)
    like_count = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        return {
            "recipe_id": self.recipe_id,
            "view_count": self.view_count,
            "download_count": self.download_count,
            "like_count": self.like_count,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class SiteVisit(Base):
    """Privacy-light first-party page view event.

    Stores only an anonymous browser-generated id, public path, referrer host,
    and timestamp. IP addresses and user-agent strings are intentionally not
    retained.
    """
    __tablename__ = "site_visits"

    visit_id = Column(String, primary_key=True, default=_uid)
    visitor_id = Column(String, index=True, nullable=False)
    path = Column(String, index=True, nullable=False)
    referrer = Column(String, nullable=True)
    visited_at = Column(DateTime, default=_now, index=True, nullable=False)


class RecipeFeedback(Base):
    """Public per-recipe ratings, reviews, and comments.

    A row with rating is a review; a row without rating is a comment. Keep this
    keyed to recipe_id so feedback survives version replacement.
    """
    __tablename__ = "recipe_feedback"

    feedback_id = Column(String, primary_key=True, default=_uid)
    recipe_id = Column(String, index=True, nullable=False)
    parent_feedback_id = Column(String, index=True, nullable=True)
    author_name = Column(String, nullable=True)
    rating = Column(Integer, nullable=True)
    comment = Column(Text, nullable=False)
    status = Column(String, default="pending_review", nullable=False)
    moderation_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        return {
            "feedback_id": self.feedback_id,
            "recipe_id": self.recipe_id,
            "parent_feedback_id": self.parent_feedback_id,
            "author_name": self.author_name,
            "rating": self.rating,
            "comment": self.comment,
            "status": self.status,
            "moderation_reason": self.moderation_reason,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class LLMSetting(Base):
    """Admin-configurable default model per LLM task."""
    __tablename__ = "llm_settings"

    key = Column(String, primary_key=True)
    model = Column(String, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "model": self.model,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class ResearchJob(Base):
    """Audit trail for auto-research runs. The current recipe row still keeps
    the live polling fields; this table preserves the historical run inputs,
    progress, and outcome for debugging and future retry UI."""
    __tablename__ = "research_jobs"

    job_id = Column(String, primary_key=True)
    recipe_id = Column(String, index=True, nullable=False)
    model = Column(String, nullable=True)
    approved_queries = Column(JSON, default=list)
    search_results = Column(JSON, default=list)
    status = Column(String, default="running")  # running | completed | error | cancelled | superseded
    progress = Column(JSON, default=list)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime, default=_now)
    finished_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "recipe_id": self.recipe_id,
            "model": self.model,
            "approved_queries": self.approved_queries or [],
            "search_results": self.search_results or [],
            "status": self.status,
            "progress": self.progress or [],
            "error": self.error,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class IngredientNutritionCache(Base):
    """USDA-backed ingredient nutrition corpus.

    Keyed by the normalized ingredient query we use for lookup. The nutrient
    payload stores per-100g values in the same field names expected by
    backend.app.nutrition.NutrientProfile, so recipe nutrition can be computed
    without another external call until the cache expires.
    """
    __tablename__ = "ingredient_nutrition_cache"

    cache_key = Column(String, primary_key=True)
    ingredient_name = Column(String, nullable=False)
    source = Column(String, default="usda_fdc", nullable=False)
    source_food_id = Column(String, nullable=True)
    source_food_name = Column(String, nullable=True)
    nutrients = Column(JSON, default=dict, nullable=False)
    raw_result = Column(JSON, default=dict)
    fetched_at = Column(DateTime, default=_now, nullable=False)
    expires_at = Column(DateTime, nullable=False)

    def to_dict(self) -> dict:
        return {
            "cache_key": self.cache_key,
            "ingredient_name": self.ingredient_name,
            "source": self.source,
            "source_food_id": self.source_food_id,
            "source_food_name": self.source_food_name,
            "nutrients": self.nutrients or {},
            "fetched_at": self.fetched_at.isoformat() if self.fetched_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
        }


class AdminAuditLog(Base):
    """Append-only record of privileged changes made through the admin surface."""
    __tablename__ = "admin_audit_logs"

    log_id = Column(String, primary_key=True, default=_uid)
    action = Column(String, nullable=False)
    target_type = Column(String, nullable=True)
    target_id = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    details = Column(JSON, default=dict)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "log_id": self.log_id,
            "action": self.action,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "ip_address": self.ip_address,
            "details": self.details or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class LLMUsageLog(Base):
    """Best-effort usage/cost trace for every app-owned LLM call we can observe."""
    __tablename__ = "llm_usage_logs"

    usage_id = Column(String, primary_key=True, default=_uid)
    task = Column(String, nullable=False)
    model = Column(String, nullable=True)
    provider = Column(String, nullable=True)
    role = Column(String, nullable=True)
    status = Column(String, nullable=False)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "usage_id": self.usage_id,
            "task": self.task,
            "model": self.model,
            "provider": self.provider,
            "role": self.role,
            "status": self.status,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "error": self.error,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
