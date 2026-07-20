"""
LLM agent — powers four things:
1. Chat-based customization of an existing recipe version (edit loop).
   Multi-turn: callers may pass prior conversation history for context.
2. Generating a NEW base recipe when a requested dish isn't in the seed,
   using web search for technique/style grounding — NOT to copy a recipe
   verbatim (copyright: instructions are protected text), but to inform an
   original generation.
3. Conversational recipe drafting: an admin pastes a natural-language draft
   (or just a dish idea) and can iteratively refine it before saving —
   never persists on its own, unlike #2.
4. Native web search for admin auto-research/admin-assistant lookups, always
   invoked by backend code after an explicit admin action.

#1-3 call the Anthropic API directly and require ANTHROPIC_API_KEY. If a
flow's required key isn't set, the app still runs — these endpoints return a
clear error instead of crashing. Web research uses the configured native
provider search tool.
"""
from __future__ import annotations

import json
import logging
import os
import re
from fractions import Fraction

from pydantic import BaseModel, Field, ValidationError, field_validator

try:
    import anthropic
except ImportError:
    anthropic = None

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
CUSTOMIZE_TIMEOUT_SECONDS = float(os.environ.get("CUSTOMIZE_TIMEOUT_SECONDS", "20"))
CUSTOMIZE_MAX_ATTEMPTS = int(os.environ.get("CUSTOMIZE_MAX_ATTEMPTS", "1"))
logger = logging.getLogger(__name__)


def _client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key or anthropic is None:
        return None
    return anthropic.Anthropic(api_key=api_key)


def is_web_search_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY")) and OpenAI is not None


CUSTOMIZE_SYSTEM_PROMPT = """You are a recipe customization assistant inside \
CurryForward. You'll be given the current recipe version (JSON: components, \
ingredients, steps) and a user request to modify it (e.g. "make it spicier", \
"swap butter for oil", "reduce sugar by half").

Return the edit by calling the `customize_recipe` tool. Do not answer in prose.

Keep ingredient_ids stable for unchanged ingredients. Only modify what the \
user's request implies. Do not invent ingredients or steps unrelated to the request. \
Prefer expressing ingredient amounts in grams ("g") where a reasonable gram \
equivalent exists, rather than volume units.

Nothing you return is saved yet — it's a proposal the admin reviews before \
applying it to a draft. Write `change_summary` as a description of that \
proposal, not a completed action: say "This swaps X for Y" or "I'd reduce \
the sugar by half", never "Converted..." / "Swapped..." / "Reduced..." as if \
it already happened.

Make your best-effort interpretation and edit even when a request is loosely \
specified — do not refuse or make an empty edit just because details are \
missing. Only populate `clarifying_questions` when the request could \
reasonably be interpreted in genuinely different ways that would lead to a \
different edit (e.g. "make it healthier" — lower fat? lower sugar? more \
vegetables?). In that case, still make your best single interpretation AND \
list up to 3 short follow-up questions the admin could tap to steer it \
differently. For clear, unambiguous requests (e.g. "scale to 8 servings", \
"swap butter for oil"), leave `clarifying_questions` empty — most requests \
should leave it empty.
"""


class LLMInvalidResponseError(RuntimeError):
    """Raised when a provider response could not be turned into a recipe edit."""


def _coerce_optional_float(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if not isinstance(value, str):
        return None

    text = value.strip().lower()
    if not text or text in {"none", "null", "n/a", "na", "to taste", "as needed"}:
        return None

    total = 0.0
    matched = False
    for token in re.findall(r"\d+\s*/\s*\d+|\d+(?:\.\d+)?", text):
        matched = True
        if "/" in token:
            total += float(Fraction(token.replace(" ", "")))
        else:
            total += float(token)
    return total if matched else None


class CustomizedIngredient(BaseModel):
    ingredient_id: str | None = None
    name: str
    amount: float | None = None
    unit: str = ""
    gram_equivalent: float | None = None

    @field_validator("amount", "gram_equivalent", mode="before")
    @classmethod
    def parse_recipe_quantity(cls, value):
        return _coerce_optional_float(value)

    @field_validator("unit", mode="before")
    @classmethod
    def default_unit(cls, value):
        return "" if value is None else str(value)


class CustomizedComponent(BaseModel):
    component_name: str
    ingredients: list[CustomizedIngredient] = Field(default_factory=list)


class CustomizedStep(BaseModel):
    step_number: int | None = None
    component_ref: str | None = None
    instruction: str
    image_url: str | None = None


class CustomizedRecipeResult(BaseModel):
    components: list[CustomizedComponent] | None = None
    steps: list[CustomizedStep] | None = None
    change_summary: str = ""
    clarifying_questions: list[str] = Field(default_factory=list)

    def as_payload(self, current_version: dict) -> dict:
        payload = self.model_dump(exclude_none=True)
        if "components" not in payload:
            payload["components"] = current_version["components"]
        if "steps" not in payload:
            payload["steps"] = current_version["steps"]
        return payload


CUSTOMIZE_RECIPE_TOOL = {
    "name": "customize_recipe",
    "description": "Return the complete customized recipe components and steps.",
    "input_schema": {
        "type": "object",
        "properties": {
            "components": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "component_name": {"type": "string"},
                        "ingredients": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "ingredient_id": {"type": ["string", "null"]},
                                    "name": {"type": "string"},
                                    "amount": {"type": ["number", "string", "null"]},
                                    "unit": {"type": ["string", "null"]},
                                    "gram_equivalent": {"type": ["number", "string", "null"]},
                                },
                                "required": ["name"],
                            },
                        },
                    },
                    "required": ["component_name", "ingredients"],
                },
            },
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "step_number": {"type": ["integer", "null"]},
                        "component_ref": {"type": ["string", "null"]},
                        "instruction": {"type": "string"},
                        "image_url": {"type": ["string", "null"]},
                    },
                    "required": ["instruction"],
                },
            },
            "change_summary": {
                "type": "string",
                "description": (
                    "Describe the PROPOSED edit, not a completed action — this hasn't "
                    "been saved yet. E.g. 'This swaps sugar for erythritol...', not "
                    "'Converted to...' or 'Swapped...'."
                ),
            },
            "clarifying_questions": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "0-3 short follow-up questions to offer the admin, ONLY if this "
                    "request was genuinely ambiguous in a way that would change the "
                    "edit. Leave empty for clear, unambiguous requests — most requests."
                ),
            },
        },
        "required": ["change_summary"],
    },
}

