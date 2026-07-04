from __future__ import annotations

import json
import re
from pathlib import Path

from sqlalchemy.orm import Session

from .models import RecipeVersion, ReviewQueueItem
from .nutrition import compute_nutrition

SEED_DIR = Path(__file__).parent.parent / "seed_data"


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load_seed_data(db: Session):
    already_seeded = db.query(RecipeVersion).first() is not None
    if already_seeded:
        return

    seed_path = SEED_DIR / "seed_recipes.json"
    review_path = SEED_DIR / "review_queue.json"

    if seed_path.exists():
        recipes = json.loads(seed_path.read_text())
        for r in recipes:
            nutrition = compute_nutrition(r["components"])
            version = RecipeVersion(
                recipe_id=r["recipe_id"],
                parent_version_id=None,
                lineage="seed",
                name=r["name"],
                category=_guess_category(r["name"]),
                cuisine_tags=[],
                base_servings_amount=r["base_servings"]["amount"],
                base_servings_unit=r["base_servings"]["unit"],
                components=r["components"],
                steps=r["steps"],
                nutrition=nutrition,
                source="seed",
                is_current_head=True,
            )
            db.add(version)

    if review_path.exists():
        review_items = json.loads(review_path.read_text())
        for r in review_items:
            item = ReviewQueueItem(
                name=r["name"],
                raw_extraction=r,
                review_reason=r.get("review_reason"),
                extraction_confidence=r.get("extraction_confidence", 0.5),
                status="pending",
            )
            db.add(item)

    db.commit()


def _guess_category(name: str) -> str:
    dessert_hints = ["cake", "cookie", "buttercream", "frosting", "sondesh", "rasogolla",
                     "moa", "payesh", "doi", "rasmalai", "bonde"]
    lowered = name.lower()
    if any(h in lowered for h in dessert_hints):
        return "dessert"
    return "main"
