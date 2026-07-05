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


def _fake_response(content: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    )


def _start_draft(name="Wide Edit Test Dish"):
    return client.post("/api/recipes/research", json={"prompt": name}, headers=ADMIN_HEADERS).json()


def test_guest_cannot_wide_edit_recipe():
    draft = _start_draft()
    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/wide-edit",
        json={"instruction": "make it keto"},
    )
    assert r.status_code == 403


def test_wide_edit_applies_patch_and_returns_changed_fields(monkeypatch):
    draft = _start_draft()
    client.patch(
        f"/api/recipes/research/{draft['recipe_id']}",
        json={
            "components": [{"component_name": "main", "ingredients": [{"name": "sugar", "amount": 50, "unit": "g"}]}],
            "steps": [{"instruction": "Mix in the sugar."}],
        },
        headers=ADMIN_HEADERS,
    )
    monkeypatch.setattr(
        "app.routers.research.litellm_completion",
        lambda **kwargs: _fake_response(
            """
            {
              "recipe_patch": {
                "components": [{"component_name": "main", "ingredients": [{"name": "erythritol", "amount": 40, "unit": "g"}]}],
                "steps": [{"instruction": "Mix in the erythritol."}],
                "tips": ["Check sweetness before baking."]
              },
              "changed_fields": ["components", "steps", "tips"],
              "review_notes": "Swapped sugar for a lower-carb sweetener."
            }
            """
        ),
    )

    r = client.post(
        f"/api/recipes/research/{draft['recipe_id']}/wide-edit",
        json={"instruction": "make this keto friendly"},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["changed_fields"] == ["components", "steps", "tips"]
    assert body["review_notes"] == "Swapped sugar for a lower-carb sweetener."
    assert body["recipe"]["components"][0]["ingredients"][0]["name"] == "erythritol"
    assert body["recipe"]["steps"][0]["instruction"] == "Mix in the erythritol."
    assert body["recipe"]["tips"] == ["Check sweetness before baking."]
