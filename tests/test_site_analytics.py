import uuid

from app.db import SessionLocal
from app.main import app
from app.models import SiteVisit
from fastapi.testclient import TestClient


client = TestClient(app)
ADMIN_HEADERS = {"X-Admin-Token": "test-token-123"}


def _visit_count(visitor_id: str) -> int:
    db = SessionLocal()
    try:
        return db.query(SiteVisit).filter(SiteVisit.visitor_id == visitor_id).count()
    finally:
        db.close()


def test_admin_page_view_is_not_recorded():
    visitor_id = str(uuid.uuid4())
    response = client.post(
        "/api/analytics/page-view",
        headers=ADMIN_HEADERS,
        json={"visitor_id": visitor_id, "path": "/recipes", "referrer": None},
    )

    assert response.status_code == 204
    assert _visit_count(visitor_id) == 0


def test_guest_page_view_is_recorded():
    visitor_id = str(uuid.uuid4())
    response = client.post(
        "/api/analytics/page-view",
        json={"visitor_id": visitor_id, "path": "/recipes", "referrer": None},
    )

    assert response.status_code == 204
    assert _visit_count(visitor_id) == 1
