"""
Auto-research mode: a fast, parallel alternative to the guided research chat.

One lightweight LiteLLM call proposes a short plan and a batch of candidate
search queries (approved/edited by the admin up front — see
routers/research.py's POST /{recipe_id}/auto/plan). Only after that approval
does a CrewAI crew of four concurrent specialist agents (History & Cultural
Context, Ingredients & Nutrition, Steps & Technique, Tips & Troubleshooting)
plus one synchronous Orchestrator agent turn the admin-approved search
results into a merged recipe patch (see POST /{recipe_id}/auto/run).

Unlike the guided chat, no agent here has live tool access — every search
result is pre-fetched by the router (via the existing run_tavily_search())
before the crew ever starts. This guarantees no off-plan searches can happen
mid-run and avoids needing a custom CrewAI tool.

The four specialists run with no dependency on each other's exact output —
each gets the same shared context (dish name, starting prompt/draft, current
document state, pre-approved search results) and works independently. In
particular, the Steps agent does not wait on the Ingredients agent: steps
reference ingredients qualitatively by name (e.g. "add the soaked
chickpeas"), matching how this app's existing recipes are already written —
exact amounts live in the separate ingredients list, not restated inline in
the steps.

Each task is given a stable `name` ("history"/"ingredients"/"steps"/"tips"/
"merge") so a `task_callback` can report progress as each completes — see
run_auto_research_crew's `on_task_done`. CrewAI runs async_execution=True
tasks on their own worker threads, so `on_task_done` can be invoked
concurrently from up to four different threads; the caller (routers/
research.py) is responsible for making that safe (its own short-lived DB
session per call), not this module.
"""
from __future__ import annotations

import json
from typing import Callable, Optional

from pydantic import BaseModel, Field

from .llm_client import litellm_completion

# --- dish name extraction ----------------------------------------------------

NAME_SYSTEM_PROMPT = """Extract a short, clean dish name from the admin's \
input below, which may be a bare dish name, a longer description, or a full \
pasted draft recipe (ingredients/steps included). Return ONLY valid JSON, no \
commentary: {"name": str}. Keep it short (a few words) — a title, not a \
sentence."""


