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


def test_admin_can_reset_existing_recipe_ingredients_to_grams():
    payload = {
        **NEW_RECIPE,
        "components": [
            {
                "component_name": "main",
                "ingredients": [
                    {
                        "name": "unsalted butter",
                        "amount": 2,
                        "unit": "Cup",
                        "unit_options": [{"amount": 454, "unit": "Gram"}],
                    }
                ],
            }
        ],
    }
    created = client.post("/api/recipes", json=payload, headers=ADMIN_HEADERS).json()

    r = client.post(f"/api/recipes/{created['recipe_id']}/ingredients/reset-grams", headers=ADMIN_HEADERS)

    assert r.status_code == 200
    ingredient = r.json()["components"][0]["ingredients"][0]
    assert ingredient["amount"] == 454
    assert ingredient["gram_amount"] == 454
    assert ingredient["unit"] == "g"
    assert ingredient["unit_options"][0]["unit"] == "Cup"
    assert r.json()["nutrition"]["calories"] > 0


def test_non_weight_amount_without_grams_stays_incomplete():
    payload = {
        **NEW_RECIPE,
        "components": [
            {
                "component_name": "main",
                "ingredients": [{"name": "mushrooms", "amount": 2, "unit": "Cup"}],
            }
        ],
    }

    created = client.post("/api/recipes", json=payload, headers=ADMIN_HEADERS).json()
    ingredient = created["components"][0]["ingredients"][0]

    assert ingredient["amount"] is None
    assert ingredient["gram_amount"] is None
    assert ingredient["unit"] == "g"
    assert ingredient["unit_options"][0]["unit"] == "Cup"


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


def test_published_recipe_accepts_feedback_and_exposes_metadata(monkeypatch):
    monkeypatch.setattr(
        "app.routers.recipes._scan_feedback_with_ai",
        lambda recipe, author_name, rating, comment, db=None: {"approved": True, "reason": "looks fine"},
    )
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    client.patch(
        f"/api/recipes/research/{created['recipe_id']}",
        json={"components": NEW_RECIPE["components"], "steps": NEW_RECIPE["steps"]},
        headers=ADMIN_HEADERS,
    )
    client.post(f"/api/recipes/research/{created['recipe_id']}/publish", headers=ADMIN_HEADERS)

    detail = client.get(f"/api/recipes/{created['recipe_id']}").json()
    assert detail["metadata"]["first_published_at"]
    assert detail["metadata"]["version_count"] == 1
    assert detail["feedback_summary"]["rating_count"] == 0

    r = client.post(
        f"/api/recipes/{created['recipe_id']}/feedback",
        json={"author_name": "Tester", "rating": 5, "comment": "Loved this."},
    )
    assert r.status_code == 200
    assert r.json()["rating"] == 5

    feedback = client.get(f"/api/recipes/{created['recipe_id']}/feedback").json()
    assert feedback["average_rating"] == 5
    assert feedback["rating_count"] == 1
    assert feedback["items"][0]["comment"] == "Loved this."


def test_flagged_feedback_waits_for_admin_approval(monkeypatch):
    monkeypatch.setattr(
        "app.routers.recipes._scan_feedback_with_ai",
        lambda recipe, author_name, rating, comment, db=None: {"approved": False, "reason": "flagged in test"},
    )
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    client.patch(
        f"/api/recipes/research/{created['recipe_id']}",
        json={"components": NEW_RECIPE["components"], "steps": NEW_RECIPE["steps"]},
        headers=ADMIN_HEADERS,
    )
    client.post(f"/api/recipes/research/{created['recipe_id']}/publish", headers=ADMIN_HEADERS)

    submitted = client.post(
        f"/api/recipes/{created['recipe_id']}/feedback",
        json={"author_name": "Tester", "rating": 4, "comment": "Needs review."},
    )
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "pending_review"

    public_feedback = client.get(f"/api/recipes/{created['recipe_id']}/feedback").json()
    assert public_feedback["items"] == []

    pending = client.get("/api/admin/feedback/pending", headers=ADMIN_HEADERS).json()
    pending_item = next(item for item in pending if item["recipe_id"] == created["recipe_id"])
    assert pending_item["moderation_reason"] == "flagged in test"

    decided = client.post(
        f"/api/admin/feedback/{pending_item['feedback_id']}/decide",
        json={"approved": True},
        headers=ADMIN_HEADERS,
    )
    assert decided.status_code == 200
    assert decided.json()["status"] == "approved"

    public_feedback = client.get(f"/api/recipes/{created['recipe_id']}/feedback").json()
    assert public_feedback["items"][0]["comment"] == "Needs review."
