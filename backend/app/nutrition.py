"""
Nutrition engine — v0 heuristic implementation.

Same design pattern used throughout this build (MAST classifier in the eval
harness, extraction agent in the recipe pipeline): ship a working heuristic
now, swap in a real data source later behind the same interface.

v0 (this file): curated per-100g nutrition table for common ingredients in
this specific seed data, plus rough unit->gram conversions. Deliberately
approximate — precision was explicitly scoped OUT of MVP (see the earlier
architecture review: "cut nutrition precision to stubs first"). The
saturated/trans fat, cholesterol, sodium, fiber, sugars, and vitamin/mineral
columns are the same kind of rough per-100g estimate as the original four
macros — not looked up from a real food database, just typical values for
each ingredient so the full FDA-style label has something plausible in
every row instead of a fabricated-looking blank.

v1/v2 roadmap: swap NUTRITION_TABLE lookups for USDA FoodData Central API
calls behind the same `compute_nutrition(components) -> dict` interface.
"""
from __future__ import annotations

from typing import NamedTuple


class NutrientProfile(NamedTuple):
    """Per-100g values. `added_sugars_g` is a subset of `sugars_g` — only
    ingredients that function as an added sweetener in a recipe (table
    sugar, jaggery, condensed milk) carry a nonzero value; naturally
    occurring sugars (fruit, milk lactose) do not, matching the FDA's
    added-vs-total-sugars distinction on the real label."""

    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float
    saturated_fat_g: float
    trans_fat_g: float
    cholesterol_mg: float
    sodium_mg: float
    fiber_g: float
    sugars_g: float
    added_sugars_g: float
    vitamin_d_mcg: float
    calcium_mg: float
    iron_mg: float
    potassium_mg: float


