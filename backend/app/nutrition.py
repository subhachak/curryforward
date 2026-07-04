"""
Nutrition engine — v0 heuristic implementation.

Same design pattern used throughout this build (MAST classifier in the eval
harness, extraction agent in the recipe pipeline): ship a working heuristic
now, swap in a real data source later behind the same interface.

v0 (this file): curated per-100g nutrition table for common ingredients in
this specific seed data, plus rough unit->gram conversions. Deliberately
approximate — precision was explicitly scoped OUT of MVP (see the earlier
architecture review: "cut nutrition precision to stubs first").

v1/v2 roadmap: swap NUTRITION_TABLE lookups for USDA FoodData Central API
calls behind the same `compute_nutrition(components) -> dict` interface.
"""
from __future__ import annotations

# Per-100g macros: (calories, protein_g, fat_g, carbs_g)
NUTRITION_TABLE: dict[str, tuple[float, float, float, float]] = {
    "vanilla": (288, 0.1, 0.1, 12.6),
    "confectioner's sugar": (389, 0, 0, 100),
    "unsalted butter": (717, 0.9, 81, 0.1),
    "heavy whipping cream": (340, 2.1, 36, 2.8),
    "salt": (0, 0, 0, 0),
    "besan": (387, 22, 6.7, 58),
    "baking soda": (0, 0, 0, 0),
    "rice flour": (366, 6, 1.4, 80),
    "water": (0, 0, 0, 0),
    "sugar": (387, 0, 0, 100),
    "vegetable oil": (884, 0, 100, 0),
    "chicken": (239, 27, 14, 0),
    "yoghurt": (61, 3.5, 3.3, 4.7),
    "chili powder": (282, 13, 14, 50),
    "fried onion": (350, 6, 20, 40),
    "oil": (884, 0, 100, 0),
    "ginger garlic paste": (90, 3, 2, 15),
    "potatoes": (77, 2, 0.1, 17),
    "rice": (130, 2.7, 0.3, 28),
    "eggs": (155, 13, 11, 1.1),
    "mutton": (294, 25, 21, 0),
    "cream cheese": (342, 6, 34, 4),
    "goat cheese": (364, 22, 30, 0),
    "sour cream": (198, 2.4, 20, 4.6),
    "corn starch": (381, 0.3, 0.1, 91),
    "milk": (61, 3.2, 3.3, 4.8),
    "khoi": (356, 8, 1, 78),
    "khoa": (421, 15, 27, 32),
    "condensed milk": (321, 7.9, 8.7, 55),
    "ghee": (900, 0, 100, 0),
    "cardamom powder": (311, 10.8, 6.7, 68),
    "raisins": (299, 3.1, 0.5, 79),
    "gobindo bhog rice": (130, 2.7, 0.3, 28),
    "nolen gur": (383, 0, 0, 98),
    "whole milk ricotta cheese": (174, 11, 13, 3),
}

# Rough unit -> gram conversions (ingredient-agnostic approximation, v0).
UNIT_TO_GRAM = {
    "cup": 120, "tbsp": 15, "tsp": 5, "g": 1, "lb": 453.6, "oz": 28.35,
    "ml": 1, "piece": 50, "drop": 0.05, "inch": 5,
}


def _lookup(name: str) -> tuple[float, float, float, float] | None:
    key = name.strip().lower()
    for known in NUTRITION_TABLE:
        if known in key:
            return NUTRITION_TABLE[known]
    return None


def compute_nutrition(components: list[dict]) -> dict:
    """
    Aggregates nutrition across all ingredients in all components.
    Returns totals plus a list of ingredients that couldn't be matched,
    so the UI can show 'partial data' honestly instead of a false-precision number.
    """
    total_cal = total_protein = total_fat = total_carbs = 0.0
    unmatched: list[str] = []

    for component in components:
        for ing in component.get("ingredients", []):
            macros = _lookup(ing["name"])
            grams = None
            if ing.get("amount") is not None:
                gram_per_unit = UNIT_TO_GRAM.get(ing.get("unit", ""), None)
                if gram_per_unit is not None:
                    grams = ing["amount"] * gram_per_unit
                elif ing.get("gram_equivalent"):
                    grams = ing["gram_equivalent"]

            if macros is None or grams is None:
                unmatched.append(ing["name"])
                continue

            cal, protein, fat, carbs = macros
            factor = grams / 100.0
            total_cal += cal * factor
            total_protein += protein * factor
            total_fat += fat * factor
            total_carbs += carbs * factor

    return {
        "calories": round(total_cal, 1),
        "protein_g": round(total_protein, 1),
        "fat_g": round(total_fat, 1),
        "carbs_g": round(total_carbs, 1),
        "unmatched_ingredients": unmatched,
        "data_completeness": "partial" if unmatched else "complete",
    }
