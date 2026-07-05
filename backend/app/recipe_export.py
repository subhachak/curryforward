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
            lines.append(f"- {amount + ' ' if amount else ''}{ing['name']}")
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

    return "\n".join(lines).rstrip() + "\n"
