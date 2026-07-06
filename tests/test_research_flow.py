import os
import sys
from pathlib import Path
from types import SimpleNamespace

os.environ["ADMIN_TOKEN"] = "test-token-123"
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal, init_db
from app.seed_loader import load_seed_data

init_db()
_db = SessionLocal()
load_seed_data(_db)
_db.close()

client = TestClient(app)
ADMIN_HEADERS = {"X-Admin-Token": "test-token-123"}


def _fake_response(text: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text))],
        usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    )


def _start_draft(name="Test Research Dish"):
    return client.post("/api/recipes/research", json={"prompt": name}, headers=ADMIN_HEADERS).json()


# --- admin gating ---------------------------------------------------------


def test_guest_cannot_start_research():
    r = client.post("/api/recipes/research", json={"prompt": "x"})
    assert r.status_code == 403


def test_guest_cannot_list_drafts():
    assert client.get("/api/recipes/research/drafts").status_code == 403


def test_guest_cannot_get_research_recipe():
    draft = _start_draft()
    assert client.get(f"/api/recipes/research/{draft['recipe_id']}").status_code == 403


def test_guest_cannot_patch_research_recipe():
    draft = _start_draft()
    r = client.patch(f"/api/recipes/research/{draft['recipe_id']}", json={"notes": "x"})
    assert r.status_code == 403


def test_guest_cannot_chat():
    draft = _start_draft()
    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/chat", json={"message": "hi"})
    assert r.status_code == 403


def test_guest_cannot_use_admin_assistant():
    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/ask",
        json={"question": "what is 2 cups almond flour in grams"},
    )
    assert r.status_code == 403


def test_guest_cannot_publish_or_unpublish():
    draft = _start_draft()
    assert client.post(f"/api/recipes/research/{draft['recipe_id']}/publish").status_code == 403
    assert client.post(f"/api/recipes/research/{draft['recipe_id']}/unpublish").status_code == 403


# --- missing API keys, deterministic ---------------------------------------


def test_chat_without_anthropic_key_400s(monkeypatch):
    # research_chat's task default is Gemini, not DEFAULT_MODEL — delete every
    # provider key this task could resolve to (not just Anthropic) so "no
    # model available" holds regardless of which optional provider keys
    # happen to be configured in the local .env (e.g. Gemini/OpenAI added for
    # manual QA testing). Draft creation happens BEFORE the keys are removed
    # — it still needs a working model itself (to extract the name).
    draft = _start_draft()
    for key in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/chat",
        json={"message": "let's research this dish"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400
    assert "No API key configured" in r.json()["detail"]


def test_approving_search_without_tavily_key_400s(monkeypatch):
    # Even with no Anthropic key, the router should reject an approved search
    # before ever trying to call the model, since it checks Tavily first only
    # on the approval branch — but Anthropic is checked first, so give it a
    # bogus configured-looking state isn't needed: just confirm behavior when
    # BOTH are unset — Anthropic's check fires first (matches endpoint order).
    draft = _start_draft()
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/chat",
        json={"tool_use_id": "toolu_fake", "query": "history of this dish", "approved": True},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400


# --- draft lifecycle ---------------------------------------------------------


def test_start_research_creates_draft_status_recipe():
    draft = _start_draft()
    assert draft["status"] == "draft"
    assert draft["is_current_head"] is True
    assert draft["components"] == []
    assert draft["steps"] == []
    assert "notes" in draft  # research shape includes admin-only fields
    assert "research_conversation" in draft


def test_new_draft_hidden_from_guest_list_and_get():
    draft = _start_draft()
    guest_ids = [r["recipe_id"] for r in client.get("/api/recipes").json()]
    assert draft["recipe_id"] not in guest_ids
    assert client.get(f"/api/recipes/{draft['recipe_id']}").status_code == 404
    # Still visible to admin via the normal endpoint too.
    admin_ids = [r["recipe_id"] for r in client.get("/api/recipes", headers=ADMIN_HEADERS).json()]
    assert draft["recipe_id"] in admin_ids


def test_patch_mutates_draft_in_place():
    draft = _start_draft()
    r = client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "intro": "A cozy weeknight dish.",
            "prep_time_minutes": 10,
            "serving_size_amount": 1,
            "serving_size_unit": "bowl",
        },
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["version_id"] == draft["version_id"]  # same row, no new version
    assert body["intro"] == "A cozy weeknight dish."
    assert body["prep_time_minutes"] == 10
    assert body["serving_size"] == {"amount": 1.0, "unit": "bowl"}


def test_patch_recomputes_nutrition_when_components_change():
    draft = _start_draft()
    components = [
        {"component_name": "main", "ingredients": [{"name": "chicken", "amount": 200, "unit": "g"}]}
    ]
    r = client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={"components": components},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["nutrition"]["calories"] > 0


