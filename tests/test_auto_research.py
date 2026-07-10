"""
Auto-research (CrewAI) endpoint tests. Follows the same style as
test_research_flow.py: real DB via TestClient, deterministic monkeypatch for
missing-config paths, and — critically — the actual crew/LLM calls are always
monkeypatched at the app.crew_research module boundary. Never invoke real
litellm.completion or crewai.Crew.kickoff here; that would make tests slow,
flaky, and dependent on live API keys/network.

/auto/run kicks off a background thread and returns immediately with
auto_research_status="running" (see routers/research.py) — tests that mock
the crew must poll GET /{recipe_id} until the background thread finishes
before asserting on the applied patch, both to observe the real result and
because pytest's monkeypatch fixture reverts at test teardown: if the thread
were still running after that, it would call the *real* (unmocked) function.
"""
import os
import sys
import time
from pathlib import Path

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


def _start_draft(name="Auto Research Test Dish"):
    return client.post("/api/recipes/research", json={"prompt": name}, headers=ADMIN_HEADERS).json()


def _wait_until_finished(recipe_id, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/recipes/research/{recipe_id}", headers=ADMIN_HEADERS).json()
        if body["auto_research_status"] != "running":
            return body
        time.sleep(0.02)
    raise AssertionError("background auto-research job never finished within timeout")


def _skip_auto_plan(monkeypatch):
    monkeypatch.setattr("app.routers.research.propose_search_batch", lambda dish_name, starting_prompt, model: {"queries": []})


# --- admin gating ------------------------------------------------------------


def test_guest_cannot_plan_auto_research():
    draft = _start_draft()
    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/auto/plan")
    assert r.status_code == 403


def test_guest_cannot_run_auto_research():
    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run", json={"approved_queries": []}
    )
    assert r.status_code == 403


def test_guest_cannot_cancel_auto_research():
    draft = _start_draft()
    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/auto/cancel")
    assert r.status_code == 403


def test_guest_cannot_refine_section():
    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/refine",
        json={"section": "history", "instruction": "shorter"},
    )
    assert r.status_code == 403


# --- missing config, deterministic -------------------------------------------


def test_start_research_without_model_key_400s(monkeypatch):
    _delenv_all_provider_keys(monkeypatch)
    r = client.post("/api/recipes/research", json={"prompt": "Some Dish"}, headers=ADMIN_HEADERS)
    assert r.status_code == 400
    assert "No API key configured" in r.json()["detail"]


def test_plan_without_litellm_installed_400s(monkeypatch):
    monkeypatch.setattr("app.llm_client.litellm", None)
    draft = _start_draft()
    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/auto/plan", headers=ADMIN_HEADERS)
    assert r.status_code == 400


def _delenv_all_provider_keys(monkeypatch):
    # Delete every provider key this task could possibly resolve to — not
    # just Anthropic — so the test's "no model available" precondition holds
    # regardless of which optional provider keys happen to be configured in
    # the local .env (e.g. Gemini/OpenAI added for manual QA testing).
    for key in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY"):
        monkeypatch.delenv(key, raising=False)


def test_plan_without_model_key_400s(monkeypatch):
    draft = _start_draft()
    _delenv_all_provider_keys(monkeypatch)
    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/auto/plan", headers=ADMIN_HEADERS)
    assert r.status_code == 400
    assert "No API key configured" in r.json()["detail"]


def test_run_without_web_search_key_400s(monkeypatch):
    draft = _start_draft()
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: False)
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": ["some query"]},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400


def test_run_without_model_key_400s(monkeypatch):
    draft = _start_draft()
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    _delenv_all_provider_keys(monkeypatch)
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400


