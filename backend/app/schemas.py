from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class IngredientPayload(BaseModel):
    name: str
    amount: float | None = None
    unit: str = ""
    gram_equivalent: float | None = None
    unit_options: list[dict[str, Any]] = Field(default_factory=list)


class ComponentPayload(BaseModel):
    component_name: str
    ingredients: list[IngredientPayload] = Field(default_factory=list)


class StepPayload(BaseModel):
    step_number: int | None = None
    component_ref: str | None = None
    instruction: str
    image_url: str | None = None


class RecipeUpsertRequest(BaseModel):
    """Manual creation payload. Editing now happens in the agentic research
    workspace via ResearchPatchRequest."""

    name: str
    category: str | None = None
    cuisine_tags: list[str] = Field(default_factory=list)
    base_servings_amount: float | None = None
    base_servings_unit: str = "servings"
    serving_size_amount: float | None = None
    serving_size_unit: str | None = None
    components: list[ComponentPayload] = Field(default_factory=list)
    steps: list[StepPayload] = Field(default_factory=list)
    hero_image_url: str | None = None

    def normalized_components(self) -> list[dict[str, Any]]:
        return [component.model_dump() for component in self.components]

    def normalized_steps(self) -> list[dict[str, Any]]:
        return [step.model_dump(exclude_none=True) for step in self.steps]


class BaseServings(BaseModel):
    amount: float | None
    unit: str | None


class ServingSize(BaseModel):
    amount: float | None
    unit: str | None


class RecipeDetailResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    version_id: str
    recipe_id: str
    parent_version_id: str | None
    lineage: str
    name: str
    category: str | None
    cuisine_tags: list[str]
    hero_image_url: str | None
    base_servings: BaseServings
    serving_size: ServingSize
    components: list[dict[str, Any]]
    steps: list[dict[str, Any]]
    nutrition: dict[str, Any]
    intro: str | None
    history: str | None
    prep_time_minutes: int | None
    cook_time_minutes: int | None
    tips: list[str]
    watch_outs: list[str]
    suggested_utensils: list[str]
    pan_conversions: list[dict[str, Any]]
    status: Literal["draft", "published"] | str
    source: str | None
    is_current_head: bool
    created_at: str | None
    updated_at: str | None
    metadata: dict[str, Any] | None = None
    feedback_summary: dict[str, Any] | None = None


class RecipeFeedbackCreateRequest(BaseModel):
    author_name: str | None = Field(default=None, max_length=80)
    rating: int | None = Field(default=None, ge=1, le=5)
    comment: str = Field(min_length=1, max_length=2000)


class RecipeFeedbackResponse(BaseModel):
    feedback_id: str
    recipe_id: str
    author_name: str | None
    rating: int | None
    comment: str
    status: str
    moderation_reason: str | None
    created_at: str | None
    updated_at: str | None


class RecipeFeedbackListResponse(BaseModel):
    average_rating: float | None
    rating_count: int
    review_count: int
    comment_count: int
    items: list[RecipeFeedbackResponse]


class RecipeResearchResponse(RecipeDetailResponse):
    notes: str | None
    research_conversation: dict[str, Any]
    research_model: str | None
    starting_prompt: str | None
    auto_research_status: Literal["running", "error"] | None
    auto_research_error: str | None
    auto_research_progress: list[str]


class RecipeSummaryResponse(BaseModel):
    recipe_id: str
    version_id: str
    name: str
    category: str | None
    cuisine_tags: list[str]
    lineage: str
    source: str | None
    hero_image_url: str | None
    created_at: str | None
    status: Literal["draft", "published"] | str | None = None