NUTRITION_TABLE: dict[str, NutrientProfile] = {
    "vanilla": NutrientProfile(288, 0.1, 0.1, 12.6, 0, 0, 0, 9, 0, 12.6, 0, 0, 11, 0.12, 148),
    "confectioner's sugar": NutrientProfile(389, 0, 0, 100, 0, 0, 0, 1, 0, 100, 100, 0, 1, 0.01, 2),
    "unsalted butter": NutrientProfile(717, 0.9, 81, 0.1, 51, 3.3, 215, 11, 0, 0.1, 0, 1.5, 24, 0.02, 24),
    "heavy whipping cream": NutrientProfile(340, 2.1, 36, 2.8, 23, 1, 137, 27, 0, 2.8, 0, 0.5, 65, 0.06, 95),
    "salt": NutrientProfile(0, 0, 0, 0, 0, 0, 0, 38758, 0, 0, 0, 0, 24, 0.33, 8),
    "besan": NutrientProfile(387, 22, 6.7, 58, 0.7, 0, 0, 64, 10.8, 10.7, 0, 0, 45, 4.86, 846),
    "baking soda": NutrientProfile(0, 0, 0, 0, 0, 0, 0, 27360, 0, 0, 0, 0, 0, 0, 0),
    "rice flour": NutrientProfile(366, 6, 1.4, 80, 0.4, 0, 0, 0, 2.4, 0.1, 0, 0, 10, 0.35, 76),
    "water": NutrientProfile(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    "sugar": NutrientProfile(387, 0, 0, 100, 0, 0, 0, 1, 0, 100, 100, 0, 1, 0.05, 2),
    "vegetable oil": NutrientProfile(884, 0, 100, 0, 13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    "chicken": NutrientProfile(239, 27, 14, 0, 4, 0.1, 88, 82, 0, 0, 0, 0.2, 15, 1.0, 223),
    "yoghurt": NutrientProfile(61, 3.5, 3.3, 4.7, 2.1, 0.1, 13, 46, 0, 4.7, 0, 0.1, 121, 0.05, 155),
    "chili powder": NutrientProfile(282, 13, 14, 50, 2.5, 0, 0, 15, 34, 7, 0, 0, 148, 7.4, 2010),
    "fried onion": NutrientProfile(350, 6, 20, 40, 3, 0, 0, 15, 5, 15, 0, 0, 40, 1.5, 320),
    "oil": NutrientProfile(884, 0, 100, 0, 13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    "ginger garlic paste": NutrientProfile(90, 3, 2, 15, 0.3, 0, 0, 20, 2, 3, 0, 0, 30, 0.8, 300),
    "potatoes": NutrientProfile(77, 2, 0.1, 17, 0, 0, 0, 6, 2.2, 0.8, 0, 0, 12, 0.8, 425),
    "rice": NutrientProfile(130, 2.7, 0.3, 28, 0.1, 0, 0, 1, 0.4, 0.1, 0, 0, 10, 0.2, 35),
    "eggs": NutrientProfile(155, 13, 11, 1.1, 3.3, 0.02, 373, 124, 0, 1.1, 0, 2, 50, 1.75, 138),
    "mutton": NutrientProfile(294, 25, 21, 0, 9, 0.8, 97, 72, 0, 0, 0, 0, 17, 1.96, 310),
    "cream cheese": NutrientProfile(342, 6, 34, 4, 19, 1, 110, 314, 0, 3.2, 0, 0.5, 98, 0.15, 138),
    "goat cheese": NutrientProfile(364, 22, 30, 0, 21, 0.5, 90, 515, 0, 0, 0, 0, 298, 1.6, 121),
    "sour cream": NutrientProfile(198, 2.4, 20, 4.6, 12.5, 0.6, 59, 33, 0, 3.4, 0, 0.1, 106, 0.06, 141),
    "corn starch": NutrientProfile(381, 0.3, 0.1, 91, 0, 0, 0, 9, 0.9, 0, 0, 0, 2, 0.47, 3),
    "milk": NutrientProfile(61, 3.2, 3.3, 4.8, 1.9, 0.1, 10, 43, 0, 5.1, 0, 1.3, 113, 0.03, 132),
    "khoi": NutrientProfile(356, 8, 1, 78, 0.2, 0, 0, 2, 1, 0.5, 0, 0, 5, 1, 100),
    "khoa": NutrientProfile(421, 15, 27, 32, 17, 0.8, 80, 90, 0, 20, 0, 0.3, 250, 0.3, 300),
    "condensed milk": NutrientProfile(321, 7.9, 8.7, 55, 5.5, 0.3, 34, 127, 0, 55, 45, 0.2, 284, 0.2, 371),
    "ghee": NutrientProfile(900, 0, 100, 0, 65, 4, 256, 0, 0, 0, 0, 1.8, 4, 0, 5),
    "cardamom powder": NutrientProfile(311, 10.8, 6.7, 68, 1.4, 0, 0, 18, 28, 0, 0, 0, 383, 14, 1119),
    "raisins": NutrientProfile(299, 3.1, 0.5, 79, 0.1, 0, 0, 11, 3.7, 59, 0, 0, 50, 1.88, 749),
    "gobindo bhog rice": NutrientProfile(130, 2.7, 0.3, 28, 0.1, 0, 0, 1, 0.4, 0.1, 0, 0, 10, 0.2, 35),
    "nolen gur": NutrientProfile(383, 0, 0, 98, 0, 0, 0, 20, 0, 95, 95, 0, 80, 11, 1050),
    "whole milk ricotta cheese": NutrientProfile(174, 11, 13, 3, 8.3, 0.4, 51, 84, 0, 3, 0, 0.1, 207, 0.4, 105),
}

# Rough unit -> gram conversions (ingredient-agnostic approximation, v0).
UNIT_TO_GRAM = {
    "cup": 120, "tbsp": 15, "tsp": 5, "g": 1, "lb": 453.6, "oz": 28.35,
    "ml": 1, "piece": 50, "drop": 0.05, "inch": 5,
}


def _lookup(name: str) -> NutrientProfile | None:
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
    totals = {field: 0.0 for field in NutrientProfile._fields}
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

            factor = grams / 100.0
            for field in NutrientProfile._fields:
                totals[field] += getattr(macros, field) * factor

    return {
        **{field: round(value, 2) for field, value in totals.items()},
        "unmatched_ingredients": unmatched,
        "data_completeness": "partial" if unmatched else "complete",
    }
