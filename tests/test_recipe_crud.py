import os
import sys
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

NEW_RECIPE = {
    "name": "Test Manual Curry",
    "category": "main",
    "cuisine_tags": ["test"],
    "base_servings_amount": 2,
    "base_servings_unit": "servings",
    "serving_size_amount": 1,
    "serving_size_unit": "bowl",
    "components": [
        {
            "component_name": "main",
            "ingredients": [{"name": "chicken", "amount": 200, "unit": "g"}],
        }
    ],
    "steps": [{"instruction": "Cook it."}],
}


def test_guest_cannot_create_recipe():
    r = client.post("/api/recipes", json=NEW_RECIPE)
    assert r.status_code == 403


def test_admin_can_create_recipe():
    r = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Test Manual Curry"
    assert body["lineage"] == "manual"
    assert body["is_current_head"] is True
    assert body["serving_size"] == {"amount": 1.0, "unit": "bowl"}
    assert body["nutrition"]["calories"] > 0


def test_created_recipe_appears_in_list():
    # Manual creation now starts as a draft (same "everything starts as a
    # draft" rule as fork/research) — visible to admin, hidden from guests
    # until explicitly published.
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    assert created["status"] == "draft"
    admin_ids = [r["recipe_id"] for r in client.get("/api/recipes", headers=ADMIN_HEADERS).json()]
    assert created["recipe_id"] in admin_ids
    guest_ids = [r["recipe_id"] for r in client.get("/api/recipes").json()]
    assert created["recipe_id"] not in guest_ids


def test_guest_cannot_update_recipe():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    r = client.put(f"/api/recipes/{created['recipe_id']}", json=NEW_RECIPE)
    assert r.status_code == 403


def test_admin_manual_update_is_removed():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    updated_payload = {**NEW_RECIPE, "name": "Test Manual Curry (updated)"}
    r = client.put(f"/api/recipes/{created['recipe_id']}", json=updated_payload, headers=ADMIN_HEADERS)
    assert r.status_code == 410
    assert "agentic editor" in r.json()["detail"]

    history = client.get(f"/api/recipes/{created['recipe_id']}/history", headers=ADMIN_HEADERS).json()
    assert len(history) == 1


def test_research_patch_is_the_supported_direct_edit_path():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    rich_patch = {
        "name": "Test Manual Curry (renamed)",
        "intro": "A rich intro",
        "history": "A long history",
        "prep_time_minutes": 12,
        "cook_time_minutes": 34,
        "serving_size_amount": 250,
        "serving_size_unit": "g",
        "tips": ["toast spices"],
        "watch_outs": ["do not scorch"],
        "steps": [{"instruction": "Cook it.", "image_url": "/uploads/step.jpg"}],
    }
    r = client.patch(
        f"/api/recipes/research/{created['recipe_id']}",
        json=rich_patch,
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == rich_patch["name"]
    assert body["intro"] == rich_patch["intro"]
    assert body["history"] == rich_patch["history"]
    assert body["prep_time_minutes"] == rich_patch["prep_time_minutes"]
    assert body["cook_time_minutes"] == rich_patch["cook_time_minutes"]
    assert body["serving_size"] == {"amount": 250.0, "unit": "g"}
    assert body["tips"] == rich_patch["tips"]
    assert body["watch_outs"] == rich_patch["watch_outs"]
    assert body["steps"][0]["image_url"] == "/uploads/step.jpg"


def test_update_nonexistent_recipe_404s():
    r = client.put("/api/recipes/does-not-exist", json=NEW_RECIPE, headers=ADMIN_HEADERS)
    assert r.status_code == 404


def test_guest_cannot_delete_recipe():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    r = client.delete(f"/api/recipes/{created['recipe_id']}")
    assert r.status_code == 403


def test_admin_can_delete_recipe():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    r = client.delete(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS)
    assert r.status_code == 200

    assert client.get(f"/api/recipes/{created['recipe_id']}").status_code == 404
    recipe_ids = [r["recipe_id"] for r in client.get("/api/recipes").json()]
    assert created["recipe_id"] not in recipe_ids


def test_delete_nonexistent_recipe_404s():
    r = client.delete("/api/recipes/does-not-exist", headers=ADMIN_HEADERS)
    assert r.status_code == 404


def test_delete_is_soft_and_preserves_history():
    # Delete is now a soft delete: hidden everywhere, but the row (and full
    # version history) stays intact in the DB — recoverable via Trash.
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    r = client.delete(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS)
    assert r.status_code == 200

    assert client.get(f"/api/recipes/{created['recipe_id']}").status_code == 404
    assert client.get(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS).status_code == 404
    admin_ids = [r["recipe_id"] for r in client.get("/api/recipes", headers=ADMIN_HEADERS).json()]
    assert created["recipe_id"] not in admin_ids

    history = client.get(f"/api/recipes/{created['recipe_id']}/history", headers=ADMIN_HEADERS).json()
    assert len(history) == 1  # untouched — soft delete never wipes history


def test_delete_requires_draft_status():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    # Publish it via the research router's generic publish endpoint (works
    # on any recipe_id, not just research-created ones).
    client.post(f"/api/recipes/research/{created['recipe_id']}/publish", headers=ADMIN_HEADERS)
    r = client.delete(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS)
    assert r.status_code == 400
    assert "Unpublish" in r.json()["detail"]
