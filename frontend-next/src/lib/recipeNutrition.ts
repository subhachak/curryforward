import type { Ingredient, RecipeComponent, RecipeDetail } from "@/lib/types";

export function ingredientGrams(ingredient: Ingredient): number | null {
  if (ingredient.gram_amount != null) return ingredient.gram_amount;
  if (ingredient.gram_equivalent != null) return ingredient.gram_equivalent;
  if ((ingredient.unit || "").toLowerCase() === "g") return ingredient.amount;
  return null;
}

export function estimatedYieldGramsFromComponents(components: RecipeComponent[]): number | null {
  let total = 0;
  let hasMeasuredIngredient = false;

  for (const component of components) {
    for (const ingredient of component.ingredients) {
      const grams = ingredientGrams(ingredient);
      if (grams == null) continue;
      total += grams;
      hasMeasuredIngredient = true;
    }
  }

  return hasMeasuredIngredient ? Math.round(total * 10) / 10 : null;
}

export function estimatedRecipeYieldGrams(recipe: RecipeDetail): number | null {
  const fromNutrition = recipe.nutrition.estimated_total_yield_g;
  if (fromNutrition != null && fromNutrition > 0) return fromNutrition;

  const fromIngredients = estimatedYieldGramsFromComponents(recipe.components);
  if (fromIngredients != null && fromIngredients > 0) return fromIngredients;

  if ((recipe.base_servings.unit || "").toLowerCase() === "g" && recipe.base_servings.amount) {
    return recipe.base_servings.amount;
  }

  return null;
}

export function nutritionServingGrams(recipe: RecipeDetail): number {
  const amount = recipe.serving_size.amount;
  if (amount != null && amount > 0) return amount;
  return 100;
}
