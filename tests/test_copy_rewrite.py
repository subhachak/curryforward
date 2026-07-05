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


def _start_draft(name="Rewrite Test Dish"):
    return client.post("/api/recipes/research", json={"prompt": name}, headers=ADMIN_HEADERS).json()


def test_guest_cannot_use_admin_rewrite():
    r = client.post("/api/admin/rewrite", json={"field_label": "intro", "text": "rough"})
    assert r.status_code == 403


def test_guest_cannot_use_recipe_rewrite():
    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/rewrite",
        json={"field_label": "intro", "text": "rough"},
    )
    assert r.status_code == 403


def test_admin_rewrite_returns_candidate_without_mutation(monkeypatch):
    monkeypatch.setattr("app.routers.admin.litellm_completion", lambda **kwargs: _fake_response("A polished prompt."))
    r = client.post(
        "/api/admin/rewrite",
        json={"field_label": "new recipe prompt", "text": "kolkata chicken thing", "instruction": "make it clear"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    assert r.json() == {"text": "A polished prompt."}


def test_recipe_rewrite_returns_candidate_without_mutating_draft(monkeypatch):
    monkeypatch.setattr("app.routers.research.litellm_completion", lambda **kwargs: _fake_response("A polished intro."))
    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/rewrite",
        json={"field_label": "intro", "text": "nice curry", "instruction": "warmer"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    assert r.json() == {"text": "A polished intro."}

    unchanged = client.get(f"/api/recipes/research/{draft['recipe_id']}", headers=ADMIN_HEADERS).json()
    assert unchanged["intro"] is None
