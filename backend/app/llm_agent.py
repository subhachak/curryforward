"""
LLM agent — powers two things:
1. Chat-based customization of an existing recipe version (edit loop).
2. Generating a NEW base recipe when a requested dish isn't in the seed,
   using web search for technique/style grounding — NOT to copy a recipe
   verbatim (copyright: instructions are protected text), but to inform an
   original generation.

Requires ANTHROPIC_API_KEY in the environment (.env). If it's not set, the
app still runs — these endpoints return a clear error instead of crashing,
so local testing of the rest of the app isn't blocked by missing a key.
"""
from __future__ import annotations

import json
import os

try:
    import anthropic
except ImportError:
    anthropic = None

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")


def _client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key or anthropic is None:
        return None
    return anthropic.Anthropic(api_key=api_key)


CUSTOMIZE_SYSTEM_PROMPT = """You are a recipe customization assistant inside \
Curryforward. You'll be given the current recipe version (JSON: components, \
ingredients, steps) and a user request to modify it (e.g. "make it spicier", \
"swap butter for oil", "reduce sugar by half").

Return ONLY valid JSON matching this exact shape, no commentary:
{
  "components": [{"component_name": str, "ingredients": [{"ingredient_id": str, "name": str, "amount": number|null, "unit": str, "gram_equivalent": number|null}]}],
  "steps": [{"step_number": int, "component_ref": str|null, "instruction": str}],
  "change_summary": "one sentence describing what changed"
}

Keep ingredient_ids stable for unchanged ingredients. Only modify what the \
user's request implies. Do not invent ingredients or steps unrelated to the request.
"""

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
  "components": [{"component_name": str, "ingredients": [{"ingredient_id": str, "name": str, "amount": number, "unit": str}]}],
  "steps": [{"step_number": int, "component_ref": str|null, "instruction": str}]
}
"""


def is_configured() -> bool:
    return _client() is not None


def customize_recipe(current_version: dict, user_request: str) -> dict:
    client = _client()
    if client is None:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set. Add it to backend/.env to enable chat customization."
        )

    message = client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=CUSTOMIZE_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": (
                f"Current recipe:\n{json.dumps({'components': current_version['components'], 'steps': current_version['steps']})}\n\n"
                f"User request: {user_request}"
            ),
        }],
    )
    text = "".join(b.text for b in message.content if b.type == "text")
    return json.loads(text)


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