GENERATE_SYSTEM_PROMPT = """You are a recipe generation assistant inside \
CurryForward. The user asked for a dish that isn't in their seed collection. \
Use web search to understand typical technique, structure, and flavor \
profile for this dish and style — but DO NOT copy any single source's \
recipe text. Generate an ORIGINAL recipe informed by common technique.

Return ONLY valid JSON matching this exact shape, no commentary:
{
  "name": str,
  "category": str,
  "cuisine_tags": [str],
  "base_servings": {"amount": number, "unit": str},
  "serving_size": {"amount": number|null, "unit": str|null},
  "components": [{"component_name": str, "ingredients": [{"ingredient_id": str, "name": str, "amount": number, "unit": str}]}],
  "steps": [{"step_number": int, "component_ref": str|null, "instruction": str}]
}

Prefer expressing ingredient amounts in grams ("g") where a reasonable gram \
equivalent exists, rather than volume units.
"""

DRAFT_SYSTEM_PROMPT = """You are a recipe drafting assistant inside \
CurryForward, helping an admin create a new recipe conversationally, one \
message at a time.

Depending on what the user sends:
- If they paste a messy natural-language recipe draft (an ingredient list \
and/or instructions, in any format), structure it faithfully into the \
schema below — preserve their actual ingredients, amounts, and steps; \
don't invent replacements.
- If they give just a short dish name or idea with no details, you may use \
web search to understand typical technique and flavor profile, then \
generate an ORIGINAL recipe informed by that (not copied from any single \
source).
- If a "Current draft recipe" is included below, the user is asking to \
refine THAT draft — apply their requested change and return the full \
updated recipe, keeping everything else the same.

Return ONLY valid JSON matching this exact shape, no commentary:
{
  "name": str,
  "category": str,
  "cuisine_tags": [str],
  "base_servings": {"amount": number|null, "unit": str},
  "serving_size": {"amount": number|null, "unit": str|null},
  "components": [{"component_name": str, "ingredients": [{"name": str, "amount": number|null, "unit": str}]}],
  "steps": [{"step_number": int, "component_ref": str|null, "instruction": str}],
  "change_summary": "one sentence describing what you did"
}

Prefer expressing ingredient amounts in grams ("g") where a reasonable gram \
equivalent exists, rather than volume units.
"""

def is_configured() -> bool:
    return _client() is not None


def _text_from_content(content: list) -> str:
    return "".join(getattr(block, "text", "") for block in content if getattr(block, "type", None) == "text")


def _tool_input_from_content(content: list) -> dict | None:
    for block in content:
        if (
            getattr(block, "type", None) == "tool_use"
            and getattr(block, "name", None) == CUSTOMIZE_RECIPE_TOOL["name"]
        ):
            tool_input = getattr(block, "input", None)
            if isinstance(tool_input, dict):
                return tool_input
    return None


def _validate_customization_payload(payload: dict, current_version: dict) -> dict:
    try:
        return CustomizedRecipeResult.model_validate(payload).as_payload(current_version)
    except ValidationError as exc:
        logger.warning("Recipe customization response failed validation: %s", exc)
        raise LLMInvalidResponseError(
            "The assistant returned an invalid recipe edit. Try a smaller or more specific change."
        ) from exc


