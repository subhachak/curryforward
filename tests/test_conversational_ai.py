import os
import sys
from pathlib import Path

os.environ["ADMIN_TOKEN"] = "test-token-123"
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from fastapi.testclient import TestClient
import app.llm_agent as llm_agent
import app.routers.recipes as recipes_router
from app.llm_agent import LLMInvalidResponseError
from app.main import app
from app.db import SessionLocal, init_db
from app.seed_loader import load_seed_data

init_db()
_db = SessionLocal()
load_seed_data(_db)
_db.close()

client = TestClient(app)
ADMIN_HEADERS = {"X-Admin-Token": "test-token-123"}


class FakeContentBlock:
    def __init__(self, block_type, text=None, name=None, input=None):
        self.type = block_type
        self.text = text
        self.name = name
        self.input = input


class FakeMessage:
    def __init__(self, content):
        self.content = content


class FakeMessagesClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


class FakeAnthropicClient:
    def __init__(self, responses):
        self.messages = FakeMessagesClient(responses)


class FailingMessagesClient:
    def create(self, **kwargs):
        raise RuntimeError("Expecting value: line 1 column 1 (char 0)")


class FailingAnthropicClient:
    messages = FailingMessagesClient()


def _valid_customization_payload():
    return {
        "components": [
            {
                "component_name": "Main",
                "ingredients": [
                    {
                        "ingredient_id": "i1",
                        "name": "Chicken",
                        "amount": 500,
                        "unit": "g",
                        "gram_equivalent": 500,
                    }
                ],
            }
        ],
        "steps": [{"step_number": 1, "component_ref": "Main", "instruction": "Cook the chicken."}],
        "change_summary": "Kept the recipe focused.",
    }


def _current_recipe_payload():
    return {
        "components": [
            {
                "component_name": "Main",
                "ingredients": [{"ingredient_id": "i1", "name": "Chicken", "amount": 500, "unit": "g"}],
            }
        ],
        "steps": [{"step_number": 1, "component_ref": "Main", "instruction": "Cook the chicken."}],
    }


def test_guest_cannot_access_draft_endpoint():
    r = client.post("/api/recipes/draft", json={"message": "a spicy chicken curry"})
    assert r.status_code == 403


def test_admin_draft_without_api_key_returns_clear_error(monkeypatch):
    # Force the "not configured" path deterministically — a real key may be
    # present in backend/.env for local dev, and these tests shouldn't
    # depend on (or spend) it.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post(
        "/api/recipes/draft", json={"message": "a spicy chicken curry"}, headers=ADMIN_HEADERS
    )
    assert r.status_code == 400
    assert "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_draft_endpoint_accepts_history_and_current_draft(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    payload = {
        "message": "make it vegan",
        "history": [
            {"role": "user", "content": "a chicken curry"},
            {"role": "assistant", "content": "Drafted a chicken curry."},
        ],
        "draft": {"name": "Chicken Curry", "components": [], "steps": []},
    }
    r = client.post("/api/recipes/draft", json=payload, headers=ADMIN_HEADERS)
    # The point of this test is that the request *shape* (history + draft)
    # passes validation and reaches the "not configured" check, not a 422.
    assert r.status_code == 400


def test_chat_endpoint_accepts_history_field(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    payload = {
        "message": "make it spicier",
        "history": [
            {"role": "user", "content": "add more onions"},
            {"role": "assistant", "content": "Added extra onions."},
        ],
    }
    r = client.post("/api/recipes/bonde/chat", json=payload, headers=ADMIN_HEADERS)
    assert r.status_code == 400
    assert "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_chat_history_defaults_to_empty_list(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post(
        "/api/recipes/bonde/chat", json={"message": "make it spicier"}, headers=ADMIN_HEADERS
    )
    assert r.status_code == 400


