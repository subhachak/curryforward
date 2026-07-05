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


def test_forking_original_recipe_leaves_it_unchanged():
    before = client.get("/api/recipes/bonde").json()
    client.post("/api/recipes/bonde/fork", headers=ADMIN_HEADERS)
    after = client.get("/api/recipes/bonde").json()
    assert before["recipe_id"] == after["recipe_id"] == "bonde"
    assert before["lineage"] == after["lineage"] == "seed"


def test_login_with_wrong_password_is_rejected():
    r = client.post("/api/auth/login", json={"password": "not-it"})
    assert r.status_code == 401


def test_login_with_correct_password_sets_admin_session():
    session_client = TestClient(app)
    r = session_client.post("/api/auth/login", json={"password": "test-token-123"})
    assert r.status_code == 200
    assert r.json()["role"] == "admin"
    assert session_client.get("/api/me").json()["role"] == "admin"


def test_logout_clears_admin_session():
    session_client = TestClient(app)
    session_client.post("/api/auth/login", json={"password": "test-token-123"})
    assert session_client.get("/api/me").json()["role"] == "admin"
    session_client.post("/api/auth/logout")
    assert session_client.get("/api/me").json()["role"] == "guest"


def test_admin_session_cookie_authorizes_fork():
    session_client = TestClient(app)
    session_client.post("/api/auth/login", json={"password": "test-token-123"})
    r = session_client.post("/api/recipes/bonde/fork")
    assert r.status_code == 200
    assert r.json()["lineage"] == "fork"


def test_upload_rejects_declared_image_with_invalid_body():
    r = client.post(
        "/api/uploads",
        headers=ADMIN_HEADERS,
        files={"file": ("fake.png", b"not actually a png", "image/png")},
    )
    assert r.status_code == 400
    assert "not a valid supported image" in r.json()["detail"]


def test_upload_rejects_content_type_mismatch():
    png_body = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    r = client.post(
        "/api/uploads",
        headers=ADMIN_HEADERS,
        files={"file": ("fake.jpg", png_body, "image/jpeg")},
    )
    assert r.status_code == 400
    assert "does not match" in r.json()["detail"]
