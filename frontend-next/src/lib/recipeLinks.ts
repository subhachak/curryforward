import type { AdminRecipeSummary, RecipeDetail, RecipeResearchDetail, RecipeSummary, TrashedRecipeSummary } from "./types";

type RecipeLike = Pick<RecipeSummary | RecipeDetail | AdminRecipeSummary, "recipe_id"> & {
  public_slug?: string | null;
};

type AdminRecipeLike = Pick<RecipeResearchDetail | AdminRecipeSummary | TrashedRecipeSummary, "recipe_id"> & {
  admin_ref?: string | null;
};

export function publicRecipeHref(recipe: RecipeLike) {
  if (recipe.public_slug) return `/${encodeURIComponent(recipe.public_slug)}`;
  return `/recipe?id=${encodeURIComponent(recipe.recipe_id)}`;
}

export function adminRecipeRef(recipe: AdminRecipeLike) {
  return recipe.admin_ref || recipe.recipe_id;
}

export function adminRecipeHref(recipe: AdminRecipeLike) {
  return `/recipe/research?id=${encodeURIComponent(adminRecipeRef(recipe))}`;
}
