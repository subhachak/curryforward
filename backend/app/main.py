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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .auth import router as auth_router
from .db import SessionLocal, init_db
from .routers.admin import router as admin_router
from .routers.models import router as models_router
from .routers.recipes import router as recipes_router
from .routers.research import router as research_router
from .routers.uploads import router as uploads_router, UPLOADS_DIR
from .seed_loader import load_seed_data

app = FastAPI(title="Curryforward")

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


# Production: `next build` with output:'export' writes static files to
# frontend-next/out — same origin as the API, so the session cookie and
# relative /api fetches both work with zero extra config.
FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend-next" / "out"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


@app.on_event("startup")
def on_startup():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    db = SessionLocal()
    try:
        load_seed_data(db)
    finally:
        db.close()
