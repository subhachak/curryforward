from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_role
from ..db import get_db
from ..models import SiteVisit

router = APIRouter(prefix="/api/analytics")


class PageViewRequest(BaseModel):
    visitor_id: str = Field(min_length=8, max_length=80)
    path: str = Field(min_length=1, max_length=300)
    referrer: str | None = Field(default=None, max_length=500)


@router.post("/page-view", status_code=204)
def record_page_view(
    payload: PageViewRequest,
    db: Session = Depends(get_db),
    role: str = Depends(get_role),
):
    # Enforce the exclusion on the server; a modified client cannot count an
    # authenticated admin. Admin and auth routes are never useful traffic.
    if role == "admin" or payload.path.startswith(("/admin", "/login", "/recipe/edit", "/recipe/research")):
        return Response(status_code=204)

    path = "/" + payload.path.lstrip("/").split("?", 1)[0]
    referrer_host = None
    if payload.referrer:
        try:
            referrer_host = urlparse(payload.referrer).hostname
        except ValueError:
            referrer_host = None

    # Suppress rapid duplicate events from remounts/Strict Mode.
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=30)
    duplicate = (
        db.query(SiteVisit)
        .filter(
            SiteVisit.visitor_id == payload.visitor_id,
            SiteVisit.path == path,
            SiteVisit.visited_at >= cutoff,
        )
        .first()
    )
    if not duplicate:
        db.add(SiteVisit(visitor_id=payload.visitor_id, path=path, referrer=referrer_host))
        db.commit()
    return Response(status_code=204)