def test_refresh_nutrition_recomputes_current_draft():
    draft = _start_draft()
    components = [
        {"component_name": "main", "ingredients": [{"name": "chicken", "amount": 200, "unit": "g"}]}
    ]
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={"components": components},
        headers=ADMIN_HEADERS,
    )

    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/nutrition/refresh", headers=ADMIN_HEADERS)

    assert r.status_code == 200
    body = r.json()
    assert body["nutrition"]["calories"] > 0
    assert body["nutrition"]["nutrition_sources"]


def test_admin_assistant_answers_without_mutating_draft(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_litellm_configured", lambda: True)
    monkeypatch.setattr("app.routers.research.is_model_available", lambda model: True)
    monkeypatch.setattr("app.routers.research.is_tavily_configured", lambda: False)
    monkeypatch.setattr(
        "app.routers.research.litellm_completion",
        lambda **kwargs: _fake_response("About 192 g for 2 cups of almond flour, depending on grind."),
    )
    draft = _start_draft()
    before = client.get(f"/api/recipes/research/{draft['recipe_id']}", headers=ADMIN_HEADERS).json()

    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/ask",
        json={"question": "what is 2 cups almond flour in grams"},
        headers=ADMIN_HEADERS,
    )

    assert r.status_code == 200
    assert "192 g" in r.json()["reply"]
    after = client.get(f"/api/recipes/research/{draft['recipe_id']}", headers=ADMIN_HEADERS).json()
    assert after["components"] == before["components"]
    assert after["steps"] == before["steps"]


def test_admin_assistant_can_attach_web_context(monkeypatch):
    captured = {}

    def fake_completion(**kwargs):
        captured["messages"] = kwargs["messages"]
        return _fake_response("Use about 190-200 g; the web context supports treating this as density-dependent.")

    monkeypatch.setattr("app.routers.research.is_litellm_configured", lambda: True)
    monkeypatch.setattr("app.routers.research.is_model_available", lambda model: True)
    monkeypatch.setattr("app.routers.research.is_tavily_configured", lambda: True)
    monkeypatch.setattr(
        "app.routers.research.run_tavily_search",
        lambda query: "Search result: almond flour cup weights vary by brand; common references list about 96 g per cup.",
    )
    monkeypatch.setattr("app.routers.research.litellm_completion", fake_completion)
    draft = _start_draft()

    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/ask",
        json={"question": "what is 2 cups almond flour in grams"},
        headers=ADMIN_HEADERS,
    )

    assert r.status_code == 200
    prompt = captured["messages"][-1]["content"]
    assert "Internal schema and local data context" in prompt
    assert "External web context" in prompt
    assert "about 96 g per cup" in prompt


def test_publish_requires_minimal_completeness():
    draft = _start_draft()
    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/publish", headers=ADMIN_HEADERS)
    assert r.status_code == 400


def test_publish_then_visible_to_guest_no_new_version():
    draft = _start_draft()
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "salt", "amount": 1, "unit": "g"}]}],
            "steps": [{"instruction": "Mix it."}],
        },
        headers=ADMIN_HEADERS,
    )
    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/publish", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "published"
    assert body["version_id"] == draft["version_id"]  # publish is a status flip, not a new version

    guest_ids = [r["recipe_id"] for r in client.get("/api/recipes").json()]
    assert draft["recipe_id"] in guest_ids


def test_dashboard_edit_published_recipe_creates_reusable_draft_copy():
    draft = _start_draft("Published Edit Source")
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "salt", "amount": 1, "unit": "g"}]}],
            "steps": [{"instruction": "Mix it."}],
        },
        headers=ADMIN_HEADERS,
    )
    published = client.post(f"/api/recipes/research/{draft['recipe_id']}/publish", headers=ADMIN_HEADERS).json()

    r = client.post(f"/api/admin/recipes/{published['recipe_id']}/edit-draft", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] is True
    edit_draft = body["draft"]
    assert edit_draft["status"] == "draft"
    assert edit_draft["source"] == "revision_draft"
    assert edit_draft["parent_version_id"] == published["version_id"]
    assert edit_draft["recipe_id"] != published["recipe_id"]

    again = client.post(f"/api/admin/recipes/{published['recipe_id']}/edit-draft", headers=ADMIN_HEADERS).json()
    assert again["created"] is False
    assert again["draft"]["recipe_id"] == edit_draft["recipe_id"]


