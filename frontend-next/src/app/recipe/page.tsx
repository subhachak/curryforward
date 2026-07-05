"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NutritionCard } from "@/components/NutritionCard";
import { RecipeContent } from "@/components/RecipeContent";
import { RecipeFeedbackPanel } from "@/components/RecipeFeedbackPanel";
import { VersionHistory } from "@/components/VersionHistory";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { DownloadIcon } from "@/components/ui/icons";
import { LikeButton } from "@/components/LikeButton";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useAssistant } from "@/context/AssistantContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeDetail } from "@/lib/types";
import { lineageLabel } from "@/lib/lineage";

function RecipeDetailInner() {
  const { isAdmin } = useAuth();
  const { setTarget } = useAssistant();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get("id");

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [history, setHistory] = useState<RecipeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (recipeId) {
        // Version history is an admin/power-user detail — skip fetching it
        // for guests so normal browsing doesn't pay for or show it.
        const [r, h] = await Promise.all([
          api.getRecipe(recipeId),
          isAdmin ? api.getHistory(recipeId) : Promise.resolve([]),
        ]);
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
  }, [recipeId, isAdmin]);

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

  function handleDownload() {
    if (!recipe) return;
    const a = document.createElement("a");
    a.href = api.downloadRecipe(recipe.recipe_id);
    a.click();
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
  const metadata = recipe.metadata;
  const feedback = recipe.feedback_summary;

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
            {isAdmin && recipe.status === "draft" && <Badge tone="warning">Draft — not published</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LikeButton key={recipe.recipe_id} recipeId={recipe.recipe_id} likeCount={recipe.like_count} />
          {(recipe.status === "published" || isAdmin) && (
            <IconButton label="Download recipe" icon={<DownloadIcon />} onClick={handleDownload} />
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <RecipeContent recipe={recipe} />

          <RecipeFeedbackPanel recipeId={recipe.recipe_id} />

          {isAdmin && (
            <Card className="border-dashed">
              <CardBody className="text-sm text-muted">
                Want changes? Use the <span className="font-medium text-foreground">search bar</span>{" "}
                above — it&apos;s already focused on this recipe.
              </CardBody>
            </Card>
          )}

          {isAdmin && <VersionHistory versions={history} />}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="space-y-4">
            <NutritionCard recipe={recipe} />
            <Card>
              <CardBody>
                <div className="font-semibold">Recipe details</div>
                <dl className="mt-3 space-y-2 text-sm">
                  <MetaRow label="First published" value={formatDate(metadata?.first_published_at)} />
                  <MetaRow label="Last updated" value={formatDate(metadata?.last_updated_at ?? recipe.updated_at)} />
                  <MetaRow label="Versions" value={metadata?.version_count?.toString() ?? "1"} />
                  <MetaRow
                    label="Rating"
                    value={
                      feedback?.average_rating
                        ? `${feedback.average_rating.toFixed(1)} (${feedback.rating_count})`
                        : "Not rated"
                    }
                  />
                </dl>
              </CardBody>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "Not published";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function RecipeDetailPage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading recipe…" />}>
      <RecipeDetailInner />
    </Suspense>
  );
}
