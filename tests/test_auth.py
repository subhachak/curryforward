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


def test_guest_role_by_default():
    r = client.get("/api/me")
    assert r.json()["role"] == "guest"


def test_admin_role_with_correct_token():
    r = client.get("/api/me", headers=ADMIN_HEADERS)
    assert r.json()["role"] == "admin"


def test_wrong_token_is_still_guest():
    r = client.get("/api/me", headers={"X-Admin-Token": "wrong-token"})
    assert r.json()["role"] == "guest"


def test_guest_cannot_fork():
    r = client.post("/api/recipes/bonde/fork")
    assert r.status_code == 403


def test_admin_can_fork():
    r = client.post("/api/recipes/bonde/fork", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.json()["lineage"] == "fork"


def test_guest_cannot_decide_review_queue():
    items = client.get("/api/review-queue", headers=ADMIN_HEADERS).json()
    if not items:
        return
    item_id = items[0]["item_id"]
    r = client.post(f"/api/review-queue/{item_id}/decide", json={"approved": True})
    assert r.status_code == 403


def test_forking_original_recipe_leaves_it_unchanged():
    before = client.get("/api/recipes/bonde").json()
    client.post("/api/recipes/bonde/fork", headers=ADMIN_HEADERS)
    after = client.get("/api/recipes/bonde").json()
    assert before["recipe_id"] == after["recipe_id"] == "bonde"
    assert before["lineage"] == after["lineage"] == "seed"
