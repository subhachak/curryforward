import type {
  ChatHistoryTurn,
  ChatResult,
  DraftRecipeResult,
  RecipeDetail,
  RecipeSummary,
  RecipeUpsertRequest,
  ReviewQueueItem,
  Role,
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
  updateRecipe: (recipeId: string, req: RecipeUpsertRequest) =>
    apiFetch<RecipeDetail>(`/recipes/${recipeId}`, { method: "PUT", body: JSON.stringify(req) }),
  deleteRecipe: (recipeId: string) =>
    apiFetch<{ deleted: string }>(`/recipes/${recipeId}`, { method: "DELETE" }),
  chat: (recipeId: string, message: string, history: ChatHistoryTurn[] = []) =>
    apiFetch<ChatResult>(`/recipes/${recipeId}/chat`, {
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
};
