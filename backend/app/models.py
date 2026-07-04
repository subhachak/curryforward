from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Column, DateTime, Float, ForeignKey, String, Boolean
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def _uid() -> str:
    return uuid.uuid4().hex[:12]


class RecipeVersion(Base):
    """
    Each row is one immutable version. 'Update' creates a new row with the
    same recipe_id and parent_version_id pointing at the prior version
    (linear history). 'Fork' creates a new recipe_id with parent_version_id
    pointing at the version it was forked from (branching history).
    """
    __tablename__ = "recipe_versions"

    version_id = Column(String, primary_key=True, default=_uid)
    recipe_id = Column(String, index=True, nullable=False)
    parent_version_id = Column(String, ForeignKey("recipe_versions.version_id"), nullable=True)
    lineage = Column(String, default="seed")  # seed | edit | fork | generated | user_customized

    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    cuisine_tags = Column(JSON, default=list)

    base_servings_amount = Column(Float, nullable=True)
    base_servings_unit = Column(String, default="servings")

    components = Column(JSON, default=list)   # [{component_name, ingredients:[...]}]
    steps = Column(JSON, default=list)        # [{step_number, component_ref, instruction}]
    nutrition = Column(JSON, default=dict)    # computed nutrition snapshot, per this version

    source = Column(String, default="seed")   # seed | web_augmented | generated | user_customized
    is_current_head = Column(Boolean, default=True)  # latest version for this recipe_id

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        return {
            "version_id": self.version_id,
            "recipe_id": self.recipe_id,
            "parent_version_id": self.parent_version_id,
            "lineage": self.lineage,
            "name": self.name,
            "category": self.category,
            "cuisine_tags": self.cuisine_tags or [],
            "base_servings": {"amount": self.base_servings_amount, "unit": self.base_servings_unit},
            "components": self.components or [],
            "steps": self.steps or [],
            "nutrition": self.nutrition or {},
            "source": self.source,
            "is_current_head": self.is_current_head,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class ReviewQueueItem(Base):
    """Recipes awaiting human approval before entering the versioned Recipe Store."""
    __tablename__ = "review_queue"

    item_id = Column(String, primary_key=True, default=_uid)
    name = Column(String, nullable=False)
    raw_extraction = Column(JSON, default=dict)  # the extractor's full output incl. its guess
    review_reason = Column(String, nullable=True)
    extraction_confidence = Column(Float, default=0.5)
    status = Column(String, default="pending")  # pending | approved | rejected
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        return {
            "item_id": self.item_id,
            "name": self.name,
            "raw_extraction": self.raw_extraction,
            "review_reason": self.review_reason,
            "extraction_confidence": self.extraction_confidence,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
