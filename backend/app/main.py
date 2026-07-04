from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .db import SessionLocal, init_db
from .routers.recipes import router as recipes_router
from .seed_loader import load_seed_data

app = FastAPI(title="Curryforward")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(recipes_router)

FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


@app.on_event("startup")
def on_startup():
    init_db()
    db = SessionLocal()
    try:
        load_seed_data(db)
    finally:
        db.close()
