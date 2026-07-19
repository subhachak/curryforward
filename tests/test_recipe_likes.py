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
    "name": "Likeable Test Curry",
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


def _create_and_publish():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    r = client.post(f"/api/recipes/research/{created['recipe_id']}/publish", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    return created["recipe_id"]


def test_guest_can_like_and_unlike_published_recipe():
    recipe_id = _create_and_publish()
    r = client.post(f"/api/recipes/{recipe_id}/like")
    assert r.status_code == 200
    assert r.json()["like_count"] == 1

    r = client.post(f"/api/recipes/{recipe_id}/like")
    assert r.json()["like_count"] == 2

    r = client.delete(f"/api/recipes/{recipe_id}/like")
    assert r.json()["like_count"] == 1


def test_admin_like_and_unlike_do_not_change_engagement_count():
    recipe_id = _create_and_publish()
    client.post(f"/api/recipes/{recipe_id}/like")

    r = client.post(f"/api/recipes/{recipe_id}/like", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json()["like_count"] == 1

    r = client.delete(f"/api/recipes/{recipe_id}/like", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json()["like_count"] == 1


def test_like_count_cannot_go_negative():
    recipe_id = _create_and_publish()
    r = client.delete(f"/api/recipes/{recipe_id}/like")
    assert r.status_code == 200
    assert r.json()["like_count"] == 0

    r = client.delete(f"/api/recipes/{recipe_id}/like")
    assert r.json()["like_count"] == 0


def test_guest_cannot_like_draft_recipe():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    r = client.post(f"/api/recipes/{created['recipe_id']}/like")
    assert r.status_code == 404


def test_admin_can_use_like_endpoint_on_draft_without_changing_count():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    r = client.post(f"/api/recipes/{created['recipe_id']}/like", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json()["like_count"] == 0


def test_like_count_appears_in_detail_and_list_responses():
    recipe_id = _create_and_publish()
    client.post(f"/api/recipes/{recipe_id}/like")
    client.post(f"/api/recipes/{recipe_id}/like")

    detail = client.get(f"/api/recipes/{recipe_id}").json()
    assert detail["like_count"] == 2

    listing = {r["recipe_id"]: r for r in client.get("/api/recipes").json()}
    assert listing[recipe_id]["like_count"] == 2


def test_nonexistent_recipe_like_404s():
    r = client.post("/api/recipes/does-not-exist/like")
    assert r.status_code == 404
    r = client.delete("/api/recipes/does-not-exist/like")
    assert r.status_code == 404
