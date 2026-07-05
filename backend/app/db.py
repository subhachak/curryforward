from __future__ import annotations

import os

import sqlalchemy
from sqlalchemy.engine import make_url
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .models import Base, RecipeVersion
from .nutrition import compute_nutrition

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./curryforward.db")

_database_url = make_url(DATABASE_URL)
_connect_args = {"check_same_thread": False} if _database_url.drivername.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# Columns added to recipe_versions after the initial release. No migration
# framework (Alembic, etc.) — this is a single-admin local app, so a hand-rolled,
# idempotent ALTER TABLE pass on startup is simpler and sufficient. SQLite has no
# native JSON column affinity — SQLAlchemy's JSON type is stored as TEXT either
# way, so JSON-shaped columns get "TEXT" here too.
_RECIPE_VERSION_COLUMN_ADDITIONS = [
    ("intro", "TEXT"),
    ("history", "TEXT"),
    ("prep_time_minutes", "INTEGER"),
    ("cook_time_minutes", "INTEGER"),
    ("tips", "TEXT"),
    ("watch_outs", "TEXT"),
    ("notes", "TEXT"),
    ("research_conversation", "TEXT"),
    ("status", "TEXT"),
    ("updated_at", "DATETIME"),
    ("research_model", "TEXT"),
    ("auto_research_status", "TEXT"),
    ("auto_research_error", "TEXT"),
    ("starting_prompt", "TEXT"),
    ("auto_research_progress", "TEXT"),
    ("auto_research_job_id", "TEXT"),
    ("deleted_at", "DATETIME"),
    ("hero_image_url", "TEXT"),
    ("serving_size_amount", "REAL"),
    ("serving_size_unit", "TEXT"),
]

_RECIPE_FEEDBACK_COLUMN_ADDITIONS = [
    ("moderation_reason", "TEXT"),
]


def _run_lightweight_migrations():
    inspector = sqlalchemy.inspect(engine)
    if "recipe_versions" not in inspector.get_table_names():
        return  # create_all() just made the table fresh, with every column already.

    existing = {c["name"] for c in inspector.get_columns("recipe_versions")}
    with engine.begin() as conn:
        for name, coltype in _RECIPE_VERSION_COLUMN_ADDITIONS:
            if name not in existing:
                conn.execute(sqlalchemy.text(f"ALTER TABLE recipe_versions ADD COLUMN {name} {coltype}"))
        if "status" not in existing:
            # Raw ALTER TABLE ADD COLUMN leaves existing rows NULL regardless of
            # the ORM's Python-side default — backfill explicitly rather than
            # relying on ALTER-time default semantics.
            conn.execute(sqlalchemy.text(
                "UPDATE recipe_versions SET status = 'published' WHERE status IS NULL"
            ))
    if "recipe_feedback" in inspector.get_table_names():
        existing_feedback = {c["name"] for c in inspector.get_columns("recipe_feedback")}
        with engine.begin() as conn:
            for name, coltype in _RECIPE_FEEDBACK_COLUMN_ADDITIONS:
                if name not in existing_feedback:
                    conn.execute(sqlalchemy.text(f"ALTER TABLE recipe_feedback ADD COLUMN {name} {coltype}"))


def _backfill_expanded_nutrition():
    """compute_nutrition() grew new fields (sodium, cholesterol, vitamins,
    etc.) for the FDA-style label. Rows saved before that change still have
    the old 4-field nutrition JSON — recompute those (detected by a missing
    "sodium_mg" key) so the label doesn't render a fabricated-looking "0"
    for data we simply hadn't computed yet. One-pass and idempotent: rows
    written after this change already have the key and are skipped."""
    from sqlalchemy.orm import Session

    with Session(engine) as db:
        rows = db.query(RecipeVersion).filter(RecipeVersion.components.isnot(None)).all()
        changed = False
        for row in rows:
            if row.nutrition and "sodium_mg" in row.nutrition:
                continue
            row.nutrition = compute_nutrition(row.components or [])
            changed = True
        if changed:
            db.commit()


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations()
    _backfill_expanded_nutrition()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
