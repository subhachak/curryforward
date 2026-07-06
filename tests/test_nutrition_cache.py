from datetime import datetime, timedelta, timezone
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.db import SessionLocal, init_db
from app.models import IngredientNutritionCache
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
