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

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

from sqlalchemy.orm import Session

from .models import IngredientNutritionCache


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
    "heavy cream": NutrientProfile(340, 2.1, 36, 2.8, 23, 1, 137, 27, 0, 2.8, 0, 0.5, 65, 0.06, 95),
    "double cream": NutrientProfile(467, 1.7, 50.5, 2.7, 31.7, 1.5, 140, 44, 0, 2.7, 0, 0.7, 63, 0.05, 80),
    "salt": NutrientProfile(0, 0, 0, 0, 0, 0, 0, 38758, 0, 0, 0, 0, 24, 0.33, 8),
    "black pepper": NutrientProfile(251, 10.4, 3.3, 64, 1.4, 0, 0, 20, 25.3, 0.6, 0, 0, 443, 9.7, 1329),
    "worcestershire sauce": NutrientProfile(78, 0, 0, 19.5, 0, 0, 0, 980, 0, 10, 8, 0, 107, 5.3, 800),
    "egg white": NutrientProfile(52, 10.9, 0.2, 0.7, 0, 0, 0, 166, 0, 0.7, 0, 0, 7, 0.08, 163),
    "bread": NutrientProfile(265, 9, 3.2, 49, 0.7, 0, 0, 491, 2.7, 5, 2, 0, 144, 3.6, 115),
    "onion": NutrientProfile(40, 1.1, 0.1, 9.3, 0, 0, 0, 4, 1.7, 4.2, 0, 0, 23, 0.21, 146),
    "celery": NutrientProfile(16, 0.7, 0.2, 3, 0, 0, 0, 80, 1.6, 1.3, 0, 0, 40, 0.2, 260),
    "garlic": NutrientProfile(149, 6.4, 0.5, 33, 0.1, 0, 0, 17, 2.1, 1, 0, 0, 181, 1.7, 401),
    "sage": NutrientProfile(315, 10.6, 12.8, 61, 7, 0, 0, 11, 40, 1.7, 0, 0, 1652, 28.1, 1070),
    "parsley": NutrientProfile(36, 3, 0.8, 6.3, 0.1, 0, 0, 56, 3.3, 0.9, 0, 0, 138, 6.2, 554),
    "rosemary": NutrientProfile(131, 3.3, 5.9, 20.7, 2.8, 0, 0, 26, 14.1, 0, 0, 0, 317, 6.7, 668),
    "chicken stock": NutrientProfile(7, 1, 0.2, 0.4, 0.1, 0, 0, 343, 0, 0.4, 0, 0, 5, 0.1, 25),
    "vegetable stock": NutrientProfile(5, 0.2, 0.1, 1, 0, 0, 0, 250, 0, 0.5, 0, 0, 5, 0.1, 25),
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

UNIT_ALIASES = {
    "cups": "cup",
    "c": "cup",
    "tablespoon": "tbsp",
    "tablespoons": "tbsp",
    "tbsp": "tbsp",
    "tbs": "tbsp",
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "tsp": "tsp",
    "gram": "g",
    "grams": "g",
    "g": "g",
    "kilogram": "kg",
    "kilograms": "kg",
    "kg": "kg",
    "ounce": "oz",
    "ounces": "oz",
    "oz": "oz",
    "pound": "lb",
    "pounds": "lb",
    "lb": "lb",
    "lbs": "lb",
    "milliliter": "ml",
    "milliliters": "ml",
    "ml": "ml",
    "qty": "piece",
    "quantity": "piece",
    "count": "piece",
    "piece": "piece",
    "pieces": "piece",
    "large": "piece",
    "clove": "piece",
    "cloves": "piece",
}

USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
USDA_NUTRIENT_MAP = {
    "1008": "calories",
    "1003": "protein_g",
    "1004": "fat_g",
    "1005": "carbs_g",
    "1258": "saturated_fat_g",
    "1257": "trans_fat_g",
    "1253": "cholesterol_mg",
    "1093": "sodium_mg",
    "1079": "fiber_g",
    "2000": "sugars_g",
    "1235": "added_sugars_g",
    "1114": "vitamin_d_mcg",
    "1087": "calcium_mg",
    "1089": "iron_mg",
    "1092": "potassium_mg",
}