def test_refine_without_model_key_400s(monkeypatch):
    draft = _start_draft()
    _delenv_all_provider_keys(monkeypatch)
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/refine",
        json={"section": "history", "instruction": "shorter"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400


# --- wiring, with the crew/LLM calls mocked out ------------------------------


def test_plan_returns_mocked_plan_and_query_batch(monkeypatch):
    def fake_propose_search_batch(dish_name, starting_prompt, model):
        return {
            "plan": f"I will research {dish_name}.",
            "queries": [{"query": f"history of {dish_name}", "category": "history"}],
        }

    monkeypatch.setattr("app.routers.research.propose_search_batch", fake_propose_search_batch)
    draft = _start_draft("Butter Chicken")
    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/auto/plan", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "I will research Butter Chicken."
    assert body["queries"][0]["query"] == "history of Butter Chicken"


def test_run_applies_merged_patch_from_mocked_crew(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    monkeypatch.setattr(
        "app.routers.research.run_web_search",
        lambda query: f"mocked results for {query}",
    )

    def fake_run_auto_research_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        assert search_results[0]["query"] == "test query"
        assert "mocked results" in search_results[0]["result"]
        if on_task_done:
            for section in ("history", "ingredients", "steps", "tips", "merge"):
                on_task_done(section)
        return {"intro": "A mocked intro.", "tips": ["mocked tip"]}

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", fake_run_auto_research_crew)

    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": ["test query"]},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["auto_research_status"] == "running"  # returns immediately

    body = _wait_until_finished(draft["recipe_id"])
    assert body["auto_research_status"] is None
    assert body["intro"] == "A mocked intro."
    assert body["tips"] == ["mocked tip"]
    assert body["status"] == "draft"  # auto/run never publishes on its own
    assert set(body["auto_research_progress"]) == {"history", "ingredients", "steps", "tips", "merge"}

    jobs = client.get(f"/api/recipes/research/{draft['recipe_id']}/jobs", headers=ADMIN_HEADERS).json()
    assert jobs[0]["status"] == "completed"
    assert jobs[0]["approved_queries"] == ["test query"]
    assert jobs[0]["search_results"][0]["query"] == "test query"
    assert set(jobs[0]["progress"]) == {"history", "ingredients", "steps", "tips", "merge"}


def test_usage_logging_failure_does_not_poison_completed_run(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    monkeypatch.setattr("app.routers.research.run_web_search", lambda query: f"mocked results for {query}")

    def fake_run_auto_research_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        if on_task_done:
            on_task_done("merge")
        return {"intro": "Finished before telemetry failed."}

    def failing_usage_log(**kwargs):
        if kwargs["task"] == "auto_research_crew":
            raise RuntimeError("usage db is locked")

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", fake_run_auto_research_crew)
    monkeypatch.setattr("app.routers.research.record_llm_usage", failing_usage_log)

    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": ["test query"]},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200

    body = _wait_until_finished(draft["recipe_id"])
    assert body["auto_research_status"] is None
    assert body["auto_research_error"] is None
    assert body["intro"] == "Finished before telemetry failed."

    jobs = client.get(f"/api/recipes/research/{draft['recipe_id']}/jobs", headers=ADMIN_HEADERS).json()
    assert jobs[0]["status"] == "completed"


def test_run_with_no_approved_queries_still_runs_crew(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    _skip_auto_plan(monkeypatch)

    def fake_run_auto_research_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        assert search_results == []
        return {"intro": "No searches needed."}

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", fake_run_auto_research_crew)

    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200

    body = _wait_until_finished(draft["recipe_id"])
    assert body["intro"] == "No searches needed."
    assert "No web searches were needed" in " ".join(body["auto_research_activity"])


def test_run_without_approved_queries_plans_and_searches_in_background(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    monkeypatch.setattr(
        "app.routers.research.propose_search_batch",
        lambda dish_name, starting_prompt, model: {"queries": [{"query": "best chocolate cake technique"}]},
    )
    monkeypatch.setattr("app.routers.research.run_web_search", lambda query: f"mocked results for {query}")

    def fake_run_auto_research_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        assert search_results[0]["query"] == "best chocolate cake technique"
        return {"intro": "Auto-planned and done."}

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", fake_run_auto_research_crew)

    draft = _start_draft("Chocolate Cake")
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200

    body = _wait_until_finished(draft["recipe_id"])
    assert body["intro"] == "Auto-planned and done."
    assert "Planning focused web searches." in body["auto_research_activity"]
    assert any("Searching 1/1" in item for item in body["auto_research_activity"])

    jobs = client.get(f"/api/recipes/research/{draft['recipe_id']}/jobs", headers=ADMIN_HEADERS).json()
    assert jobs[0]["approved_queries"] == ["best chocolate cake technique"]


def test_run_passes_starting_prompt_through_to_crew(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    _skip_auto_plan(monkeypatch)
    seen = {}

    def fake_run_auto_research_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        seen["starting_prompt"] = starting_prompt
        return {"intro": "done"}

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", fake_run_auto_research_crew)

    draft = client.post(
        "/api/recipes/research",
        json={"prompt": "A draft: 2 eggs, 1 cup flour. Mix and bake."},
        headers=ADMIN_HEADERS,
    ).json()
    client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )
    _wait_until_finished(draft["recipe_id"])
    assert seen["starting_prompt"] == "A draft: 2 eggs, 1 cup flour. Mix and bake."


def test_run_surfaces_crew_error_via_status_poll(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    _skip_auto_plan(monkeypatch)

    def failing_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        raise RuntimeError("the crew blew up")

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", failing_crew)

    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200

    body = _wait_until_finished(draft["recipe_id"])
    assert body["auto_research_status"] == "error"
    assert "the crew blew up" in body["auto_research_error"]
    assert any("Auto-research failed" in item for item in body["auto_research_activity"])


def test_cannot_start_a_second_run_while_one_is_in_progress(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    _skip_auto_plan(monkeypatch)

    def slow_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        time.sleep(0.3)
        return {"intro": "done"}

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", slow_crew)

    draft = _start_draft()
    first = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )
    assert second.status_code == 409

    _wait_until_finished(draft["recipe_id"])  # let it finish before monkeypatch teardown


def test_cannot_publish_while_auto_research_is_running(monkeypatch):
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    _skip_auto_plan(monkeypatch)

    def slow_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        time.sleep(0.3)
        return {"intro": "done"}

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", slow_crew)

    draft = _start_draft()
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "salt", "amount": 1, "unit": "g"}]}],
            "steps": [{"instruction": "Mix it."}],
        },
        headers=ADMIN_HEADERS,
    )
    client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )

    r = client.post(f"/api/recipes/research/{draft['recipe_id']}/publish", headers=ADMIN_HEADERS)
    assert r.status_code == 409

    _wait_until_finished(draft["recipe_id"])


