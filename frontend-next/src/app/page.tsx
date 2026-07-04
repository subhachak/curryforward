"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RecipeCard } from "@/components/RecipeCard";
import { GenerateRecipePanel } from "@/components/GenerateRecipePanel";
import { ReviewQueuePanel } from "@/components/ReviewQueuePanel";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeSummary, ReviewQueueItem } from "@/lib/types";

function HomeInner() {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") || "").trim().toLowerCase();

  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recipeList, queue] = await Promise.all([
        api.listRecipes(),
        isAdmin ? api.reviewQueue() : Promise.resolve([]),
      ]);
      setRecipes(recipeList);
      setReviewQueue(queue);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Failed to load recipes", "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    // Intentional fetch-on-mount/on-role-change; load() sets loading state
    // before awaiting the network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!query) return recipes;
    return recipes.filter((r) =>
      [r.name, r.category ?? "", r.lineage, r.source].some((field) =>
        field.toLowerCase().includes(query)
      )
    );
  }, [recipes, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your recipes</h1>
        <p className="text-sm text-muted">
          Seeded, generated, and customized through chat.
        </p>
      </div>

      <GenerateRecipePanel />

      {isAdmin && <ReviewQueuePanel items={reviewQueue} onDecided={load} />}

      {loading ? (
        <PageSpinner label="Loading recipes…" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-muted">
          {query ? `No recipes match "${query}".` : "No recipes yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <RecipeCard key={r.recipe_id} recipe={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading recipes…" />}>
      <HomeInner />
    </Suspense>
  );
}
