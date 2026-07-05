import type {
  AdminRecipeSummary,
  AutoResearchPlan,
  ChatHistoryTurn,
  ChatResult,
  DraftRecipeResult,
  DraftSummary,
  EditDraftResult,
  ModelOption,
  RecipeDetail,
  RecipeResearchDetail,
  ResearchJobSummary,
  RecipeSummary,
  RecipeUpsertRequest,
  ResearchPatchPayload,
  ResearchTurnResult,
  ReviewQueueItem,
  Role,
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
  me: () => apiFetch<{ role: Role }>("/me"),
  login: (password: string) =>
    apiFetch<{ role: Role }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => apiFetch<{ role: Role }>("/auth/logout", { method: "POST" }),

  listRecipes: () => apiFetch<RecipeSummary[]>("/recipes"),
  getRecipe: (recipeId: string) => apiFetch<RecipeDetail>(`/recipes/${recipeId}`),
  getHistory: (recipeId: string) => apiFetch<RecipeDetail[]>(`/recipes/${recipeId}/history`),
  forkRecipe: (recipeId: string) =>
    apiFetch<RecipeDetail>(`/recipes/${recipeId}/fork`, { method: "POST" }),
  createRecipe: (req: RecipeUpsertRequest) =>
    apiFetch<RecipeDetail>("/recipes", { method: "POST", body: JSON.stringify(req) }),
  deleteRecipe: (recipeId: string) =>
    apiFetch<{ deleted: string }>(`/recipes/${recipeId}`, { method: "DELETE" }),
  chat: (recipeId: string, message: string, history: ChatHistoryTurn[] = []) =>
    apiFetch<ChatResult>(`/recipes/${recipeId}/chat/`, {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
  draftRecipe: (message: string, history: ChatHistoryTurn[] = [], draft: DraftRecipeResult | null = null) =>
    apiFetch<DraftRecipeResult>("/recipes/draft", {
      method: "POST",
      body: JSON.stringify({ message, history, draft }),
    }),

  reviewQueue: () => apiFetch<ReviewQueueItem[]>("/review-queue"),
  decideReview: (itemId: string, approved: boolean) =>
    apiFetch<{ status: string }>(`/review-queue/${itemId}/decide`, {
      method: "POST",
      body: JSON.stringify({ approved }),
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
  researchChat: (
    recipeId: string,
    body: { message?: string; tool_use_id?: string; query?: string; approved?: boolean }
  ) =>
    apiFetch<ResearchTurnResult>(`/recipes/research/${recipeId}/chat/`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchResearch: (recipeId: string, patch: ResearchPatchPayload) =>
    apiFetch<RecipeResearchDetail>(`/recipes/research/${recipeId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
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
  runAutoResearch: (recipeId: string, approvedQueries: string[]) =>
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

  // Admin dashboard — unified recipe management + trash.
  listAllRecipesAdmin: () => apiFetch<AdminRecipeSummary[]>("/admin/recipes"),
  createEditDraft: (recipeId: string) =>
    apiFetch<EditDraftResult>(`/admin/recipes/${recipeId}/edit-draft`, { method: "POST" }),
  listTrash: () => apiFetch<TrashedRecipeSummary[]>("/admin/recipes/trash"),
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
