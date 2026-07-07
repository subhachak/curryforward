export type Role = "admin" | "guest";

export interface Ingredient {
  ingredient_id?: string;
  name: string;
  amount: number | null;
  unit: string;
  gram_amount?: number | null;
  display_unit?: string | null;
  gram_equivalent?: number | null;
  unit_options?: IngredientUnitOption[];
}

export interface IngredientUnitOption {
  amount: number | null;
  unit: string;
  label?: string | null;
}

export interface RecipeComponent {
  component_name: string;
  ingredients: Ingredient[];
}

export interface RecipeStep {
  step_number?: number;
  component_ref?: string | null;
  instruction: string;
  image_url?: string | null;
}

export interface Nutrition {
  calories?: number;
  protein_g?: number;
  fat_g?: number;
  carbs_g?: number;
  saturated_fat_g?: number;
  trans_fat_g?: number;
  cholesterol_mg?: number;
  sodium_mg?: number;
  fiber_g?: number;
  sugars_g?: number;
  added_sugars_g?: number;
  vitamin_d_mcg?: number;
  calcium_mg?: number;
  iron_mg?: number;
  potassium_mg?: number;
  data_completeness?: "complete" | "partial";
  unmatched_ingredients?: string[];
  nutrition_issues?: { ingredient: string; reason: string; suggestion: string }[];
  estimated_total_yield_g?: number | null;
  nutrition_sources?: string[];
  cache_expires_days?: number | null;
}

export interface RecipeSummary {
  recipe_id: string;
  public_slug?: string | null;
  version_id: string;
  name: string;
  category: string | null;
  cuisine_tags: string[];
  lineage: string;
  source: string;
  hero_image_url: string | null;
  created_at: string | null;
  intro: string | null;
  // Only present for admin callers.
  status?: "draft" | "published";
  like_count: number;
}

/** GET /api/admin/recipes — the unified published+draft dashboard list. */
export interface AdminRecipeSummary {
  recipe_id: string;
  public_slug?: string | null;
  admin_ref?: string | null;
  version_id: string;
  name: string;
  category: string | null;
  status: "draft" | "published";
  lineage: string;
  hero_image_url: string | null;
  intro: string | null;
  first_published_at: string | null;
  updated_at: string | null;
  view_count: number;
  download_count: number;
  like_count: number;
}

/** GET /api/admin/recipes/trash — soft-deleted recipes awaiting restore/purge. */
export interface TrashedRecipeSummary {
  recipe_id: string;
  public_slug?: string | null;
  admin_ref?: string | null;
  version_id: string;
  name: string;
  category: string | null;
  deleted_at: string | null;
}

export interface RecipeDetail {
  version_id: string;
  recipe_id: string;
  public_slug?: string | null;
  parent_version_id: string | null;
  lineage: string;
  name: string;
  category: string | null;
  cuisine_tags: string[];
  hero_image_url: string | null;
  base_servings: { amount: number | null; unit: string };
  serving_count?: number | null;
  serving_size: { amount: number | null; unit: string | null };
  components: RecipeComponent[];
  steps: RecipeStep[];
  nutrition: Nutrition;
  intro: string | null;
  history: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  tips: string[];
  watch_outs: string[];
  suggested_utensils: string[];
  pan_conversions: PanConversion[];
  status: "draft" | "published";
  source: string;
  is_current_head: boolean;
  created_at: string | null;
  updated_at: string | null;
  metadata?: RecipeMetadata | null;
  feedback_summary?: RecipeFeedbackSummary | null;
  like_count: number;
}

export interface RecipeMetadata {
  first_published_at: string | null;
  last_published_at: string | null;
  current_version_published_at: string | null;
  last_updated_at: string | null;
  version_count: number;
  current_version_id: string;
}

export interface RecipeFeedbackSummary {
  average_rating: number | null;
  rating_count: number;
  review_count: number;
  comment_count: number;
}

export interface PanConversion {
  from_count: number | null;
  from_size: string;
  to_count: number | null;
  to_size: string;
  note?: string | null;
}

export interface RecipeFeedback {
  feedback_id: string;
  recipe_id: string;
  parent_feedback_id: string | null;
  author_name: string | null;
  rating: number | null;
  comment: string;
  status: "approved" | "pending_review" | "rejected" | string;
  moderation_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  replies?: RecipeFeedback[];
}

export interface PendingRecipeFeedback extends RecipeFeedback {
  recipe_name: string;
}

export interface RecipeFeedbackList extends RecipeFeedbackSummary {
  items: RecipeFeedback[];
}

export interface AdminAuditLog {
  log_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  created_at: string | null;
}

export interface LLMUsageLog {
  usage_id: string;
  task: string;
  model: string | null;
  provider: string | null;
  role: string | null;
  status: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error: string | null;
  created_at: string | null;
}

export interface LLMUsageSummary {
  task: string;
  model: string | null;
  call_count: number;
  total_tokens: number;
}