def test_cancel_unblocks_immediately_and_discards_stale_result(monkeypatch):
    """The core soft-cancel/fencing guarantee: cancelling clears status right
    away (a second run can start immediately without a 409), and when the
    first (cancelled) job eventually finishes — deliberately made to finish
    *after* the second job, the harder case — its result must NOT overwrite
    the second job's already-applied one, because its job id no longer
    matches the row's current job id."""
    monkeypatch.setattr("app.routers.research.is_web_search_configured", lambda: True)
    _skip_auto_plan(monkeypatch)

    def slow_stale_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        time.sleep(0.4)  # finishes after the second (fast) job below
        return {"intro": "STALE — must never be applied"}

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", slow_stale_crew)

    draft = _start_draft()
    client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )

    cancel = client.post(f"/api/recipes/research/{draft['recipe_id']}/auto/cancel", headers=ADMIN_HEADERS)
    assert cancel.status_code == 200
    assert cancel.json()["auto_research_status"] is None
    jobs = client.get(f"/api/recipes/research/{draft['recipe_id']}/jobs", headers=ADMIN_HEADERS).json()
    assert jobs[0]["status"] == "cancelled"

    def fast_fresh_crew(dish_name, current_document, search_results, starting_prompt, model, on_task_done=None):
        return {"intro": "fresh result"}

    monkeypatch.setattr("app.routers.research.run_auto_research_crew", fast_fresh_crew)

    # Unblocked immediately — a new run can start right away, no 409.
    again = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/auto/run",
        json={"approved_queries": []},
        headers=ADMIN_HEADERS,
    )
    assert again.status_code == 200
    _wait_until_finished(draft["recipe_id"])

    # Give the slower, cancelled first job time to finish too (its own
    # fencing check must reject applying now that the row's job id has moved on).
    time.sleep(0.3)
    body = client.get(f"/api/recipes/research/{draft['recipe_id']}", headers=ADMIN_HEADERS).json()
    assert body["intro"] == "fresh result"


# --- refine ------------------------------------------------------------------


def test_refine_applies_mocked_section_patch(monkeypatch):
    def fake_refine_section(section, current_document, instruction, model):
        assert section == "tips"
        assert instruction == "make it shorter"
        return {"tips": ["one short tip"]}

    monkeypatch.setattr("app.routers.research.refine_section", fake_refine_section)

    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/refine",
        json={"section": "tips", "instruction": "make it shorter"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["tips"] == ["one short tip"]


def test_refine_unknown_section_400s(monkeypatch):
    def fake_refine_section(section, current_document, instruction, model):
        raise ValueError(f"Unknown section '{section}'")

    monkeypatch.setattr("app.routers.research.refine_section", fake_refine_section)

    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/refine",
        json={"section": "nonsense", "instruction": "do something"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400
