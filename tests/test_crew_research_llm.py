"""
Direct unit tests for the LLM-call helpers in app.crew_research — one level
below test_auto_research.py's router-level tests, which mock these functions
away entirely per that file's own stated convention. Here we mock
crew_research.litellm_completion (never the real network call) to reproduce
the exact production failure mode: a reasoning model (o-series/gpt-5) that
spends its token budget on hidden reasoning and gets cut off mid-JSON,
surfaced by litellm as finish_reason="length".
"""
import os
import sys
from pathlib import Path
from types import SimpleNamespace

os.environ["ADMIN_TOKEN"] = "test-token-123"
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
from app import crew_research


def _fake_response(content: str, finish_reason: str = "stop"):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish_reason)]
    )


def test_propose_search_batch_raises_clear_error_on_truncation(monkeypatch):
    def fake_completion(**kwargs):
        return _fake_response('{"plan": "partial plan", "queries": [{"query": "incomple', finish_reason="length")

    monkeypatch.setattr(crew_research, "litellm_completion", fake_completion)
    with pytest.raises(RuntimeError, match="cut off"):
        crew_research.propose_search_batch("Butter Chicken", None, "openai/gpt-5-mini")


def test_propose_search_batch_passes_reasoning_effort_and_headroom(monkeypatch):
    captured = {}

    def fake_completion(**kwargs):
        captured.update(kwargs)
        return _fake_response('{"plan": "A short plan.", "queries": [{"query": "q1", "category": "history"}]}')

    monkeypatch.setattr(crew_research, "litellm_completion", fake_completion)
    result = crew_research.propose_search_batch("Butter Chicken", None, "openai/gpt-5-mini")

    assert result == {"plan": "A short plan.", "queries": [{"query": "q1", "category": "history"}]}
    assert captured["reasoning_effort"] == "low"
    assert captured["max_tokens"] >= 2000


def test_refine_section_raises_clear_error_on_truncation(monkeypatch):
    def fake_completion(**kwargs):
        return _fake_response('{"tips": ["tip one", "tip tw', finish_reason="length")

    monkeypatch.setattr(crew_research, "litellm_completion", fake_completion)
    with pytest.raises(RuntimeError, match="cut off"):
        crew_research.refine_section("tips", {"tips": [], "watch_outs": []}, "add a tip", "openai/gpt-5-mini")


def test_extract_dish_name_falls_back_silently_on_truncation(monkeypatch):
    """extract_dish_name must never raise — a bad/incomplete LLM response
    should fall back to a truncated slice of the prompt, not surface a 500
    and block draft creation."""

    def fake_completion(**kwargs):
        return _fake_response('{"name": "Butter Chic', finish_reason="length")

    monkeypatch.setattr(crew_research, "litellm_completion", fake_completion)
    name = crew_research.extract_dish_name("Butter Chicken with extra creamy sauce", "openai/gpt-5-mini")
    assert name == "Butter Chicken with extra creamy sauce"


def _find_schemas(schema: dict) -> list[dict]:
    """Every object-typed schema reachable from the root, including $defs —
    matches how OpenAI's own strict-schema validator walks a JSON schema."""
    found = []

    def walk(node):
        if not isinstance(node, dict):
            return
        if node.get("type") == "object":
            found.append(node)
        for value in node.get("$defs", {}).values():
            walk(value)
        for value in node.get("properties", {}).values():
            walk(value)
        if isinstance(node.get("items"), dict):
            walk(node["items"])
        for variant in node.get("anyOf", []):
            walk(variant)

    walk(schema)
    return found


@pytest.mark.parametrize(
    "model_cls",
    [
        crew_research.HistorySection,
        crew_research.IngredientsSection,
        crew_research.StepsSection,
        crew_research.TipsSection,
        crew_research.MergedRecipePatch,
    ],
)
def test_crew_schemas_are_openai_strict_mode_compatible(model_cls):
    """Regression test for a real production 500: 'additionalProperties' is
    required to be supplied and to be false. A bare `dict`-typed field (as
    IngredientsSection.components/StepsSection.steps/TipsSection.
    pan_conversions/MergedRecipePatch's equivalents used to be) makes Pydantic
    emit "additionalProperties": true for that object schema — since OpenAI's
    strictifier only injects `false` when the key is *absent*, that `true`
    survives and OpenAI's structured-outputs mode rejects the whole schema.
    Every object schema reachable from these CrewAI output_pydantic models
    must have no "additionalProperties" key (Pydantic's default for a
    concretely-typed model) so OpenAI's own strictifier can correctly set it
    to false."""
    for obj_schema in _find_schemas(model_cls.model_json_schema()):
        assert "additionalProperties" not in obj_schema, (
            f"{model_cls.__name__} has an object schema with "
            f"additionalProperties already set — replace the bare `dict` "
            f"field with a concrete nested model: {obj_schema}"
        )