def test_customize_recipe_uses_forced_tool_output(monkeypatch):
    fake_client = FakeAnthropicClient(
        [
            FakeMessage(
                [
                    FakeContentBlock(
                        "tool_use",
                        name="customize_recipe",
                        input=_valid_customization_payload(),
                    )
                ]
            )
        ]
    )
    monkeypatch.setattr(llm_agent, "_client", lambda: fake_client)

    result = llm_agent.customize_recipe(_current_recipe_payload(), "make it spicier")

    assert result["change_summary"] == "Kept the recipe focused."
    assert fake_client.messages.calls[0]["tools"][0]["name"] == "customize_recipe"
    assert fake_client.messages.calls[0]["tool_choice"] == {
        "type": "tool",
        "name": "customize_recipe",
    }
    assert fake_client.messages.calls[0]["timeout"] == llm_agent.CUSTOMIZE_TIMEOUT_SECONDS


def test_customize_recipe_accepts_recipe_style_quantity_strings(monkeypatch):
    payload = _valid_customization_payload()
    payload["components"][0]["ingredients"][0]["amount"] = "1 1/2"
    payload["components"][0]["ingredients"][0]["gram_equivalent"] = "750 g"
    payload["components"][0]["ingredients"].append(
        {"ingredient_id": "i2", "name": "Salt", "amount": "to taste", "unit": None}
    )
    fake_client = FakeAnthropicClient(
        [FakeMessage([FakeContentBlock("tool_use", name="customize_recipe", input=payload)])]
    )
    monkeypatch.setattr(llm_agent, "_client", lambda: fake_client)

    result = llm_agent.customize_recipe(_current_recipe_payload(), "adjust seasoning")

    ingredients = result["components"][0]["ingredients"]
    assert ingredients[0]["amount"] == 1.5
    assert ingredients[0]["gram_equivalent"] == 750
    assert "amount" not in ingredients[1]
    assert ingredients[1]["unit"] == ""


def test_customize_recipe_preserves_steps_when_model_omits_unchanged_steps(monkeypatch):
    payload = _valid_customization_payload()
    payload.pop("steps")
    fake_client = FakeAnthropicClient(
        [FakeMessage([FakeContentBlock("tool_use", name="customize_recipe", input=payload)])]
    )
    monkeypatch.setattr(llm_agent, "_client", lambda: fake_client)

    current = _current_recipe_payload()
    result = llm_agent.customize_recipe(current, "use turkey instead")

    assert result["components"] == payload["components"]
    assert result["steps"] == current["steps"]


def test_customize_recipe_retries_then_returns_friendly_error(monkeypatch):
    fake_client = FakeAnthropicClient(
        [
            FakeMessage([FakeContentBlock("text", text="")]),
            FakeMessage([FakeContentBlock("text", text="not json")]),
        ]
    )
    monkeypatch.setattr(llm_agent, "_client", lambda: fake_client)
    monkeypatch.setattr(llm_agent, "CUSTOMIZE_MAX_ATTEMPTS", 2)

    try:
        llm_agent.customize_recipe(_current_recipe_payload(), "make it spicier")
    except LLMInvalidResponseError as exc:
        assert "could not produce a valid recipe edit" in str(exc)
    else:
        raise AssertionError("Expected invalid LLM response error")

    assert len(fake_client.messages.calls) == 2


def test_customize_recipe_wraps_provider_exceptions(monkeypatch):
    monkeypatch.setattr(llm_agent, "_client", lambda: FailingAnthropicClient())
    monkeypatch.setattr(llm_agent, "CUSTOMIZE_TIMEOUT_SECONDS", 20)

    try:
        llm_agent.customize_recipe(_current_recipe_payload(), "make it spicier")
    except LLMInvalidResponseError as exc:
        assert str(exc) == "The assistant service could not complete that recipe edit. Try again in a moment."
    else:
        raise AssertionError("Expected invalid LLM response error")


def test_chat_endpoint_hides_raw_llm_parse_errors(monkeypatch):
    monkeypatch.setattr(recipes_router, "is_configured", lambda: True)

    def fail_customization(*args, **kwargs):
        raise LLMInvalidResponseError("The assistant could not produce a valid recipe edit.")

    monkeypatch.setattr(recipes_router, "customize_recipe", fail_customization)

    r = client.post(
        "/api/recipes/bonde/chat",
        json={"message": "can this be made with other protein?"},
        headers=ADMIN_HEADERS,
    )

    assert r.status_code == 502
    assert r.json()["detail"] == "The assistant could not produce a valid recipe edit."
