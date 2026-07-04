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
    assert body["nutrition"]["calories"] > 0


def test_created_recipe_appears_in_list():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    recipe_ids = [r["recipe_id"] for r in client.get("/api/recipes").json()]
    assert created["recipe_id"] in recipe_ids


def test_guest_cannot_update_recipe():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    r = client.put(f"/api/recipes/{created['recipe_id']}", json=NEW_RECIPE)
    assert r.status_code == 403


def test_admin_can_update_recipe_creating_new_version():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    updated_payload = {**NEW_RECIPE, "name": "Test Manual Curry (updated)"}
    r = client.put(f"/api/recipes/{created['recipe_id']}", json=updated_payload, headers=ADMIN_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Test Manual Curry (updated)"
    assert body["recipe_id"] == created["recipe_id"]
    assert body["version_id"] != created["version_id"]
    assert body["lineage"] == "edit"

    history = client.get(f"/api/recipes/{created['recipe_id']}/history").json()
    assert len(history) == 2


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


def test_delete_removes_full_version_history():
    created = client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()
    client.put(f"/api/recipes/{created['recipe_id']}", json=NEW_RECIPE, headers=ADMIN_HEADERS)
    client.delete(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS)
    history = client.get(f"/api/recipes/{created['recipe_id']}/history").json()
    assert history == []
