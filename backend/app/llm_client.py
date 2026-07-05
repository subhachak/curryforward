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

try:
    import litellm
    litellm.drop_params = True  # silently ignore a per-provider param LiteLLM
    # can't forward (e.g. parallel_tool_calls on a provider that doesn't
    # support it) instead of hard-erroring — we want swapping models to be
    # forgiving, not brittle.
except ImportError:
    litellm = None

def available_models() -> list[dict]:
    """Filters MODEL_CATALOG to entries whose provider key is actually set —
    the dropdown only ever offers a model that would actually work."""
    from .services.llm_settings import available_models as catalog

    return [m for m in catalog() if m["available"]]


def resolve_model(model: str | None) -> str:
    """A session's chosen model, or the configured default if unset/blank."""
    from .services.llm_settings import resolve_task_model

    return model or resolve_task_model("research_chat")


def is_model_available(model: str) -> bool:
    """Whether the given model's provider key is set. Unknown model strings
    (not in our small catalog) fall back to checking ANTHROPIC_API_KEY, since
    that's the only provider guaranteed to be relevant to this app."""
    from .services.llm_settings import is_model_available as available

    return available(model)


def is_litellm_configured() -> bool:
    return litellm is not None


def litellm_completion(**kwargs):
    """Thin pass-through to litellm.completion — the one seam tests
    monkeypatch instead of ever hitting a real provider."""
    if litellm is None:
        raise RuntimeError("litellm is not installed — check backend/requirements.txt")
    return litellm.completion(**kwargs)
