"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { NutritionCard } from "@/components/NutritionCard";
import { ChatPanel } from "@/components/ChatPanel";
import { VersionHistory } from "@/components/VersionHistory";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeDetail } from "@/lib/types";

const GUEST_PREVIEW_KEY = "guest_generated_preview";

function RecipeDetailInner() {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get("id");
  const isPreview = searchParams.get("preview") === "1";

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [history, setHistory] = useState<RecipeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isPreview) {
        const raw = sessionStorage.getItem(GUEST_PREVIEW_KEY);
        if (!raw) {
          setError("This preview has expired — generate the recipe again.");
          return;
        }
        setRecipe(JSON.parse(raw));
        setHistory([]);
      } else if (recipeId) {
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
  }, [recipeId, isPreview]);

  useEffect(() => {
    // Intentional fetch-on-mount/on-id-change; load() sets loading state
    // before awaiting the network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

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

  if (loading) return <PageSpinner label="Loading recipe…" />;

  if (error || !recipe) {
    return (
      <div className="space-y-4">
        <Link href="/" className="text-sm text-muted hover:underline">
          &larr; Back to recipes
        </Link>
        <Card>
          <CardBody className="text-center text-muted">{error || "Recipe not found"}</CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted hover:underline">
        &larr; Back to recipes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{recipe.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              Base: {recipe.base_servings.amount ?? "?"} {recipe.base_servings.unit}
            </span>
            <Badge tone="neutral">{recipe.lineage}</Badge>
            {!isPreview && <span>version {recipe.version_id}</span>}
          </div>
        </div>
        {isPreview ? (
          <Badge tone="warning">Guest preview — not saved</Badge>
        ) : isAdmin ? (
          <Button variant="secondary" size="sm" loading={forking} onClick={handleFork}>
            Fork this recipe
          </Button>
        ) : (
          <span className="text-xs text-muted">Guest mode — forking disabled</span>
        )}
      </div>

      <NutritionCard nutrition={recipe.nutrition} />

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

      {isPreview ? (
        <Card>
          <CardBody className="text-sm text-muted">
            This generated recipe is a one-off preview — log in as admin to generate and save
            real recipes, or browse an existing recipe to customize it via chat.
          </CardBody>
        </Card>
      ) : (
        <ChatPanel
          recipeId={recipe.recipe_id}
          onPersisted={load}
          onPreview={(updated) => setRecipe((prev) => (prev ? { ...prev, ...updated } : updated))}
        />
      )}

      <VersionHistory versions={history} />
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
