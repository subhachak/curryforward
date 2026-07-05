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
    "name": "Trash Test Curry",
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


def _create_draft():
    return client.post("/api/recipes", json=NEW_RECIPE, headers=ADMIN_HEADERS).json()


def _publish(recipe_id):
    r = client.post(f"/api/recipes/research/{recipe_id}/publish", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    return r.json()


def test_create_and_fork_both_default_to_draft():
    created = _create_draft()
    assert created["status"] == "draft"

    _publish(created["recipe_id"])
    forked = client.post(f"/api/recipes/{created['recipe_id']}/fork", headers=ADMIN_HEADERS).json()
    assert forked["status"] == "draft"
    assert forked["recipe_id"] != created["recipe_id"]


def test_delete_gate_rejects_published_recipe():
    created = _create_draft()
    _publish(created["recipe_id"])
    r = client.delete(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS)
    assert r.status_code == 400
    assert "Unpublish" in r.json()["detail"]


def test_restore_requires_prior_delete_and_unhides():
    created = _create_draft()
    r = client.post(f"/api/admin/recipes/{created['recipe_id']}/restore", headers=ADMIN_HEADERS)
    assert r.status_code == 400

    client.delete(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS)
    trash_ids = [t["recipe_id"] for t in client.get("/api/admin/recipes/trash", headers=ADMIN_HEADERS).json()]
    assert created["recipe_id"] in trash_ids

    r = client.post(f"/api/admin/recipes/{created['recipe_id']}/restore", headers=ADMIN_HEADERS)
    assert r.status_code == 200

    admin_ids = [r["recipe_id"] for r in client.get("/api/recipes", headers=ADMIN_HEADERS).json()]
    assert created["recipe_id"] in admin_ids
    trash_ids = [t["recipe_id"] for t in client.get("/api/admin/recipes/trash", headers=ADMIN_HEADERS).json()]
    assert created["recipe_id"] not in trash_ids


def test_purge_requires_prior_soft_delete_then_wipes_history():
    created = _create_draft()
    r = client.delete(f"/api/admin/recipes/{created['recipe_id']}/purge", headers=ADMIN_HEADERS)
    assert r.status_code == 400  # not yet soft-deleted

    client.delete(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS)
    r = client.delete(f"/api/admin/recipes/{created['recipe_id']}/purge", headers=ADMIN_HEADERS)
    assert r.status_code == 200

    history = client.get(f"/api/recipes/{created['recipe_id']}/history", headers=ADMIN_HEADERS).json()
    assert history == []
    trash_ids = [t["recipe_id"] for t in client.get("/api/admin/recipes/trash", headers=ADMIN_HEADERS).json()]
    assert created["recipe_id"] not in trash_ids


def test_unified_admin_list_includes_published_and_draft_with_status():
    draft = _create_draft()
    published = _create_draft()
    _publish(published["recipe_id"])

    rows = {r["recipe_id"]: r for r in client.get("/api/admin/recipes", headers=ADMIN_HEADERS).json()}
    assert rows[draft["recipe_id"]]["status"] == "draft"
    assert rows[published["recipe_id"]]["status"] == "published"


def test_download_respects_guest_vs_draft_visibility():
    created = _create_draft()

    r = client.get(f"/api/recipes/{created['recipe_id']}/download")
    assert r.status_code == 404  # guest, still a draft

    r = client.get(f"/api/recipes/{created['recipe_id']}/download", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "attachment" in r.headers["content-disposition"]
    assert created["name"] in r.text

    _publish(created["recipe_id"])
    r = client.get(f"/api/recipes/{created['recipe_id']}/download")
    assert r.status_code == 200
    assert created["name"] in r.text


def test_view_and_download_counters_increment_only_for_guests():
    created = _create_draft()
    _publish(created["recipe_id"])

    # Admin hits shouldn't move the needle.
    client.get(f"/api/recipes/{created['recipe_id']}")
    client.get(f"/api/recipes/{created['recipe_id']}", headers=ADMIN_HEADERS)
    client.get(f"/api/recipes/{created['recipe_id']}/download", headers=ADMIN_HEADERS)

    rows = {r["recipe_id"]: r for r in client.get("/api/admin/recipes", headers=ADMIN_HEADERS).json()}
    assert rows[created["recipe_id"]]["view_count"] == 1
    assert rows[created["recipe_id"]]["download_count"] == 0

    client.get(f"/api/recipes/{created['recipe_id']}/download")
    rows = {r["recipe_id"]: r for r in client.get("/api/admin/recipes", headers=ADMIN_HEADERS).json()}
    assert rows[created["recipe_id"]]["view_count"] == 1  # download doesn't also count as a view
    assert rows[created["recipe_id"]]["download_count"] == 1
