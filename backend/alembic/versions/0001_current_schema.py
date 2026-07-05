"""baseline current schema

Revision ID: 0001_current_schema
Revises:
Create Date: 2026-07-05
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_current_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recipe_versions",
        sa.Column("version_id", sa.String(), primary_key=True),
        sa.Column("recipe_id", sa.String(), nullable=False),
        sa.Column("parent_version_id", sa.String(), sa.ForeignKey("recipe_versions.version_id"), nullable=True),
        sa.Column("lineage", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("cuisine_tags", sa.JSON(), nullable=True),
        sa.Column("hero_image_url", sa.String(), nullable=True),
        sa.Column("base_servings_amount", sa.Float(), nullable=True),
        sa.Column("base_servings_unit", sa.String(), nullable=True),
        sa.Column("serving_size_amount", sa.Float(), nullable=True),
        sa.Column("serving_size_unit", sa.String(), nullable=True),
        sa.Column("components", sa.JSON(), nullable=True),
        sa.Column("steps", sa.JSON(), nullable=True),
        sa.Column("nutrition", sa.JSON(), nullable=True),
        sa.Column("intro", sa.Text(), nullable=True),
        sa.Column("history", sa.Text(), nullable=True),
        sa.Column("prep_time_minutes", sa.Integer(), nullable=True),
        sa.Column("cook_time_minutes", sa.Integer(), nullable=True),
        sa.Column("tips", sa.JSON(), nullable=True),
        sa.Column("watch_outs", sa.JSON(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("research_conversation", sa.JSON(), nullable=True),
        sa.Column("research_model", sa.String(), nullable=True),
        sa.Column("starting_prompt", sa.Text(), nullable=True),
        sa.Column("auto_research_status", sa.String(), nullable=True),
        sa.Column("auto_research_error", sa.Text(), nullable=True),
        sa.Column("auto_research_progress", sa.JSON(), nullable=True),
        sa.Column("auto_research_job_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("is_current_head", sa.Boolean(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_recipe_versions_recipe_id", "recipe_versions", ["recipe_id"])

    op.create_table(
        "recipe_analytics",
        sa.Column("recipe_id", sa.String(), primary_key=True),
        sa.Column("view_count", sa.Integer(), nullable=False),
        sa.Column("download_count", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "research_jobs",
        sa.Column("job_id", sa.String(), primary_key=True),
        sa.Column("recipe_id", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("approved_queries", sa.JSON(), nullable=True),
        sa.Column("search_results", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("progress", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_research_jobs_recipe_id", "research_jobs", ["recipe_id"])

    op.create_table(
        "review_queue",
        sa.Column("item_id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("raw_extraction", sa.JSON(), nullable=True),
        sa.Column("review_reason", sa.String(), nullable=True),
        sa.Column("extraction_confidence", sa.Float(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("review_queue")
    op.drop_index("ix_research_jobs_recipe_id", table_name="research_jobs")
    op.drop_table("research_jobs")
    op.drop_table("recipe_analytics")
    op.drop_index("ix_recipe_versions_recipe_id", table_name="recipe_versions")
    op.drop_table("recipe_versions")
