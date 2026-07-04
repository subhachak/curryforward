export type Role = "admin" | "guest";

export interface Ingredient {
  ingredient_id?: string;
  name: string;
  amount: number | null;
  unit: string;
  gram_equivalent?: number | null;
}

export interface RecipeComponent {
  component_name: string;
  ingredients: Ingredient[];
}

export interface RecipeStep {
  step_number?: number;
  component_ref?: string | null;
  instruction: string;
}

export interface Nutrition {
  calories?: number;
  protein_g?: number;
  fat_g?: number;
  carbs_g?: number;
  data_completeness?: "complete" | "partial";
  unmatched_ingredients?: string[];
}

export interface RecipeSummary {
  recipe_id: string;
  version_id: string;
  name: string;
  category: string | null;
  cuisine_tags: string[];
  lineage: string;
  source: string;
  created_at: string | null;
}

export interface RecipeDetail {
  version_id: string;
  recipe_id: string;
  parent_version_id: string | null;
  lineage: string;
  name: string;
  category: string | null;
  cuisine_tags: string[];
  base_servings: { amount: number | null; unit: string };
  components: RecipeComponent[];
  steps: RecipeStep[];
  nutrition: Nutrition;
  source: string;
  is_current_head: boolean;
  created_at: string | null;
}

export interface ReviewQueueItem {
  item_id: string;
  name: string;
  raw_extraction: Record<string, unknown>;
  review_reason: string | null;
  extraction_confidence: number;
  status: "pending" | "approved" | "rejected";
  created_at: string | null;
}

export interface ChatResult {
  change_summary: string;
  new_version: RecipeDetail;
  persisted: boolean;
  note?: string;
}

export interface RecipeUpsertRequest {
  name: string;
  category: string | null;
  cuisine_tags: string[];
  base_servings_amount: number | null;
  base_servings_unit: string;
  components: RecipeComponent[];
  steps: RecipeStep[];
}

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface DraftRecipeResult {
  name: string;
  category: string | null;
  cuisine_tags: string[];
  base_servings: { amount: number | null; unit: string };
  components: RecipeComponent[];
  steps: RecipeStep[];
  change_summary: string;
}
