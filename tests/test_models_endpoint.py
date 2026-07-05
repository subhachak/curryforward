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


def test_guest_cannot_list_models():
    assert client.get("/api/models").status_code == 403


def test_models_filtered_to_configured_providers(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-anthropic-key")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    r = client.get("/api/models", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    ids = [m["id"] for m in r.json()]
    assert any(m.startswith("anthropic/") for m in ids)
    assert not any(m.startswith("openai/") for m in ids)
    assert not any(m.startswith("groq/") for m in ids)


def test_models_include_openai_once_key_is_set(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-anthropic-key")
    monkeypatch.setenv("OPENAI_API_KEY", "fake-openai-key")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    r = client.get("/api/models", headers=ADMIN_HEADERS)
    ids = [m["id"] for m in r.json()]
    assert any(m.startswith("openai/") for m in ids)
    assert not any(m.startswith("groq/") for m in ids)
