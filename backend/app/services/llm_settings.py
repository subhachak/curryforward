from __future__ import annotations

import os
from sqlalchemy.orm import Session

from ..models import LLMSetting

TASK_DEFAULTS = {
    "feedback_moderation": {
        "label": "Feedback moderation",
        "default_model": "gemini/gemini-2.5-flash-lite",
        "description": "Cheap, fast classification for ratings, reviews, and comments.",
    },
    "dish_name_extraction": {
        "label": "Dish name extraction",
        "default_model": "gemini/gemini-2.5-flash-lite",
        "description": "Tiny extraction call when starting a research draft.",
    },
    "research_chat": {
        "label": "Guided research chat",
        "default_model": "gemini/gemini-2.5-flash",
        "description": "Balanced cost and quality for iterative recipe research.",
    },
    "research_plan": {
        "label": "Auto-research planning",
        "default_model": "gemini/gemini-2.5-flash-lite",
        "description": "Proposes search queries before auto-research runs.",
    },
    "auto_research_crew": {
        "label": "Auto-research crew",
        "default_model": "gemini/gemini-2.5-flash",
        "description": "Parallel history, ingredients, steps, tips, and merge agents.",
    },
    "section_refine": {
        "label": "Section refinement",
        "default_model": "gemini/gemini-2.5-flash",
        "description": "Focused rewrites for recipe sections.",
    },
    "recipe_customize": {
        "label": "Recipe customization",
        "default_model": "anthropic/claude-haiku-4-5-20251001",
        "description": "Transforms existing recipes from assistant chat. Anthropic-only for current tool-call path.",
    },
    "recipe_draft": {
        "label": "Conversational recipe draft",
        "default_model": "anthropic/claude-sonnet-5",
        "description": "Creates or refines draft recipes. Anthropic-only because this flow uses Anthropic web search.",
    },
    "gap_generation": {
        "label": "Missing recipe generation",
        "default_model": "anthropic/claude-sonnet-5",
        "description": "Generates a new recipe when a search has no match. Anthropic-only because this flow uses Anthropic web search.",
    },
}

ANTHROPIC_ONLY_TASKS = {"recipe_customize", "recipe_draft", "gap_generation"}

MODEL_CATALOG = [
    {
        "id": "gemini/gemini-2.5-flash-lite",
        "label": "Gemini 2.5 Flash-Lite (cheapest)",
        "provider": "Gemini",
        "provider_env_var": "GEMINI_API_KEY",
        "provider_env_vars": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    },
    {
        "id": "gemini/gemini-2.5-flash",
        "label": "Gemini 2.5 Flash (balanced)",
        "provider": "Gemini",
        "provider_env_var": "GEMINI_API_KEY",
        "provider_env_vars": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    },
    {
        "id": "gemini/gemini-2.5-pro",
        "label": "Gemini 2.5 Pro (highest Gemini quality)",
        "provider": "Gemini",
        "provider_env_var": "GEMINI_API_KEY",
        "provider_env_vars": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    },
    {
        "id": "openai/gpt-5-nano",
        "label": "GPT-5 nano (OpenAI, cheapest)",
        "provider": "OpenAI",
        "provider_env_var": "OPENAI_API_KEY",
        "provider_env_vars": ["OPENAI_API_KEY"],
    },
    {
        "id": "openai/gpt-5-mini",
        "label": "GPT-5 mini (OpenAI, balanced)",
        "provider": "OpenAI",
        "provider_env_var": "OPENAI_API_KEY",
        "provider_env_vars": ["OPENAI_API_KEY"],
    },
    {
        "id": "openai/gpt-5",
        "label": "GPT-5 (OpenAI, high quality)",
        "provider": "OpenAI",
        "provider_env_var": "OPENAI_API_KEY",
        "provider_env_vars": ["OPENAI_API_KEY"],
    },
    {
        "id": "anthropic/claude-haiku-4-5-20251001",
        "label": "Claude Haiku 4.5 (Anthropic, cheaper)",
        "provider": "Anthropic",
        "provider_env_var": "ANTHROPIC_API_KEY",
        "provider_env_vars": ["ANTHROPIC_API_KEY"],
    },
    {
        "id": "anthropic/claude-sonnet-5",
        "label": "Claude Sonnet 5 (Anthropic, high quality)",
        "provider": "Anthropic",
        "provider_env_var": "ANTHROPIC_API_KEY",
        "provider_env_vars": ["ANTHROPIC_API_KEY"],
    },
    {
        "id": "anthropic/claude-sonnet-4-5-20250929",
        "label": "Claude Sonnet 4.5 (Anthropic)",
        "provider": "Anthropic",
        "provider_env_var": "ANTHROPIC_API_KEY",
        "provider_env_vars": ["ANTHROPIC_API_KEY"],
    },
]


def model_provider_keys(model: str) -> list[str]:
    entry = next((m for m in MODEL_CATALOG if m["id"] == model), None)
    if entry:
        return list(entry.get("provider_env_vars") or [entry["provider_env_var"]])
    if model.startswith("gemini/"):
        return ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
    if model.startswith("openai/"):
        return ["OPENAI_API_KEY"]
    return ["ANTHROPIC_API_KEY"]


def is_model_available(model: str) -> bool:
    return any(os.environ.get(key) for key in model_provider_keys(model))


def available_models() -> list[dict]:
    return [
        {
            **model,
            "available": is_model_available(model["id"]),
        }
        for model in MODEL_CATALOG
    ]


def get_llm_settings(db: Session) -> list[dict]:
    overrides = {row.key: row.model for row in db.query(LLMSetting).all()}
    return [
        {
            "key": key,
            **meta,
            "model": overrides.get(key) or os.environ.get(f"LLM_MODEL_{key.upper()}") or meta["default_model"],
        }
        for key, meta in TASK_DEFAULTS.items()
    ]


def set_llm_setting(db: Session, key: str, model: str) -> dict:
    if key not in TASK_DEFAULTS:
        raise ValueError(f"Unknown LLM setting '{key}'")
    if key in ANTHROPIC_ONLY_TASKS and not model.startswith("anthropic/"):
        raise ValueError(f"{TASK_DEFAULTS[key]['label']} currently supports Anthropic models only")
    row = db.query(LLMSetting).filter(LLMSetting.key == key).first()
    if row is None:
        row = LLMSetting(key=key, model=model)
        db.add(row)
    else:
        row.model = model
    db.commit()
    db.refresh(row)
    return row.to_dict()


def resolve_task_model(task: str, db: Session | None = None, explicit_model: str | None = None) -> str:
    if explicit_model:
        return explicit_model
    model = None
    if db is not None:
        row = db.query(LLMSetting).filter(LLMSetting.key == task).first()
        if row:
            model = row.model
    if task in TASK_DEFAULTS:
        model = model or os.environ.get(f"LLM_MODEL_{task.upper()}") or TASK_DEFAULTS[task]["default_model"]
    model = model or os.environ.get("DEFAULT_MODEL", "gemini/gemini-2.5-flash")
    if is_model_available(model):
        return model

    candidates = MODEL_CATALOG
    if task in ANTHROPIC_ONLY_TASKS:
        candidates = [candidate for candidate in candidates if candidate["id"].startswith("anthropic/")]
    fallback = next((candidate["id"] for candidate in candidates if is_model_available(candidate["id"])), None)
    return fallback or model


def anthropic_model_name(model: str) -> str:
    return model.removeprefix("anthropic/")
