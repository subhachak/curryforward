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
4. Agentic recipe research: a real multi-turn tool-use loop (unlike #2/#3,
   which declare Anthropic's server-executed web_search tool and never see
   the queries). Here a custom `tavily_search` tool is client-side — the
   model proposes a query and stops; the caller must get human approval
   before actually searching and continuing the turn. See
   start_research_turn / continue_research_turn.

#1-3 call the Anthropic API directly and require ANTHROPIC_API_KEY. #4 is
routed through LiteLLM (see llm_client.py) so the admin can pick any
configured provider/model per research session — it requires whichever
provider key that session's chosen model needs, resolved by the caller in
routers/research.py, not hardcoded here. If a flow's required key isn't set,
the app still runs — these endpoints return a clear error instead of
crashing. Web research additionally requires TAVILY_API_KEY.
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
    from tavily import TavilyClient
except ImportError:
    TavilyClient = None

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
CUSTOMIZE_TIMEOUT_SECONDS = float(os.environ.get("CUSTOMIZE_TIMEOUT_SECONDS", "20"))
CUSTOMIZE_MAX_ATTEMPTS = int(os.environ.get("CUSTOMIZE_MAX_ATTEMPTS", "1"))
logger = logging.getLogger(__name__)


def _client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key or anthropic is None:
        return None
    return anthropic.Anthropic(api_key=api_key)


def is_tavily_configured() -> bool:
    return bool(os.environ.get("TAVILY_API_KEY")) and TavilyClient is not None


CUSTOMIZE_SYSTEM_PROMPT = """You are a recipe customization assistant inside \
Curryforward. You'll be given the current recipe version (JSON: components, \
ingredients, steps) and a user request to modify it (e.g. "make it spicier", \
"swap butter for oil", "reduce sugar by half").

Return the edit by calling the `customize_recipe` tool. Do not answer in prose.

Keep ingredient_ids stable for unchanged ingredients. Only modify what the \
user's request implies. Do not invent ingredients or steps unrelated to the request. \
Prefer expressing ingredient amounts in grams ("g") where a reasonable gram \
equivalent exists, rather than volume units.
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
            "change_summary": {"type": "string"},
        },
        "required": ["change_summary"],
    },
}

GENERATE_SYSTEM_PROMPT = """You are a recipe generation assistant inside \
Curryforward. The user asked for a dish that isn't in their seed collection. \
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
Curryforward, helping an admin create a new recipe conversationally, one \
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

RESEARCH_SYSTEM_PROMPT = """You are a recipe research assistant inside \
Curryforward, helping an admin develop a complete, well-researched recipe step \
by step through conversation — similar to a deep-research assistant, but tuned \
for food.

You are building up a recipe document with these sections over the course of \
the conversation. Fill them in incrementally as you and the admin make \
progress — you do not need all of them in one turn:
- name: the dish's name
- category: e.g. main, dessert, side, drink
- cuisine_tags: list of short cuisine/style tags
- base_servings: {"amount": number, "unit": str} — how many servings this yields
- serving_size: {"amount": number|null, "unit": str|null} — the quantity represented by one nutrition-label serving, e.g. 1 bowl, 1 piece, 250 g
- intro: a short, appetizing 2-4 sentence description of the dish
- history: one narrative covering where the dish comes from, its traditions, \
historical significance, and cultural relevance — grounded in what you actually \
find via search, not invented
- prep_time_minutes / cook_time_minutes: integers
- components: [{"component_name": str, "ingredients": [{"name": str, "amount": \
number|null, "unit": str}]}] — PREFER GRAMS ("g") for ingredient amounts whenever \
a reasonable weight equivalent exists; only use volume/count units (cup, tsp, \
piece, clove, pinch) when weighing genuinely doesn't apply
- steps: [{"step_number": int, "component_ref": str|null, "instruction": str}]
- tips: list of short, practical tips-and-tricks strings
- watch_outs: list of short "things to watch out for" / common-mistake strings

## Web search protocol — approval required

You have a `tavily_search` tool. Never assume you know something you'd need to \
search for — propose ONE focused search at a time by calling the tool, then \
stop and wait. The admin approves or declines each search before you see any \
results; you will never receive results you didn't get explicit approval for. \
Do not propose a second search in the same turn. If a search is declined, do \
not immediately re-propose the same or a near-identical query — acknowledge it \
and either proceed with what you already know or ask the admin a clarifying \
question instead.

## Responding

When you are not proposing a search, respond with ONLY a valid JSON object (no \
commentary outside it) in this exact shape:
{
  "reply": "a short, conversational message for the admin — what you found, \
what you're proposing, or a clarifying question",
  "recipe_patch": {<only the top-level fields you're adding or changing this \
turn, using the section schema above>} or null if you have nothing new yet,
  "notes_suggestion": "a short research note worth remembering" or null — use \
sparingly, only for genuinely useful findings the admin might want to keep \
(e.g. a source, an uncertain fact, a decision point). This is a SUGGESTION the \
admin can accept or dismiss — never assume it's saved.
}

Keep "reply" conversational and concise — you're chatting with the admin, not \
writing the recipe document itself; the actual content goes in recipe_patch.
"""

