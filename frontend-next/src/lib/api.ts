import type {
  AdminRecipeSummary,
  AdminAssistantResult,
  AdminAuditLog,
  AutoResearchPlan,
  ChatApplyResult,
  ChatHistoryTurn,
  ChatProposal,
  ChatResult,
  CopyRewriteResult,
  DraftRecipeResult,
  DraftSummary,
  EditDraftResult,
  LLMSettingsResponse,
  LLMUsageResponse,
  ModelOption,
  PendingRecipeFeedback,
  RecipeDetail,
  RecipeFeedback,
  RecipeFeedbackList,
  RecipeImportCommitResult,
  RecipeImportPreview,
  RecipeImportRow,
  RecipeResearchDetail,
  ResearchJobSummary,
  RecipeSummary,
  RecipeWideEditResult,
  RecipeUpsertRequest,
  ResearchPatchPayload,
  Role,
  SiteAnalytics,
  TrashedRecipeSummary,
} from "./types";

export class ApiError extends Error {}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(body.detail || "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => apiFetch<{ role: Role; display_name?: string | null }>("/me"),
  login: (password: string) =>
    apiFetch<{ role: Role; display_name?: string | null }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => apiFetch<{ role: Role; display_name?: string | null }>("/auth/logout", { method: "POST" }),

  listRecipes: () => apiFetch<RecipeSummary[]>("/recipes"),
  getRecipe: (recipeId: string) => apiFetch<RecipeDetail>(`/recipes/${recipeId}`),
  listRecipeFeedback: (recipeId: string) => apiFetch<RecipeFeedbackList>(`/recipes/${recipeId}/feedback`),
  createRecipeFeedback: (recipeId: string, body: { author_name?: string; rating?: number | null; comment: string; parent_feedback_id?: string | null }) =>
    apiFetch<RecipeFeedback>(`/recipes/${recipeId}/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getHistory: (recipeId: string) => apiFetch<RecipeDetail[]>(`/recipes/${recipeId}/history`),
  likeRecipe: (recipeId: string) =>
    apiFetch<{ like_count: number }>(`/recipes/${recipeId}/like`, { method: "POST" }),
  unlikeRecipe: (recipeId: string) =>
    apiFetch<{ like_count: number }>(`/recipes/${recipeId}/like`, { method: "DELETE" }),
  forkRecipe: (recipeId: string) =>
    apiFetch<RecipeDetail>(`/recipes/${recipeId}/fork`, { method: "POST" }),
  createRecipe: (req: RecipeUpsertRequest) =>
    apiFetch<RecipeDetail>("/recipes", { method: "POST", body: JSON.stringify(req) }),
  deleteRecipe: (recipeId: string) =>
    apiFetch<{ deleted: string }>(`/recipes/${recipeId}`, { method: "DELETE" }),
  resetRecipeIngredientsToGrams: (recipeId: string) =>
    apiFetch<RecipeDetail>(`/recipes/${recipeId}/ingredients/reset-grams`, { method: "POST" }),
  chat: (recipeId: string, message: string, history: ChatHistoryTurn[] = []) =>
    apiFetch<ChatResult>(`/recipes/${recipeId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
  applyChatCustomization: (recipeId: string, proposal: ChatProposal, changeSummary: string) =>
    apiFetch<ChatApplyResult>(`/recipes/${recipeId}/chat/apply`, {
      method: "POST",
      body: JSON.stringify({ ...proposal, change_summary: changeSummary }),
    }),
  draftRecipe: (message: string, history: ChatHistoryTurn[] = [], draft: DraftRecipeResult | null = null) =>
    apiFetch<DraftRecipeResult>("/recipes/draft", {
      method: "POST",
      body: JSON.stringify({ message, history, draft }),
    }),

  // Agentic recipe research workspace — admin-only.
  startResearch: (prompt: string, model?: string) =>
    apiFetch<RecipeResearchDetail>("/recipes/research", {
      method: "POST",
      body: JSON.stringify({ prompt, model }),
    }),
  listDrafts: () => apiFetch<DraftSummary[]>("/recipes/research/drafts"),
  getResearchRecipe: (recipeId: string) =>
    apiFetch<RecipeResearchDetail>(`/recipes/research/${recipeId}`),
  listResearchJobs: (recipeId: string) =>
    apiFetch<ResearchJobSummary[]>(`/recipes/research/${recipeId}/jobs`),
  patchResearch: (recipeId: string, patch: ResearchPatchPayload) =>
    apiFetch<RecipeResearchDetail>(`/recipes/research/${recipeId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  refreshResearchNutrition: (recipeId: string) =>
    apiFetch<RecipeResearchDetail>(`/recipes/research/${recipeId}/nutrition/refresh`, { method: "POST" }),
  publishResearch: (recipeId: string, mode: "keep_both" | "replace_original" = "keep_both") =>
    apiFetch<RecipeDetail>(`/recipes/research/${recipeId}/publish`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  unpublishResearch: (recipeId: string) =>
    apiFetch<RecipeResearchDetail>(`/recipes/research/${recipeId}/unpublish`, { method: "POST" }),

  listModels: () => apiFetch<ModelOption[]>("/models"),
  planAutoResearch: (recipeId: string) =>
    apiFetch<AutoResearchPlan>(`/recipes/research/${recipeId}/auto/plan`, { method: "POST" }),
  runAutoResearch: (recipeId: string, approvedQueries: string[] = []) =>
    apiFetch<RecipeResearchDetail>(`/recipes/research/${recipeId}/auto/run`, {
      method: "POST",
      body: JSON.stringify({ approved_queries: approvedQueries }),
    }),
  cancelAutoResearch: (recipeId: string) =>
    apiFetch<RecipeResearchDetail>(`/recipes/research/${recipeId}/auto/cancel`, { method: "POST" }),
  refineSection: (recipeId: string, section: string, instruction: string) =>
    apiFetch<RecipeResearchDetail>(`/recipes/research/${recipeId}/refine`, {
      method: "POST",
      body: JSON.stringify({ section, instruction }),
    }),
  wideEditRecipe: (recipeId: string, instruction: string) =>
    apiFetch<RecipeWideEditResult>(`/recipes/research/${recipeId}/wide-edit`, {
      method: "POST",
      body: JSON.stringify({ instruction }),
    }),
  askResearchAssistant: (recipeId: string, body: { question: string; history?: ChatHistoryTurn[] }) =>
    apiFetch<AdminAssistantResult>(`/recipes/research/${recipeId}/ask`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rewriteCopy: (
    recipeId: string,
    body: { field_label: string; text: string; instruction?: string; recipe_context?: string }
  ) =>
    apiFetch<CopyRewriteResult>(`/recipes/research/${recipeId}/rewrite`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rewriteAdminCopy: (body: { field_label: string; text: string; instruction?: string; recipe_context?: string }) =>
    apiFetch<CopyRewriteResult>("/admin/rewrite", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Admin dashboard — unified recipe management + trash.
  listAllRecipesAdmin: () => apiFetch<AdminRecipeSummary[]>("/admin/recipes"),
  previewRecipeImport: async (file: File, model?: string): Promise<RecipeImportPreview> => {
    const formData = new FormData();
    formData.append("file", file);
    if (model) formData.append("model", model);
    const res = await fetch("/api/admin/recipes/import/preview", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(body.detail || "Import preview failed");
    }
    return res.json();
  },
  commitRecipeImport: (rows: RecipeImportRow[]) =>
    apiFetch<RecipeImportCommitResult>("/admin/recipes/import/commit", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),
  createEditDraft: (recipeId: string) =>
    apiFetch<EditDraftResult>(`/admin/recipes/${recipeId}/edit-draft`, { method: "POST" }),
  listTrash: () => apiFetch<TrashedRecipeSummary[]>("/admin/recipes/trash"),
  getLLMSettings: () => apiFetch<LLMSettingsResponse>("/admin/llm-settings"),
  getLLMUsage: () => apiFetch<LLMUsageResponse>("/admin/llm-usage"),
  getSiteAnalytics: () => apiFetch<SiteAnalytics>("/admin/site-analytics"),
  getAuditLog: () => apiFetch<AdminAuditLog[]>("/admin/audit-log"),
  updateLLMSetting: (key: string, model: string) =>
    apiFetch<{ key: string; model: string; updated_at: string | null }>(`/admin/llm-settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ model }),
    }),
  listPendingFeedback: () => apiFetch<PendingRecipeFeedback[]>("/admin/feedback/pending"),
  decideFeedback: (feedbackId: string, approved: boolean) =>
    apiFetch<RecipeFeedback>(`/admin/feedback/${feedbackId}/decide`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
  restoreRecipe: (recipeId: string) =>
    apiFetch<RecipeDetail>(`/admin/recipes/${recipeId}/restore`, { method: "POST" }),
  purgeRecipe: (recipeId: string) =>
    apiFetch<{ purged: string }>(`/admin/recipes/${recipeId}/purge`, { method: "DELETE" }),
  // Plain URL for an <a href download> — native browser download, not a fetch
  // call, so cookies flow automatically and there's no blob juggling.
  downloadRecipe: (recipeId: string) => `/api/recipes/${recipeId}/download`,

  uploadImage: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/uploads", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(body.detail || "Upload failed");
    }
    return res.json();
  },
};