def customize_recipe(
    current_version: dict,
    user_request: str,
    history: list[dict] | None = None,
    model: str | None = None,
) -> dict:
    client = _client()
    if client is None:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set. Add it to backend/.env to enable chat customization."
        )

    # `history` carries prior turns of this conversation (role/content pairs)
    # so follow-ups like "make it even spicier" have context on what came
    # before, instead of each message being evaluated in isolation.
    messages = list(history or [])
    messages.append({
        "role": "user",
        "content": (
            f"Current recipe:\n{json.dumps({'components': current_version['components'], 'steps': current_version['steps']})}\n\n"
            f"User request: {user_request}"
        ),
    })

    last_error: Exception | None = None
    for attempt in range(max(1, CUSTOMIZE_MAX_ATTEMPTS)):
        attempt_messages = messages
        if attempt > 0:
            attempt_messages = [
                *messages,
                {
                    "role": "user",
                    "content": (
                        "Your previous response was not a valid recipe edit. "
                        "Call the customize_recipe tool with complete components, "
                        "steps, and change_summary. Do not answer in prose."
                    ),
                },
            ]

        try:
            message = client.messages.create(
                model=model or MODEL,
                max_tokens=2000,
                system=CUSTOMIZE_SYSTEM_PROMPT,
                tools=[CUSTOMIZE_RECIPE_TOOL],
                tool_choice={"type": "tool", "name": CUSTOMIZE_RECIPE_TOOL["name"]},
                messages=attempt_messages,
                timeout=CUSTOMIZE_TIMEOUT_SECONDS,
            )

            tool_input = _tool_input_from_content(message.content)
            if tool_input is not None:
                return _validate_customization_payload(tool_input, current_version)

            # Fallback for SDK/provider drift: if a text-only response slips
            # through, still accept it only after extracting and validating JSON.
            text = _text_from_content(message.content)
            if not text.strip():
                raise LLMInvalidResponseError("The assistant returned an empty recipe edit.")
            return _validate_customization_payload(_extract_json(text), current_version)
        except (json.JSONDecodeError, LLMInvalidResponseError) as exc:
            last_error = exc
        except Exception as exc:
            logger.exception("Recipe customization provider call failed")
            raise LLMInvalidResponseError(
                "The assistant service could not complete that recipe edit. Try again in a moment."
            ) from exc

    raise LLMInvalidResponseError(
        "The assistant could not produce a valid recipe edit. Try rephrasing or asking for a smaller change."
    ) from last_error



def draft_recipe_from_conversation(
    message: str,
    history: list[dict] | None = None,
    current_draft: dict | None = None,
    model: str | None = None,
) -> dict:
    """Conversational, never-persisting recipe drafting — the counterpart to
    customize_recipe() but for a recipe that doesn't exist yet. The caller
    (POST /api/recipes/draft) always returns the result for review; actually
    saving it is a separate, explicit POST /api/recipes call."""
    client = _client()
    if client is None:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set. Add it to backend/.env to enable recipe drafting."
        )

    messages = list(history or [])
    user_content = message
    if current_draft:
        user_content = f"Current draft recipe:\n{json.dumps(current_draft)}\n\nUser message: {message}"
    messages.append({"role": "user", "content": user_content})

    response = client.messages.create(
        model=model or MODEL,
        max_tokens=3000,
        system=DRAFT_SYSTEM_PROMPT,
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=messages,
    )
    text_blocks = [b.text for b in response.content if b.type == "text"]
    text = "".join(text_blocks)
    start = text.find("{")
    end = text.rfind("}") + 1
    return json.loads(text[start:end])


def generate_recipe_for_gap(dish_name: str, preferences: dict, model: str | None = None) -> dict:
    client = _client()
    if client is None:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set. Add it to backend/.env to enable recipe generation."
        )

    message = client.messages.create(
        model=model or MODEL,
        max_tokens=3000,
        system=GENERATE_SYSTEM_PROMPT,
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=[{
            "role": "user",
            "content": (
                f"Generate a base recipe for: {dish_name}\n"
                f"User preferences: {json.dumps(preferences)}"
            ),
        }],
    )
    text_blocks = [b.text for b in message.content if b.type == "text"]
    text = "".join(text_blocks)
    # Extract the JSON object even if the model added surrounding text.
    start = text.find("{")
    end = text.rfind("}") + 1
    return json.loads(text[start:end])


def _extract_json(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}") + 1
    return json.loads(text[start:end])


def run_web_search(query: str) -> str:
    """Runs native provider web search and formats results into compact context.

    Only ever called after human approval — see routers/research.py. OpenAI is
    the default backend because the app's task defaults are GPT models and the
    Responses API exposes a first-party web_search tool with citations.
    """
    if not is_web_search_configured():
        raise RuntimeError(
            "OPENAI_API_KEY not set. Add it to backend/.env to enable native web search."
        )
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    model = os.environ.get("OPENAI_WEB_SEARCH_MODEL", "gpt-5-mini")
    response = client.responses.create(
        model=model,
        tools=[{"type": "web_search"}],
        tool_choice="required",
        include=["web_search_call.action.sources"],
        input=(
            "Search the web for this CurryForward recipe research query. "
            "Return a concise source-grounded summary with useful facts, "
            "and include source names/URLs when available.\n\n"
            f"Query: {query}"
        ),
    )
    text = (getattr(response, "output_text", "") or "").strip()
    return text or "No useful web search results were returned for this query."