TAVILY_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "tavily_search",
        "description": (
            "Search the web for factual information to help research this recipe — "
            "its origin, history, cultural significance, common technique, or anything "
            "else useful for writing an accurate, well-informed recipe. Propose ONE "
            "focused query at a time. The user must approve each search before it runs; "
            "you will not see results until they do."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "A focused web search query."}
            },
            "required": ["query"],
        },
    },
}


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


def customize_recipe(current_version: dict, user_request: str, history: list[dict] | None = None) -> dict:
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
                model=MODEL,
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
        model=MODEL,
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


def generate_recipe_for_gap(dish_name: str, preferences: dict) -> dict:
    client = _client()
    if client is None:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set. Add it to backend/.env to enable recipe generation."
        )

    message = client.messages.create(
        model=MODEL,
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


def run_tavily_search(query: str) -> str:
    """Runs a real Tavily search and formats results into a compact string
    suitable for a tool_result block. Only ever called after human approval —
    see routers/research.py."""
    if not is_tavily_configured():
        raise RuntimeError(
            "TAVILY_API_KEY not set. Add it to backend/.env to enable web search."
        )
    client = TavilyClient(api_key=os.environ.get("TAVILY_API_KEY"))
    response = client.search(query, max_results=5)
    results = response.get("results", [])
    if not results:
        return "No results found for this search."

    lines = []
    for r in results:
        title = (r.get("title") or "").strip()
        url = (r.get("url") or "").strip()
        content = (r.get("content") or "").strip()
        if len(content) > 400:
            content = content[:400].rsplit(" ", 1)[0] + "…"
        lines.append(f"- {title} ({url}): {content}")
    text = "\n".join(lines)
    if len(text) > 3000:
        text = text[:3000] + "\n… (truncated)"
    return text


def start_research_turn(messages: list[dict], model: str) -> dict:
    """
    One turn of the agentic research loop — routed through LiteLLM so `model`
    can be any provider/model string the admin picked (see llm_client.py),
    not just Anthropic. Returns a normalized envelope:
      {"assistant_message": <dict to append to the stored message list>,
       "tool_use": {"id": str, "query": str} | None,
       "reply": str | None, "recipe_patch": dict | None,
       "notes_suggestion": str | None}
    `tool_use` is set when the model wants to search — the caller must get
    human approval (see routers/research.py) before calling
    continue_research_turn(). Otherwise `reply`/`recipe_patch`/
    `notes_suggestion` are set from the model's final JSON-envelope response.

    LiteLLM normalizes every provider to OpenAI's wire format: the system
    prompt is a {"role":"system",...} message (not a separate kwarg), tool
    calls come back as response.choices[0].message.tool_calls (not Anthropic
    content blocks), and finish_reason ("tool_calls"/"stop"/"length")
    replaces stop_reason. The system prompt is prepended fresh on every call
    rather than persisted in `messages` — keeps the stored conversation
    smaller and a future prompt tweak applies retroactively to old sessions.
    """
    from .llm_client import litellm_completion

    response = litellm_completion(
        model=model,
        max_tokens=4000,
        messages=[{"role": "system", "content": RESEARCH_SYSTEM_PROMPT}] + messages,
        tools=[TAVILY_SEARCH_TOOL],
        tool_choice="auto",
        parallel_tool_calls=False,
    )

    choice = response.choices[0]
    msg = choice.message
    assistant_message = {
        "role": "assistant",
        "content": msg.content,
        "tool_calls": [tc.model_dump() for tc in msg.tool_calls] if msg.tool_calls else None,
    }

    if choice.finish_reason == "length":
        raise RuntimeError(
            "The research assistant's response was cut off — try a shorter message."
        )

    if choice.finish_reason == "tool_calls" and msg.tool_calls:
        tool_call = msg.tool_calls[0]
        args = json.loads(tool_call.function.arguments)
        return {
            "assistant_message": assistant_message,
            "tool_use": {"id": tool_call.id, "query": args.get("query", "")},
            "reply": None,
            "recipe_patch": None,
            "notes_suggestion": None,
        }

    envelope = _extract_json(msg.content or "")
    return {
        "assistant_message": assistant_message,
        "tool_use": None,
        "reply": envelope.get("reply", ""),
        "recipe_patch": envelope.get("recipe_patch"),
        "notes_suggestion": envelope.get("notes_suggestion"),
    }


def continue_research_turn(
    messages: list[dict],
    tool_use_id: str,
    tool_result_content: str,
    model: str,
    is_error: bool = False,
) -> dict:
    """Appends a tool result for a previously-proposed search (either real
    Tavily results or a "declined by user" notice) and continues the turn.
    Returns the same envelope shape as start_research_turn(), plus a
    "messages" key holding the list (including the injected tool result)
    the caller must persist as the new base — otherwise the next turn's
    tool call would be missing its result on replay, which providers reject.

    `is_error` is accepted for symmetry with the old Anthropic-native
    signature but isn't distinguished on the wire here — LiteLLM's OpenAI-
    style tool message has no separate is_error flag; a declined search is
    communicated via the content text itself (see routers/research.py)."""
    messages = list(messages)
    messages.append({"role": "tool", "tool_call_id": tool_use_id, "content": tool_result_content})
    envelope = start_research_turn(messages, model)
    envelope["messages"] = messages
    return envelope
