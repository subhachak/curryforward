from __future__ import annotations

import os

import sqlalchemy
from sqlalchemy.engine import make_url
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .models import Base, RecipeVersion, _secure_public_url
from .nutrition import compute_nutrition
from .services.recipe_identity import ensure_recipe_identity

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
    ("auto_research_activity", "TEXT"),
    ("auto_research_job_id", "TEXT"),
    ("deleted_at", "DATETIME"),
    ("hero_image_url", "TEXT"),
    ("serving_count", "REAL"),
    ("serving_size_amount", "REAL"),
    ("serving_size_unit", "TEXT"),
    ("suggested_utensils", "TEXT"),
    ("pan_conversions", "TEXT"),
    ("public_slug", "TEXT"),
    ("admin_ref", "TEXT"),
]

_RECIPE_FEEDBACK_COLUMN_ADDITIONS = [
    ("moderation_reason", "TEXT"),
    ("parent_feedback_id", "TEXT"),
]

_RECIPE_ANALYTICS_COLUMN_ADDITIONS = [
    ("like_count", "INTEGER"),
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
    if "recipe_analytics" in inspector.get_table_names():
        existing_analytics = {c["name"] for c in inspector.get_columns("recipe_analytics")}
        with engine.begin() as conn:
            for name, coltype in _RECIPE_ANALYTICS_COLUMN_ADDITIONS:
                if name not in existing_analytics:
                    conn.execute(sqlalchemy.text(f"ALTER TABLE recipe_analytics ADD COLUMN {name} {coltype}"))
            if "like_count" not in existing_analytics:
                # Raw ALTER TABLE ADD COLUMN leaves existing rows NULL regardless
                # of the ORM's Python-side default — backfill explicitly.
                conn.execute(sqlalchemy.text(
                    "UPDATE recipe_analytics SET like_count = 0 WHERE like_count IS NULL"
                ))


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


def _backfill_recipe_identity():
    """Populate public slugs and opaque admin refs for older rows.

    Public recipes get stable human-readable slugs. Drafts intentionally do
    not get public slugs until publish, but they do get admin refs so edit
    URLs no longer expose internal recipe_id values such as research-*.
    """
    from sqlalchemy.orm import Session

    with Session(engine) as db:
        rows = db.query(RecipeVersion).order_by(RecipeVersion.created_at, RecipeVersion.version_id).all()
        changed = False
        for row in rows:
            before = (row.public_slug, row.admin_ref)
            ensure_recipe_identity(row, db)
            changed = changed or before != (row.public_slug, row.admin_ref)
        if changed:
            db.commit()


def _backfill_secure_recipe_media_urls():
    """Persistently upgrade remote http media URLs to https.

    Browsers mark an HTTPS page as "Not secure" when it loads HTTP images.
    Recipe media often comes from AI/imported content, so normalize old rows
    in addition to sanitizing response output.
    """
    from sqlalchemy.orm import Session

    with Session(engine) as db:
        rows = db.query(RecipeVersion).all()
        changed = False
        for row in rows:
            next_hero = _secure_public_url(row.hero_image_url)
            if next_hero != row.hero_image_url:
                row.hero_image_url = next_hero
                changed = True
            next_steps = []
            steps_changed = False
            for step in row.steps or []:
                next_step = dict(step)
                next_url = _secure_public_url(next_step.get("image_url"))
                if next_url != next_step.get("image_url"):
                    next_step["image_url"] = next_url
                    steps_changed = True
                next_steps.append(next_step)
            if steps_changed:
                row.steps = next_steps
                changed = True
        if changed:
            db.commit()


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations()
    _backfill_recipe_identity()
    _backfill_secure_recipe_media_urls()
    _backfill_expanded_nutrition()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
