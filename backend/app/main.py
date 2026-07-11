from __future__ import annotations

import os
import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .auth import router as auth_router
from .db import SessionLocal, init_db
from .routers.admin import router as admin_router
from .routers.analytics import router as analytics_router
from .routers.models import router as models_router
from .routers.recipes import router as recipes_router
from .routers.research import router as research_router
from .routers.uploads import router as uploads_router, UPLOADS_DIR
from .seed_loader import load_seed_data
from .models import RecipeVersion
from .services.security import RateLimitMiddleware, SecurityHeadersMiddleware

app = FastAPI(title="CurryForward")

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)

# Cookie-based sessions require explicit origins (not "*") once
# allow_credentials is on. CORS_ORIGINS lets you add deployed frontend
# origins without touching code; localhost:3000 covers `next dev`.
_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_router)
app.include_router(analytics_router)
app.include_router(auth_router)
app.include_router(models_router)
app.include_router(recipes_router)
app.include_router(research_router)
app.include_router(uploads_router)

# User-uploaded step images (research flow) — created at startup if missing,
# served as plain files (this app's frontend is a static export with no
# image-optimization pipeline, so recipe pages just use <img src="/uploads/...">).
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


@app.get("/api/health")
def health_check():
    return {"ok": True}


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap_xml():
    base_url = os.environ.get("SITE_URL", "http://localhost:3000").rstrip("/")
    db = SessionLocal()
    try:
        recipes = (
            db.query(RecipeVersion)
            .filter(
                RecipeVersion.is_current_head == True,  # noqa: E712
                RecipeVersion.status == "published",
                RecipeVersion.deleted_at.is_(None),
                RecipeVersion.public_slug.isnot(None),
            )
            .all()
        )
        urls = [f"<url><loc>{base_url}/</loc></url>", f"<url><loc>{base_url}/recipes/</loc></url>"]
        for recipe in recipes:
            modified = recipe.updated_at or recipe.created_at
            lastmod = f"<lastmod>{modified.date().isoformat()}</lastmod>" if modified else ""
            urls.append(f"<url><loc>{base_url}/{recipe.public_slug}</loc>{lastmod}</url>")
        xml = '<?xml version="1.0" encoding="UTF-8"?>' + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(urls) + "</urlset>"
        return Response(content=xml, media_type="application/xml")
    finally:
        db.close()


# Production: `next build` with output:'export' writes static files to
# frontend-next/out — same origin as the API, so the session cookie and
# relative /api fetches both work with zero extra config.
FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend-next" / "out"


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str = ""):
    """Serve the static-exported Next frontend, with root-level recipe slugs.

    StaticFiles(html=True) can serve exported routes like /recipe/ but it
    cannot turn /death-by-chocolate-cake into the recipe shell. This handler
    serves real exported files first, then falls back to recipe/index.html for
    extensionless unknown paths so pretty recipe URLs work in production.
    """
    if not FRONTEND_DIR.exists():
        raise HTTPException(404, "Frontend build not found")

    requested = (FRONTEND_DIR / full_path).resolve()
    frontend_root = FRONTEND_DIR.resolve()
    if not str(requested).startswith(str(frontend_root)):
        raise HTTPException(404, "Not found")

    if requested.is_dir():
        requested = requested / "index.html"
    elif not requested.exists():
        html_sibling = requested.with_suffix(".html")
        if html_sibling.exists():
            requested = html_sibling

    if requested.exists() and requested.is_file():
        return FileResponse(requested)

    # Missing assets and nested paths should stay missing; one-segment
    # extensionless paths can be recipe slugs and should render the
    # client-side recipe page.
    if Path(full_path).suffix or "/" in full_path.strip("/"):
        raise HTTPException(404, "Not found")
    recipe_page = FRONTEND_DIR / "recipe" / "index.html"
    if recipe_page.exists():
        return FileResponse(recipe_page)
    raise HTTPException(404, "Not found")


@app.on_event("startup")
def on_startup():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    db = SessionLocal()
    try:
        load_seed_data(db)
    finally:
        db.close()