def extract_dish_name(prompt: str, model: str) -> str:
    """One small LLM call to derive a short title for the draft's `name`
    column. Never raises — falls back to a truncated slice of the raw prompt
    (or a placeholder) so a transient LLM hiccup can't block draft creation
    once the model-availability gate has already passed."""
    try:
        response = litellm_completion(
            model=model,
            max_tokens=200,
            messages=[
                {"role": "system", "content": NAME_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        )
        text = response.choices[0].message.content or ""
        start, end = text.find("{"), text.rfind("}") + 1
        name = json.loads(text[start:end]).get("name", "").strip()
        if name:
            return name
    except Exception:
        pass
    fallback = prompt.strip()[:60].strip()
    return fallback or "Untitled recipe"


# --- batch query proposal ---------------------------------------------------

PLAN_SYSTEM_PROMPT = """You are planning a batch of web searches to research a \
recipe for auto-generation, before any searches actually run. The admin may \
have provided a starting prompt that includes a full draft recipe to refine \
rather than invent from scratch — if so, plan searches that fill gaps in or \
verify that draft, not searches that ignore it.

Propose up to 6 focused search queries spread across these categories: \
history/cultural context, ingredients/nutrition, steps/technique, \
tips/troubleshooting. Prefer fewer, well-targeted queries over many \
redundant ones — 4-6 total is typical, not always exactly 6.

Also write a short (2-3 sentence) plan describing what you're about to do,\
 for the admin to review before anything runs.

Return ONLY valid JSON, no commentary:
{"plan": str, "queries": [{"query": str, "category": "history"|"ingredients"|"technique"|"tips"}]}
"""


def propose_search_batch(dish_name: str, starting_prompt: str | None, model: str) -> dict:
    user_content = f"Dish: {dish_name}"
    if starting_prompt:
        user_content += f"\n\nAdmin's starting prompt (may include a draft recipe):\n{starting_prompt}"
    response = litellm_completion(
        model=model,
        max_tokens=1000,
        messages=[
            {"role": "system", "content": PLAN_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    )
    text = response.choices[0].message.content or ""
    start, end = text.find("{"), text.rfind("}") + 1
    envelope = json.loads(text[start:end])
    return {"plan": envelope.get("plan", ""), "queries": envelope.get("queries", [])}


# --- crew: 4 specialists + 1 orchestrator -----------------------------------

class HistorySection(BaseModel):
    history: str = Field(description="Narrative: origin, tradition, cultural significance")
    intro: str = Field(description="A short, 2-4 sentence appetizing description of the dish")
    cuisine_tags: list[str] = Field(default_factory=list)


class IngredientsSection(BaseModel):
    components: list[dict] = Field(
        description='[{"component_name": str, "ingredients": [{"name": str, "amount": number, "unit": str}]}] — prefer grams'
    )
    base_servings_amount: Optional[float] = None
    base_servings_unit: str = "servings"
    serving_size_amount: Optional[float] = Field(default=None, description="Per-serving quantity, e.g. 1, 250")
    serving_size_unit: Optional[str] = Field(default=None, description='Per-serving unit, e.g. "bowl", "piece", "g"')


class StepsSection(BaseModel):
    steps: list[dict] = Field(
        description='[{"step_number": int, "component_ref": str|null, "instruction": str}]'
    )
    prep_time_minutes: Optional[int] = None
    cook_time_minutes: Optional[int] = None


class TipsSection(BaseModel):
    tips: list[str] = Field(default_factory=list)
    watch_outs: list[str] = Field(default_factory=list)


class MergedRecipePatch(BaseModel):
    cuisine_tags: list[str] = Field(default_factory=list)
    base_servings_amount: Optional[float] = None
    base_servings_unit: Optional[str] = None
    serving_size_amount: Optional[float] = None
    serving_size_unit: Optional[str] = None
    components: list[dict] = Field(default_factory=list)
    steps: list[dict] = Field(default_factory=list)
    intro: Optional[str] = None
    history: Optional[str] = None
    prep_time_minutes: Optional[int] = None
    cook_time_minutes: Optional[int] = None
    tips: list[str] = Field(default_factory=list)
    watch_outs: list[str] = Field(default_factory=list)


# Section key -> Pydantic schema + a human label, shared by the crew's task
# wiring and refine_section() below.
SECTION_SCHEMAS = {
    "history": HistorySection,
    "ingredients": IngredientsSection,
    "steps": StepsSection,
    "tips": TipsSection,
}


def _format_search_context(search_results: list[dict]) -> str:
    if not search_results:
        return "(No searches were approved — rely on general culinary knowledge only.)"
    blocks = [f"Query: {r['query']}\nResults:\n{r['result']}" for r in search_results]
    return "\n\n---\n\n".join(blocks)


def run_auto_research_crew(
    dish_name: str,
    current_document: dict,
    search_results: list[dict],
    starting_prompt: str | None,
    model: str,
    on_task_done: Optional[Callable[[str], None]] = None,
) -> dict:
    """Returns a recipe_patch dict — same shape _apply_patch() expects from
    the guided-chat flow, so the router can reuse _apply_patch() unchanged.

    `on_task_done(section_key)` is called once per completed task (including
    the four concurrent specialists, each from its own thread) — see the
    module docstring for the threading contract the caller must uphold."""
    from crewai import Agent, Crew, Process, Task  # local import: crewai is a
    # heavier optional dependency only needed by this flow.

    search_context = _format_search_context(search_results)
    draft_note = (
        f"\n\nThe admin's starting prompt (REFINE/BUILD ON this — it may "
        f"already be a full draft recipe; don't ignore or replace details it "
        f"already specifies unless the search results contradict them):\n"
        f"{starting_prompt}"
        if starting_prompt
        else ""
    )
    shared_context = (
        f"Dish: {dish_name}\n\n"
        f"Current recipe document state (may be partially filled in already):\n"
        f"{json.dumps(current_document, default=str)}"
        f"{draft_note}\n\n"
        f"Pre-approved web search results (the ONLY external information you "
        f"may use — do not invent facts beyond this and general culinary "
        f"knowledge):\n{search_context}"
    )

    history_agent = Agent(
        role="History & Cultural Context Specialist",
        goal="Write an accurate, well-grounded history and intro section for this dish",
        backstory="A food historian who never invents unsourced claims.",
        llm=model,
    )
    ingredients_agent = Agent(
        role="Ingredients & Nutrition Specialist",
        goal="Produce a complete, gram-preferred ingredients list organized by component",
        backstory="A recipe developer obsessive about precise, weighable quantities.",
        llm=model,
    )
    steps_agent = Agent(
        role="Steps & Technique Specialist",
        goal="Write clear, sequential cooking steps referencing ingredients qualitatively by name",
        backstory=(
            "A technique-focused cook who writes steps the way this app's existing "
            "recipes do — e.g. 'add the soaked chickpeas' — without restating exact "
            "gram amounts inline, since those live in the separate ingredients list."
        ),
        llm=model,
    )
    tips_agent = Agent(
        role="Tips & Troubleshooting Specialist",
        goal="Produce practical tips and common-mistake warnings",
        backstory="A seasoned home-cooking instructor who's seen every way this dish goes wrong.",
        llm=model,
    )
    orchestrator_agent = Agent(
        role="Recipe Orchestrator",
        goal="Merge all four specialists' sections into one coherent, complete recipe patch",
        backstory="A meticulous editor who reconciles four specialists' work into one document.",
        llm=model,
    )

    history_task = Task(
        name="history",
        description=f"{shared_context}\n\nWrite the history/intro/cuisine_tags section.",
        expected_output="A JSON object matching the HistorySection schema.",
        agent=history_agent,
        output_pydantic=HistorySection,
        async_execution=True,
    )
    ingredients_task = Task(
        name="ingredients",
        description=(
            f"{shared_context}\n\nWrite the components (ingredients), total "
            f"servings/yield, and serving-size section. serving_size_* is the "
            f"quantity represented by one nutrition-label serving, e.g. "
            f"1 bowl, 1 piece, or 250 g."
        ),
        expected_output="A JSON object matching the IngredientsSection schema.",
        agent=ingredients_agent,
        output_pydantic=IngredientsSection,
        async_execution=True,
    )
    steps_task = Task(
        name="steps",
        description=(
            f"{shared_context}\n\nWrite the steps, prep_time_minutes, and "
            f"cook_time_minutes section. Reference ingredients qualitatively by "
            f"name only — do not restate exact amounts inline."
        ),
        expected_output="A JSON object matching the StepsSection schema.",
        agent=steps_agent,
        output_pydantic=StepsSection,
        async_execution=True,
    )
    tips_task = Task(
        name="tips",
        description=f"{shared_context}\n\nWrite the tips and watch_outs section.",
        expected_output="A JSON object matching the TipsSection schema.",
        agent=tips_agent,
        output_pydantic=TipsSection,
        async_execution=True,
    )
    merge_task = Task(
        name="merge",
        description=(
            f"Dish: {dish_name}\n\n"
            f"The four specialists above each produced a JSON section (history/intro, "
            f"ingredients/servings, steps/timing, tips/watch_outs) — their raw JSON "
            f"outputs are provided to you as context. Merge them into ONE complete "
            f"recipe patch. Keep steps' component_ref values consistent with the "
            f"ingredients' component_name values. Do not drop any field the "
            f"specialists provided."
        ),
        expected_output="A single JSON object matching the MergedRecipePatch schema.",
        agent=orchestrator_agent,
        context=[history_task, ingredients_task, steps_task, tips_task],
        output_pydantic=MergedRecipePatch,
        async_execution=False,
    )

    def _task_callback(output) -> None:
        if on_task_done:
            on_task_done(output.name)

    crew = Crew(
        agents=[history_agent, ingredients_agent, steps_agent, tips_agent, orchestrator_agent],
        tasks=[history_task, ingredients_task, steps_task, tips_task, merge_task],
        process=Process.sequential,
        task_callback=_task_callback if on_task_done else None,
    )
    result = crew.kickoff()
    merged: MergedRecipePatch = result.pydantic
    return merged.model_dump(exclude_none=True)


# --- per-section refinement --------------------------------------------------

REFINE_SYSTEM_PROMPT = """You are refining ONE section of an existing recipe \
per the admin's instruction. You are given the section's current content, \
the full recipe for context/coherence, and the admin's instruction. Return \
ONLY the updated section as valid JSON matching the schema below — no \
commentary, and don't change fields outside this section.

Schema: {schema}
"""


def refine_section(section: str, current_document: dict, instruction: str, model: str) -> dict:
    """Single LLM call scoped to one section — reuses the same Pydantic
    schemas the crew uses, applied through the same _apply_patch() the crew's
    merged output goes through. Raises ValueError for an unknown section key
    (the router maps that to a 400)."""
    schema_cls = SECTION_SCHEMAS.get(section)
    if schema_cls is None:
        raise ValueError(f"Unknown section '{section}'")

    current_section = {k: current_document.get(k) for k in schema_cls.model_fields}
    system_prompt = REFINE_SYSTEM_PROMPT.format(schema=schema_cls.model_json_schema())
    user_content = (
        f"Current section content:\n{json.dumps(current_section, default=str)}\n\n"
        f"Full recipe (for context/coherence, do not restate):\n"
        f"{json.dumps(current_document, default=str)}\n\n"
        f"Admin's instruction: {instruction}"
    )
    response = litellm_completion(
        model=model,
        max_tokens=1500,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    )
    text = response.choices[0].message.content or ""
    start, end = text.find("{"), text.rfind("}") + 1
    return json.loads(text[start:end])
