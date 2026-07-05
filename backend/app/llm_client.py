"""
Shared LiteLLM plumbing for the provider-swappable flows: the guided research
chat (start_research_turn/continue_research_turn in llm_agent.py) and
auto-research (crew_research.py, including the CrewAI agents themselves, which
accept a plain LiteLLM model string via Agent(llm=...)).

NOT used by customize_recipe/draft_recipe_from_conversation/generate_recipe_for_gap
in llm_agent.py — those keep using Anthropic's server-executed web_search tool
directly via the raw anthropic SDK, since LiteLLM has no equivalent for that
Anthropic-proprietary built-in tool without a bigger rewrite.
"""
from __future__ import annotations

import os

try:
    import litellm
    litellm.drop_params = True  # silently ignore a per-provider param LiteLLM
    # can't forward (e.g. parallel_tool_calls on a provider that doesn't
    # support it) instead of hard-erroring — we want swapping models to be
    # forgiving, not brittle.
except ImportError:
    litellm = None

MODEL_CATALOG = [
    {"id": "anthropic/claude-sonnet-5", "label": "Claude Sonnet 5 (Anthropic)", "provider_env_var": "ANTHROPIC_API_KEY"},
    {"id": "anthropic/claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5 (Anthropic, cheaper)", "provider_env_var": "ANTHROPIC_API_KEY"},
    {"id": "openai/gpt-4o-mini", "label": "GPT-4o mini (OpenAI, cheap)", "provider_env_var": "OPENAI_API_KEY"},
    {"id": "openai/gpt-4o", "label": "GPT-4o (OpenAI)", "provider_env_var": "OPENAI_API_KEY"},
    {"id": "groq/llama-3.3-70b-versatile", "label": "Llama 3.3 70B (Groq, fastest/cheapest)", "provider_env_var": "GROQ_API_KEY"},
]


def available_models() -> list[dict]:
    """Filters MODEL_CATALOG to entries whose provider key is actually set —
    the dropdown only ever offers a model that would actually work."""
    return [m for m in MODEL_CATALOG if os.environ.get(m["provider_env_var"])]


def resolve_model(model: str | None) -> str:
    """A session's chosen model, or the configured default if unset/blank."""
    return model or os.environ.get("DEFAULT_MODEL", "anthropic/claude-sonnet-5")


def is_model_available(model: str) -> bool:
    """Whether the given model's provider key is set. Unknown model strings
    (not in our small catalog) fall back to checking ANTHROPIC_API_KEY, since
    that's the only provider guaranteed to be relevant to this app."""
    entry = next((m for m in MODEL_CATALOG if m["id"] == model), None)
    if entry is None:
        return bool(os.environ.get("ANTHROPIC_API_KEY"))
    return bool(os.environ.get(entry["provider_env_var"]))


def is_litellm_configured() -> bool:
    return litellm is not None


def litellm_completion(**kwargs):
    """Thin pass-through to litellm.completion — the one seam tests
    monkeypatch instead of ever hitting a real provider."""
    if litellm is None:
        raise RuntimeError("litellm is not installed — check backend/requirements.txt")
    return litellm.completion(**kwargs)
