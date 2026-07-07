from datetime import datetime, timedelta, timezone
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.db import SessionLocal, init_db
from app.models import IngredientNutritionCache
from app import nutrition
from app.nutrition import compute_nutrition


def test_compute_nutrition_uses_cached_ingredient_profile():
    os.environ.pop("USDA_FDC_API_KEY", None)
    os.environ.pop("USDA_API_KEY", None)
    init_db()
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        db.merge(
            IngredientNutritionCache(
                cache_key="test ingredient",
                ingredient_name="test ingredient",
                source="usda_fdc",
                source_food_id="123",
                source_food_name="USDA Test Ingredient",
                nutrients={
                    "calories": 100,
                    "protein_g": 10,
                    "fat_g": 5,
                    "carbs_g": 20,
                    "saturated_fat_g": 1,
                    "trans_fat_g": 0,
                    "cholesterol_mg": 2,
                    "sodium_mg": 3,
                    "fiber_g": 4,
                    "sugars_g": 5,
                    "added_sugars_g": 1,
                    "vitamin_d_mcg": 0,
                    "calcium_mg": 10,
                    "iron_mg": 1,
                    "potassium_mg": 20,
                },
                raw_result={},
                fetched_at=now,
                expires_at=now + timedelta(days=30),
            )
        )
        db.commit()

        result = compute_nutrition(
            [{"component_name": "main", "ingredients": [{"name": "test ingredient", "amount": 200, "unit": "g"}]}],
            db,
        )

        assert result["calories"] == 200
        assert result["protein_g"] == 20
        assert result["nutrition_sources"] == ["cache"]
        assert result["data_completeness"] == "complete"
    finally:
        db.close()


def test_compute_nutrition_refreshes_existing_cache_row_without_duplicate(monkeypatch):
    os.environ["USDA_FDC_API_KEY"] = "test-key"
    init_db()
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        db.merge(
            IngredientNutritionCache(
                cache_key="duplicate proof ingredient",
                ingredient_name="duplicate proof ingredient",
                source="usda_fdc",
                source_food_id="old",
                source_food_name="Old cached item",
                nutrients={},
                raw_result={},
                fetched_at=now - timedelta(days=400),
                expires_at=now - timedelta(days=1),
            )
        )
        db.commit()

        def fake_fetch(name):
            profile = nutrition.NutrientProfile(
                calories=123,
                protein_g=4,
                fat_g=5,
                carbs_g=6,
                saturated_fat_g=1,
                trans_fat_g=0,
                cholesterol_mg=0,
                sodium_mg=7,
                fiber_g=1,
                sugars_g=2,
                added_sugars_g=0,
                vitamin_d_mcg=0,
                calcium_mg=8,
                iron_mg=1,
                potassium_mg=9,
            )
            return profile, {"fdc_id": "new", "description": name, "nutrients": profile._asdict()}

        monkeypatch.setattr(nutrition, "_fetch_usda_profile", fake_fetch)

        result = compute_nutrition(
            [{"component_name": "main", "ingredients": [{"name": "duplicate proof ingredient", "amount": 100, "unit": "g"}]}],
            db,
        )
        db.commit()

        row = db.get(IngredientNutritionCache, "duplicate proof ingredient")
        assert result["calories"] == 123
        assert row.source_food_id == "new"
        assert db.query(IngredientNutritionCache).filter_by(cache_key="duplicate proof ingredient").count() == 1
    finally:
        db.close()
        os.environ.pop("USDA_FDC_API_KEY", None)


def test_compute_nutrition_handles_imported_units_and_gram_options():
    os.environ.pop("USDA_FDC_API_KEY", None)
    os.environ.pop("USDA_API_KEY", None)

    result = compute_nutrition(
        [
            {
                "component_name": "main",
                "ingredients": [
                    {
                        "name": "Unsalted butter at room temperature",
                        "amount": 3,
                        "unit": "Cup",
                        "unit_options": [{"amount": 678, "unit": "Gram"}],
                    },
                    {
                        "name": "Granulated sugar",
                        "amount": None,
                        "unit": "Cup",
                        "unit_options": [{"amount": 450, "unit": "Gram"}],
                    },
                    {"name": "Vanilla extract", "amount": 1.5, "unit": "Teaspoon"},
                ],
            }
        ]
    )

    assert result["calories"] > 6000
    assert result["fat_g"] > 500
    assert result["carbs_g"] > 400
    assert result["unmatched_ingredients"] == []


def test_compute_nutrition_matches_common_pantry_aliases_without_usda_key():
    os.environ.pop("USDA_FDC_API_KEY", None)
    os.environ.pop("USDA_API_KEY", None)

    result = compute_nutrition(
        [
            {
                "component_name": "main",
                "ingredients": [
                    {"name": "Salt", "amount": 5, "unit": "g"},
                    {"name": "Black pepper", "amount": 2, "unit": "g"},
                    {"name": "Double (heavy) cream", "amount": 120, "unit": "g"},
                    {"name": "Worcestershire sauce", "amount": 20, "unit": "g"},
                ],
            }
        ]
    )

    assert result["unmatched_ingredients"] == []
    assert result["nutrition_issues"] == []
    assert result["sodium_mg"] > 1900
    assert result["fat_g"] > 40


def test_compute_nutrition_reports_missing_grams_separately_from_profile_match():
    os.environ.pop("USDA_FDC_API_KEY", None)
    os.environ.pop("USDA_API_KEY", None)

    result = compute_nutrition(
        [
            {
                "component_name": "main",
                "ingredients": [
                    {"name": "Black pepper", "amount": None, "unit": "g"},
                ],
            }
        ]
    )

    assert result["unmatched_ingredients"] == ["Black pepper"]
    assert result["nutrition_issues"] == [
        {
            "ingredient": "Black pepper",
            "reason": "missing_grams",
            "suggestion": "Add a canonical gram quantity for this ingredient, then refresh nutrition.",
        }
    ]


def test_compute_nutrition_reuses_pending_cache_row_for_duplicate_keys(monkeypatch):
    os.environ["USDA_FDC_API_KEY"] = "test-key"
    init_db()
    db = SessionLocal()
    calls: list[str] = []
    db.query(IngredientNutritionCache).filter_by(cache_key="heavy cream").delete()
    db.commit()

    def fake_fetch(name: str):
        calls.append(name)
        profile = nutrition.NutrientProfile(
            calories=100,
            protein_g=1,
            fat_g=2,
            carbs_g=3,
            saturated_fat_g=0,
            trans_fat_g=0,
            cholesterol_mg=0,
            sodium_mg=0,
            fiber_g=0,
            sugars_g=0,
            added_sugars_g=0,
            vitamin_d_mcg=0,
            calcium_mg=0,
            iron_mg=0,
            potassium_mg=0,
        )
        return profile, {"fdc_id": "same", "description": name, "nutrients": profile._asdict()}

    monkeypatch.setattr(nutrition, "_fetch_usda_profile", fake_fetch)
    try:
        result = compute_nutrition(
            [
                {
                    "component_name": "main",
                    "ingredients": [
                        {"name": "Double cream", "amount": 100, "unit": "g"},
                        {"name": "Heavy cream", "amount": 100, "unit": "g"},
                    ],
                }
            ],
            db,
        )
        db.commit()

        assert result["calories"] == 200
        assert result["nutrition_sources"] == ["cache", "usda_fdc"]
        assert db.query(IngredientNutritionCache).filter_by(cache_key="heavy cream").count() == 1
        assert len(calls) == 1
    finally:
        db.close()
        os.environ.pop("USDA_FDC_API_KEY", None)
