"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { NutritionCard } from "@/components/NutritionCard";
import { VersionHistory } from "@/components/VersionHistory";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useAssistant } from "@/context/AssistantContext";
import { useRecipes } from "@/context/RecipesContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeDetail } from "@/lib/types";
import { lineageLabel } from "@/lib/lineage";

function RecipeDetailInner() {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const { setTarget } = useAssistant();
  const { reload: reloadRecipes } = useRecipes();
  const router = useRouter();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get("id");

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [history, setHistory] = useState<RecipeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (recipeId) {
        const [r, h] = await Promise.all([api.getRecipe(recipeId), api.getHistory(recipeId)]);
        setRecipe(r);
        setHistory(h);
      } else {
        setError("No recipe specified.");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load recipe");
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => {
    // Intentional fetch-on-mount/on-id-change; load() sets loading state
    // before awaiting the network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Register this recipe with the Assistant so chat messages get routed to
  // /recipes/{id}/chat instead of being treated as a search/create request.
  useEffect(() => {
    if (recipe) {
      setTarget({
        recipe,
        onPersisted: load,
        onPreview: (updated) => setRecipe((prev) => (prev ? { ...prev, ...updated } : updated)),
      });
    }
    return () => setTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe]);

  async function handleFork() {
    if (!recipe) return;
    setForking(true);
    try {
      const forked = await api.forkRecipe(recipe.recipe_id);
      push("Forked — you're now viewing the new copy", "success");
      router.push(`/recipe?id=${encodeURIComponent(forked.recipe_id)}`);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Fork failed", "error");
    } finally {
      setForking(false);
    }
  }

  async function handleDelete() {
    if (!recipe) return;
    setDeleting(true);
    try {
      await api.deleteRecipe(recipe.recipe_id);
      push("Recipe deleted", "success");
      await reloadRecipes();
      router.push("/recipes");
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Delete failed", "error");
      setDeleting(false);
    }
  }

  if (loading) return <PageSpinner label="Loading recipe…" />;

  if (error || !recipe) {
    return (
      <div className="space-y-4">
        <Link href="/recipes" className="text-sm text-muted hover:underline">
          &larr; Back to recipes
        </Link>
        <Card>
          <CardBody className="text-center text-muted">{error || "Recipe not found"}</CardBody>
        </Card>
      </div>
    );
  }

  const lineage = lineageLabel(recipe.lineage);

  return (
    <div className="space-y-6">
      <Link href="/recipes" className="text-sm text-muted hover:underline">
        &larr; Back to recipes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{recipe.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              Serves {recipe.base_servings.amount ?? "?"} {recipe.base_servings.unit}
            </span>
            {recipe.category && <Badge tone="neutral">{recipe.category}</Badge>}
            {lineage && <Badge tone="brand">{lineage}</Badge>}
          </div>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/recipe/edit?id=${encodeURIComponent(recipe.recipe_id)}`)}
            >
              Edit
            </Button>
            <Button variant="secondary" size="sm" loading={forking} onClick={handleFork}>
              Fork
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted">Guest mode — forking disabled</span>
        )}
      </div>

      {confirmingDelete && (
        <Card className="border-danger/40 bg-danger-soft/40">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              Permanently delete <strong>{recipe.name}</strong> and all its version history? This
              can&apos;t be undone.
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
                Yes, delete
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {recipe.components.map((c) => (
              <Card key={c.component_name}>
                <CardBody>
                  <div className="mb-2 font-semibold">{c.component_name}</div>
                  <ul className="space-y-1 text-sm">
                    {c.ingredients.map((ing, idx) => (
                      <li key={ing.ingredient_id ?? idx}>
                        {ing.amount ?? "?"} {ing.unit} — {ing.name}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardBody>
              <div className="mb-2 font-semibold">Steps</div>
              <ol className="list-inside list-decimal space-y-2 text-sm">
                {recipe.steps.map((s, idx) => (
                  <li key={idx}>
                    {s.instruction}
                    {s.component_ref && (
                      <span className="ml-1 text-xs text-muted">({s.component_ref})</span>
                    )}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card className="border-dashed">
            <CardBody className="text-sm text-muted">
              Want changes? Use the <span className="font-medium text-foreground">search bar</span>{" "}
              above — it&apos;s already focused on this recipe.
              {!isAdmin && " Guest previews aren't saved."}
            </CardBody>
          </Card>

          <VersionHistory versions={history} />
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <NutritionCard recipe={recipe} />
        </aside>
      </div>
    </div>
  );
}

export default function RecipeDetailPage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading recipe…" />}>
      <RecipeDetailInner />
    </Suspense>
  );
}
