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


def test_guest_cannot_access_draft_endpoint():
    r = client.post("/api/recipes/draft", json={"message": "a spicy chicken curry"})
    assert r.status_code == 403


def test_admin_draft_without_api_key_returns_clear_error(monkeypatch):
    # Force the "not configured" path deterministically — a real key may be
    # present in backend/.env for local dev, and these tests shouldn't
    # depend on (or spend) it.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post(
        "/api/recipes/draft", json={"message": "a spicy chicken curry"}, headers=ADMIN_HEADERS
    )
    assert r.status_code == 400
    assert "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_draft_endpoint_accepts_history_and_current_draft(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    payload = {
        "message": "make it vegan",
        "history": [
            {"role": "user", "content": "a chicken curry"},
            {"role": "assistant", "content": "Drafted a chicken curry."},
        ],
        "draft": {"name": "Chicken Curry", "components": [], "steps": []},
    }
    r = client.post("/api/recipes/draft", json=payload, headers=ADMIN_HEADERS)
    # The point of this test is that the request *shape* (history + draft)
    # passes validation and reaches the "not configured" check, not a 422.
    assert r.status_code == 400


def test_chat_endpoint_accepts_history_field(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    payload = {
        "message": "make it spicier",
        "history": [
            {"role": "user", "content": "add more onions"},
            {"role": "assistant", "content": "Added extra onions."},
        ],
    }
    r = client.post("/api/recipes/bonde/chat", json=payload, headers=ADMIN_HEADERS)
    assert r.status_code == 400
    assert "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_chat_history_defaults_to_empty_list(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post(
        "/api/recipes/bonde/chat", json={"message": "make it spicier"}, headers=ADMIN_HEADERS
    )
    assert r.status_code == 400
