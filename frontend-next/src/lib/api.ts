import type {
  ChatResult,
  GenerateRequest,
  GenerateResult,
  RecipeDetail,
  RecipeSummary,
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
  chat: (recipeId: string, message: string) =>
    apiFetch<ChatResult>(`/recipes/${recipeId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  generateRecipe: (req: GenerateRequest) =>
    apiFetch<GenerateResult>("/recipes/generate", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  reviewQueue: () => apiFetch<ReviewQueueItem[]>("/review-queue"),
  decideReview: (itemId: string, approved: boolean) =>
    apiFetch<{ status: string }>(`/review-queue/${itemId}/decide`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
};
