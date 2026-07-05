"""
Renders a recipe as a plain Markdown document for the download endpoint (see
routers/recipes.py's GET /recipes/{id}/download). No PDF or other heavy
rendering dependency — matches this app's existing complexity budget.
"""
from __future__ import annotations


def render_markdown(recipe: dict) -> str:
    lines = [f"# {recipe['name']}", ""]

    meta = []
    if recipe.get("category"):
        meta.append(f"Category: {recipe['category']}")
    servings = recipe.get("base_servings") or {}
    if servings.get("amount"):
        meta.append(f"Serves: {servings['amount']} {servings.get('unit', '')}".strip())
    serving_size = recipe.get("serving_size") or {}
    if serving_size.get("amount") or serving_size.get("unit"):
        size = " ".join(str(v) for v in (serving_size.get("amount"), serving_size.get("unit")) if v)
        meta.append(f"Serving size: {size}")
    if recipe.get("prep_time_minutes"):
        meta.append(f"Prep: {recipe['prep_time_minutes']} min")
    if recipe.get("cook_time_minutes"):
        meta.append(f"Cook: {recipe['cook_time_minutes']} min")
    if meta:
        lines.append("*" + " · ".join(meta) + "*")
        lines.append("")

    if recipe.get("intro"):
        lines += [recipe["intro"], ""]

    if recipe.get("history"):
        lines += ["## History & facts", "", recipe["history"], ""]

    lines.append("## Ingredients")
    for component in recipe.get("components", []):
        if component.get("component_name"):
            lines.append(f"\n**{component['component_name']}**")
        for ing in component.get("ingredients", []):
            amount = f"{ing['amount']} {ing['unit']}".strip() if ing.get("amount") else ""
            alternates = ing.get("unit_options") or []
            alt_text = ""
            if alternates:
                labels = [
                    option.get("label") or " ".join(str(v) for v in (option.get("amount"), option.get("unit")) if v)
                    for option in alternates
                ]
                alt_text = f" ({'; '.join(label for label in labels if label)})"
            lines.append(f"- {amount + ' ' if amount else ''}{ing['name']}{alt_text}")
    lines.append("")

    lines.append("## Steps")
    for i, step in enumerate(recipe.get("steps", []), start=1):
        lines.append(f"{i}. {step['instruction']}")
    lines.append("")

    if recipe.get("tips"):
        lines.append("## Tips & tricks")
        for t in recipe["tips"]:
            lines.append(f"- {t}")
        lines.append("")

    if recipe.get("watch_outs"):
        lines.append("## Things to watch out for")
        for w in recipe["watch_outs"]:
            lines.append(f"- {w}")
        lines.append("")

    if recipe.get("suggested_utensils"):
        lines.append("## Suggested utensils")
        for item in recipe["suggested_utensils"]:
            lines.append(f"- {item}")
        lines.append("")

    if recipe.get("pan_conversions"):
        lines.append("## Baking pan conversions")
        for item in recipe["pan_conversions"]:
            from_side = f"{item.get('from_count') or '?'} x {item.get('from_size') or ''}".strip()
            to_side = f"{item.get('to_count') or '?'} x {item.get('to_size') or ''}".strip()
            note = f" — {item['note']}" if item.get("note") else ""
            lines.append(f"- {from_side} = {to_side}{note}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