export interface LLMUsageResponse {
  items: LLMUsageLog[];
  summary: LLMUsageSummary[];
}

/** Admin-only shape — adds the research scratchpad, never sent to guests. */
export interface RecipeResearchDetail extends RecipeDetail {
  admin_ref?: string | null;
  notes: string | null;
  research_conversation: unknown;
  research_model: string | null;
  // The admin's freeform kickoff text — a name, a description, or a full
  // pasted draft recipe. Editable anytime via PATCH, same as `notes`.
  starting_prompt: string | null;
  // Auto-research runs in a background thread — the frontend polls this
  // recipe (via getResearchRecipe) and watches this flip away from
  // "running" instead of awaiting one long request. See routers/research.py.
  auto_research_status: "running" | "error" | null;
  auto_research_error: string | null;
  // Completed section keys so far: history/ingredients/steps/tips/merge.
  auto_research_progress: string[];
}

export const AUTO_RESEARCH_SECTIONS = ["history", "ingredients", "steps", "tips", "merge"] as const;
export type AutoResearchSectionKey = (typeof AUTO_RESEARCH_SECTIONS)[number];

export interface ModelOption {
  id: string;
  label: string;
  provider_env_var: string;
  provider?: string;
  available?: boolean;
  provider_env_vars?: string[];
}

export interface LLMTaskSetting {
  key: string;
  label: string;
  description: string;
  default_model: string;
  model: string;
}

export interface LLMSettingsResponse {
  settings: LLMTaskSetting[];
  models: ModelOption[];
}

export interface SearchQueryItem {
  query: string;
  category: string;
}

export interface AutoResearchPlan {
  plan: string;
  queries: SearchQueryItem[];
}

export interface CopyRewriteResult {
  text: string;
}

export interface ResearchJobSummary {
  job_id: string;
  recipe_id: string;
  model: string | null;
  approved_queries: string[];
  search_results: { query: string; result: string }[];
  status: "running" | "completed" | "error" | "cancelled" | "superseded";
  progress: string[];
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
}

export interface EditDraftResult {
  draft: RecipeResearchDetail;
  created: boolean;
  note: string;
}

export interface RecipeImportRow {
  sheet_name: string | null;
  row_number: number;
  name: string;
  category: string | null;
  cuisine_tags: string[];
  base_servings_amount: number | null;
  base_servings_unit: string;
  intro: string | null;
  history: string | null;
  components: RecipeComponent[];
  steps: RecipeStep[];
  tips: string[];
  watch_outs: string[];
  source_url: string | null;
  issues: string[];
}

export interface RecipeImportPreview {
  rows: RecipeImportRow[];
  valid_count: number;
  issue_count: number;
  source: "ai" | "heuristic";
  model: string | null;
  ai_error: string | null;
  file_type: "xlsx" | "csv";
}

export interface RecipeImportCommitResult {
  created: { recipe_id: string; admin_ref?: string | null; name: string; sheet_name: string | null; row_number: number }[];
  skipped: { sheet_name: string | null; row_number: number; name: string; issues: string[] }[];
}

export interface DraftSummary {
  recipe_id: string;
  admin_ref?: string | null;
  public_slug?: string | null;
  version_id: string;
  name: string;
  category: string | null;
  status: "draft" | "published";
  updated_at: string | null;
}

export interface RecipeWideEditResult {
  recipe: RecipeResearchDetail;
  changed_fields: string[];
  review_notes: string | null;
}

export interface AdminAssistantResult {
  reply: string;
}

/** Partial direct-edit payload for PATCH /api/recipes/research/{id} — every
 * field optional, sent fields are applied (including explicit nulls, which
 * clear that field). */
export type ResearchPatchPayload = Partial<{
  name: string;
  category: string | null;
  cuisine_tags: string[];
  base_servings_amount: number | null;
  base_servings_unit: string;
  serving_count?: number | null;
  serving_size_amount?: number | null;
  serving_size_unit?: string | null;
  components: RecipeComponent[];
  steps: RecipeStep[];
  intro: string | null;
  history: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  tips: string[];
  watch_outs: string[];
  suggested_utensils: string[];
  pan_conversions: PanConversion[];
  notes: string | null;
  starting_prompt: string | null;
  hero_image_url: string | null;
  model: string | null;
}>;

export interface ChatResult {
  change_summary?: string;
  reply?: string;
  new_version?: RecipeDetail;
  persisted: boolean;
}

export interface RecipeUpsertRequest {
  name: string;
  category: string | null;
  cuisine_tags: string[];
  base_servings_amount: number | null;
  base_servings_unit: string;
  serving_count?: number | null;
  serving_size_amount: number | null;
  serving_size_unit: string | null;
  components: RecipeComponent[];
  steps: RecipeStep[];
  hero_image_url: string | null;
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
  serving_size?: { amount: number | null; unit: string | null };
  components: RecipeComponent[];
  steps: RecipeStep[];
  change_summary: string;
}