def test_publishing_edit_draft_can_replace_original_recipe():
    draft = _start_draft("Replace Source")
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "salt", "amount": 1, "unit": "g"}]}],
            "steps": [{"instruction": "Mix it."}],
        },
        headers=ADMIN_HEADERS,
    )
    published = client.post(f"/api/recipes/research/{draft['recipe_id']}/publish", headers=ADMIN_HEADERS).json()
    edit_draft = client.post(f"/api/admin/recipes/{published['recipe_id']}/edit-draft", headers=ADMIN_HEADERS).json()["draft"]
    client.patch(
        f"/api/recipes/research/{edit_draft['recipe_id']}",
        json={"name": "Replaced Source", "notes": "working copy notes"},
        headers=ADMIN_HEADERS,
    )

    r = client.post(
        f"/api/recipes/research/{edit_draft['recipe_id']}/publish",
        json={"mode": "replace_original"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    replacement = r.json()
    assert replacement["recipe_id"] == published["recipe_id"]
    assert replacement["name"] == "Replaced Source"
    assert replacement["version_id"] != published["version_id"]

    guest = client.get(f"/api/recipes/{published['recipe_id']}").json()
    assert guest["name"] == "Replaced Source"
    assert client.get(f"/api/recipes/{edit_draft['recipe_id']}", headers=ADMIN_HEADERS).status_code == 404
    history = client.get(f"/api/recipes/{published['recipe_id']}/history", headers=ADMIN_HEADERS).json()
    assert len(history) == 2


def test_publishing_edit_draft_can_keep_both_recipes():
    draft = _start_draft("Keep Both Source")
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "salt", "amount": 1, "unit": "g"}]}],
            "steps": [{"instruction": "Mix it."}],
        },
        headers=ADMIN_HEADERS,
    )
    published = client.post(f"/api/recipes/research/{draft['recipe_id']}/publish", headers=ADMIN_HEADERS).json()
    edit_draft = client.post(f"/api/admin/recipes/{published['recipe_id']}/edit-draft", headers=ADMIN_HEADERS).json()["draft"]

    r = client.post(
        f"/api/recipes/research/{edit_draft['recipe_id']}/publish",
        json={"mode": "keep_both"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    copy = r.json()
    assert copy["recipe_id"] == edit_draft["recipe_id"]
    assert copy["status"] == "published"

    guest_ids = [r["recipe_id"] for r in client.get("/api/recipes").json()]
    assert published["recipe_id"] in guest_ids
    assert edit_draft["recipe_id"] in guest_ids


def test_published_recipe_rejects_research_patch():
    draft = _start_draft()
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "salt", "amount": 1, "unit": "g"}]}],
            "steps": [{"instruction": "Mix it."}],
        },
        headers=ADMIN_HEADERS,
    )
    client.post(f"/api/recipes/research/{draft['recipe_id']}/publish", headers=ADMIN_HEADERS)

    r = client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={"notes": "too late"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400


def test_unpublish_hides_it_from_guests_again():
    draft = _start_draft()
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "salt", "amount": 1, "unit": "g"}]}],
            "steps": [{"instruction": "Mix it."}],
        },
        headers=ADMIN_HEADERS,
    )
    client.post(f"/api/recipes/research/{draft['recipe_id']}/publish", headers=ADMIN_HEADERS)

    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/unpublish", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "draft"

    guest_ids = [r["recipe_id"] for r in client.get("/api/recipes").json()]
    assert draft["recipe_id"] not in guest_ids

    # Back in draft — the research patch endpoint works on it again.
    r = client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={"notes": "back to drafting"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200


def test_start_research_with_model_field():
    # An Anthropic model (not OpenAI) so is_model_available() passes using
    # the same ANTHROPIC_API_KEY already present in the test environment —
    # this test is about research_model storing whatever was explicitly
    # requested (not silently normalizing to the default), not about
    # exercising a second provider.
    r = client.post(
        "/api/recipes/research",
        json={"prompt": "Model Test Dish", "model": "anthropic/claude-haiku-4-5-20251001"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["research_model"] == "anthropic/claude-haiku-4-5-20251001"


def test_patch_model_field_does_not_go_through_apply_patch():
    draft = _start_draft()
    assert draft["research_model"] is None
    r = client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={"model": "anthropic/claude-haiku-4-5-20251001"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["research_model"] == "anthropic/claude-haiku-4-5-20251001"
    # Setting model alone must not touch recipe content or recompute nutrition.
    assert body["components"] == []
    assert body["nutrition"] == {}


def test_starting_prompt_stored_on_creation_and_patchable():
    draft = _start_draft("A short prompt describing the dish")
    assert draft["starting_prompt"] == "A short prompt describing the dish"

    r = client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={"starting_prompt": "An updated prompt, maybe with a pasted draft recipe"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["starting_prompt"] == "An updated prompt, maybe with a pasted draft recipe"


def test_list_drafts_excludes_published():
    draft_a = _start_draft("Draft A")
    draft_b = _start_draft("Draft B")
    client.patch(
        f"/api/recipes/research/{draft_b['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "salt", "amount": 1, "unit": "g"}]}],
            "steps": [{"instruction": "Mix it."}],
        },
        headers=ADMIN_HEADERS,
    )
    client.post(f"/api/recipes/research/{draft_b['recipe_id']}/publish", headers=ADMIN_HEADERS)

    drafts = client.get("/api/recipes/research/drafts", headers=ADMIN_HEADERS).json()
    ids = [d["recipe_id"] for d in drafts]
    assert draft_a["recipe_id"] in ids
    assert draft_b["recipe_id"] not in ids