USDA_NUTRIENT_NAME_MAP = {
    "energy": "calories",
    "protein": "protein_g",
    "total lipid (fat)": "fat_g",
    "carbohydrate, by difference": "carbs_g",
    "fatty acids, total saturated": "saturated_fat_g",
    "fatty acids, total trans": "trans_fat_g",
    "cholesterol": "cholesterol_mg",
    "sodium, na": "sodium_mg",
    "fiber, total dietary": "fiber_g",
    "total sugars": "sugars_g",
    "sugars, total including nlea": "sugars_g",
    "added sugars": "added_sugars_g",
    "vitamin d (d2 + d3)": "vitamin_d_mcg",
    "vitamin d": "vitamin_d_mcg",
    "calcium, ca": "calcium_mg",
    "iron, fe": "iron_mg",
    "potassium, k": "potassium_mg",
}

INGREDIENT_ALIASES = {
    "double cream": "heavy cream",
    "double heavy cream": "heavy cream",
    "heavy double cream": "heavy cream",
    "heavy whipping cream": "heavy whipping cream",
    "whipping cream": "heavy whipping cream",
    "double heavy": "heavy cream",
    "sea salt": "salt",
    "kosher salt": "salt",
    "table salt": "salt",
    "ground black pepper": "black pepper",
    "freshly ground black pepper": "black pepper",
    "black pepper powder": "black pepper",
    "worcester sauce": "worcestershire sauce",
    "worcestershire": "worcestershire sauce",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_ingredient_text(name: str) -> str:
    key = name.strip().lower()
    key = re.sub(r"[()]", " ", key)
    key = re.sub(r"[^a-z0-9\s-]", " ", key)
    key = re.sub(
        r"\b(chopped|diced|minced|sliced|grated|fresh|raw|cooked|optional|softened|melted|room|temperature|at|to|about)\b",
        " ",
        key,
    )
    key = re.sub(r"\s+", " ", key).strip()
    return key or name.strip().lower()


def _canonical_ingredient_name(name: str) -> str:
    key = _normalize_ingredient_text(name)
    if key in INGREDIENT_ALIASES:
        return INGREDIENT_ALIASES[key]
    for alias, canonical in INGREDIENT_ALIASES.items():
        if alias in key:
            return canonical
    return key


def _ingredient_name_candidates(name: str) -> list[str]:
    candidates = [
        _canonical_ingredient_name(name),
        _normalize_ingredient_text(name),
        name.strip().lower(),
    ]
    unique = []
    for candidate in candidates:
        if candidate and candidate not in unique:
            unique.append(candidate)
    return unique


def _normalize_cache_key(name: str) -> str:
    return _canonical_ingredient_name(name)


def _normalize_unit(unit: str | None) -> str:
    raw = (unit or "").strip().lower()
    if not raw:
        return ""
    raw = raw.split(",", 1)[0].strip()
    raw = re.sub(r"[^a-z]+", " ", raw).strip()
    token = raw.split()[0] if raw else ""
    return UNIT_ALIASES.get(raw) or UNIT_ALIASES.get(token) or token


def _as_float(value) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _grams_from_unit_options(ingredient: dict) -> float | None:
    for option in ingredient.get("unit_options") or []:
        amount = _as_float(option.get("amount"))
        unit = _normalize_unit(option.get("unit"))
        if amount is None:
            continue
        if unit == "kg":
            return amount * 1000
        if unit == "g":
            return amount
    return None


def _ingredient_grams(ingredient: dict) -> float | None:
    canonical_grams = _as_float(ingredient.get("gram_amount"))
    if canonical_grams is not None:
        return canonical_grams

    explicit_grams = _as_float(ingredient.get("gram_equivalent"))
    if explicit_grams is not None:
        return explicit_grams

    option_grams = _grams_from_unit_options(ingredient)
    if option_grams is not None:
        return option_grams

    amount = _as_float(ingredient.get("amount"))
    if amount is None:
        return None
    unit = _normalize_unit(ingredient.get("unit"))
    if unit == "kg":
        return amount * 1000
    gram_per_unit = UNIT_TO_GRAM.get(unit)
    if gram_per_unit is None:
        return None
    return amount * gram_per_unit


def estimated_yield_grams(components: list[dict]) -> float | None:
    total = 0.0
    has_measured_ingredient = False
    for component in components:
        for ingredient in component.get("ingredients", []):
            grams = _ingredient_grams(ingredient)
            if grams is None:
                continue
            total += grams
            has_measured_ingredient = True
    return round(total, 1) if has_measured_ingredient and total > 0 else None


def _nutrition_api_key() -> str | None:
    return os.environ.get("USDA_FDC_API_KEY") or os.environ.get("USDA_API_KEY")


def _cache_ttl_days() -> int:
    try:
        return max(1, int(os.environ.get("USDA_NUTRITION_CACHE_DAYS", "180")))
    except ValueError:
        return 180


def _lookup(name: str) -> NutrientProfile | None:
    key = _canonical_ingredient_name(name)
    for known in NUTRITION_TABLE:
        if known in key:
            return NUTRITION_TABLE[known]
    return None


def _profile_from_payload(payload: dict) -> NutrientProfile:
    values = {field: float(payload.get(field) or 0) for field in NutrientProfile._fields}
    return NutrientProfile(**values)


def _profile_has_values(profile: NutrientProfile) -> bool:
    return any(getattr(profile, field) > 0 for field in NutrientProfile._fields)


def _fill_missing_profile_values(profile: NutrientProfile, fallback: NutrientProfile | None) -> NutrientProfile:
    if fallback is None:
        return profile
    values = {
        field: getattr(profile, field) or getattr(fallback, field)
        for field in NutrientProfile._fields
    }
    return NutrientProfile(**values)


def _cache_profile(db: Session | None, name: str, allow_expired: bool = False) -> NutrientProfile | None:
    if db is None:
        return None
    key = _normalize_cache_key(name)
    row = db.get(IngredientNutritionCache, key)
    if not row:
        return None
    expires_at = row.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if allow_expired or (expires_at and expires_at > _utcnow()):
        profile = _profile_from_payload(row.nutrients or {})
        profile = _fill_missing_profile_values(profile, _lookup(name))
        return profile if _profile_has_values(profile) else None
    return None


def _extract_usda_nutrients(food: dict) -> dict[str, float]:
    values = {field: 0.0 for field in NutrientProfile._fields}
    for nutrient in food.get("foodNutrients") or []:
        number = str(nutrient.get("nutrientNumber") or nutrient.get("number") or "").strip()
        name = str(nutrient.get("nutrientName") or nutrient.get("name") or "").strip().lower()
        field = USDA_NUTRIENT_MAP.get(number) or USDA_NUTRIENT_NAME_MAP.get(name)
        if not field:
            continue
        amount = nutrient.get("value", nutrient.get("amount"))
        if amount is None:
            continue
        try:
            values[field] = float(amount)
        except (TypeError, ValueError):
            continue
    return values


def _fetch_usda_profile(name: str) -> tuple[NutrientProfile, dict] | None:
    api_key = _nutrition_api_key()
    if not api_key:
        return None

    query = _canonical_ingredient_name(name)
    params = urllib.parse.urlencode({"api_key": api_key})
    body = json.dumps({
        "query": query,
        "pageSize": 5,
        "dataType": ["Foundation", "SR Legacy", "Survey (FNDDS)"],
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{USDA_SEARCH_URL}?{params}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    foods = payload.get("foods") or []
    if not foods:
        return None
    food = foods[0]
    nutrients = _extract_usda_nutrients(food)
    if not any(nutrients.values()):
        return None
    source = {
        "fdc_id": food.get("fdcId"),
        "description": food.get("description"),
        "data_type": food.get("dataType"),
        "published_date": food.get("publishedDate"),
        "nutrients": nutrients,
    }
    return _profile_from_payload(nutrients), source


def _refresh_cache_profile(db: Session | None, name: str) -> NutrientProfile | None:
    if db is None:
        return None
    fetched = _fetch_usda_profile(name)
    if not fetched:
        return None

    profile, source = fetched
    now = _utcnow()
    key = _normalize_cache_key(name)
    with db.no_autoflush:
        row = db.get(IngredientNutritionCache, key)
        if row is None:
            row = next(
                (
                    pending
                    for pending in db.new
                    if isinstance(pending, IngredientNutritionCache)
                    and pending.cache_key == key
                ),
                None,
            )
    if row is None:
        row = IngredientNutritionCache(cache_key=key, ingredient_name=name)
        db.add(row)
    row.ingredient_name = name
    row.source = "usda_fdc"
    row.source_food_id = str(source.get("fdc_id") or "")
    row.source_food_name = source.get("description")
    row.nutrients = profile._asdict()
    row.raw_result = source
    row.fetched_at = now
    row.expires_at = now + timedelta(days=_cache_ttl_days())
    return profile


def _resolve_profile(name: str, db: Session | None) -> tuple[NutrientProfile | None, str]:
    for candidate in _ingredient_name_candidates(name):
        profile = _cache_profile(db, candidate)
        if profile:
            return profile, "cache"
    for candidate in _ingredient_name_candidates(name):
        profile = _refresh_cache_profile(db, candidate)
        if profile:
            return profile, "usda_fdc"
    for candidate in _ingredient_name_candidates(name):
        profile = _cache_profile(db, candidate, allow_expired=True)
        if profile:
            return profile, "stale_cache"
    for candidate in _ingredient_name_candidates(name):
        profile = _lookup(candidate)
        if profile:
            return profile, "heuristic"
    return None, "unmatched"


def compute_nutrition(components: list[dict], db: Session | None = None) -> dict:
    """
    Aggregates nutrition across all ingredients in all components.
    Returns totals plus a list of ingredients that couldn't be matched,
    so the UI can show 'partial data' honestly instead of a false-precision number.
    """
    totals = {field: 0.0 for field in NutrientProfile._fields}
    estimated_total_yield_g = 0.0
    unmatched: list[str] = []
    issues: list[dict] = []
    sources: set[str] = set()

    for component in components:
        for ing in component.get("ingredients", []):
            macros, source = _resolve_profile(ing["name"], db)
            grams = _ingredient_grams(ing)
            if grams is not None:
                estimated_total_yield_g += grams

            if macros is None or grams is None:
                unmatched.append(ing["name"])
                if grams is None:
                    issues.append({
                        "ingredient": ing["name"],
                        "reason": "missing_grams",
                        "suggestion": "Add a canonical gram quantity for this ingredient, then refresh nutrition.",
                    })
                elif macros is None:
                    issues.append({
                        "ingredient": ing["name"],
                        "reason": "no_nutrition_profile",
                        "suggestion": "Refresh nutrition with USDA configured, simplify the ingredient name, or add a local nutrition fallback.",
                    })
                continue
            if source != "heuristic":
                sources.add(source)
            else:
                sources.add("heuristic")

            factor = grams / 100.0
            for field in NutrientProfile._fields:
                totals[field] += getattr(macros, field) * factor

    return {
        **{field: round(value, 2) for field, value in totals.items()},
        "unmatched_ingredients": unmatched,
        "nutrition_issues": issues,
        "estimated_total_yield_g": round(estimated_total_yield_g, 1) if estimated_total_yield_g > 0 else None,
        "data_completeness": "partial" if unmatched else "complete",
        "nutrition_sources": sorted(sources),
        "cache_expires_days": _cache_ttl_days() if db is not None and _nutrition_api_key() else None,
    }
