"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NutritionCard } from "@/components/NutritionCard";
import { RecipeContent } from "@/components/RecipeContent";
import { RecipeFeedbackPanel } from "@/components/RecipeFeedbackPanel";
import { VersionHistory } from "@/components/VersionHistory";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { CopyIcon, DownloadIcon, RefreshIcon, SparklesIcon } from "@/components/ui/icons";
import { LikeButton } from "@/components/LikeButton";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useAssistant } from "@/context/AssistantContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeDetail } from "@/lib/types";

function RecipeDetailInner() {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const { setOpen, setTarget } = useAssistant();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathSlug = pathname && pathname !== "/recipe" && pathname !== "/recipe/" ? pathname.replace(/^\/+|\/+$/g, "") : null;
  const recipeLookup = searchParams.get("slug") || searchParams.get("id") || pathSlug;

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [history, setHistory] = useState<RecipeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [resettingIngredients, setResettingIngredients] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (recipeLookup) {
        // Version history is an admin/power-user detail — skip fetching it
        // for guests so normal browsing doesn't pay for or show it.
        const [r, h] = await Promise.all([
          api.getRecipe(recipeLookup),
          isAdmin ? api.getHistory(recipeLookup) : Promise.resolve([]),
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
  }, [recipeLookup, isAdmin]);

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

  async function handleResetIngredientsToGrams() {
    if (!recipe) return;
    setResettingIngredients(true);
    try {
      const updated = await api.resetRecipeIngredientsToGrams(recipe.recipe_id);
      setRecipe(updated);
      if (isAdmin) {
        setHistory(await api.getHistory(recipe.recipe_id));
      }
      const missingGrams = updated.components
        .flatMap((component) => component.ingredients)
        .filter((ingredient) => ingredient.gram_amount == null && ingredient.gram_equivalent == null).length;
      push(
        missingGrams
          ? `Ingredients reset. ${missingGrams} ingredient${missingGrams === 1 ? "" : "s"} still need grams.`
          : "Ingredients reset to canonical grams",
        missingGrams ? "info" : "success",
      );
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Ingredient reset failed", "error");
    } finally {
      setResettingIngredients(false);
    }
  }

  if (loading) return <RecipeLoadingState />;

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

  const metadata = recipe.metadata;
  const feedback = recipe.feedback_summary;
  const totalMinutes = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);
  const region = recipe.cuisine_tags[0] ?? recipe.category ?? "Recipe";
  const servingCount = formatServingCount(recipe);

  return (
    <div className="space-y-6 text-[#2E1B14]">
      <Link href="/recipes" className="text-sm font-medium text-[#5A4038] hover:text-[#FF6B00]">
        &larr; Back to recipes
      </Link>

      <section className="grid gap-5 overflow-hidden rounded-md border border-[#FFD2AE] bg-[#FFF1E6] p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_360px] lg:items-stretch">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#5A4038]">
            <Link href="/recipes" className="hover:text-[#FF6B00]">Recipes</Link>
            <span>/</span>
            {recipe.category && <span>{recipe.category}</span>}
            <span>/</span>
            <span className="font-medium text-[#2E1B14]">{recipe.name}</span>
          </div>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight text-[#2E1B14] sm:text-5xl">{recipe.name}</h1>
          {recipe.intro && <p className="max-w-2xl text-lg text-[#5A4038]">{recipe.intro}</p>}
          <div className="flex flex-wrap gap-2">
            {recipe.category && <span className="rounded-full bg-[#F7DDED] px-3 py-1 text-sm font-semibold text-[#5A2145]">{recipe.category}</span>}
            {servingCount && (
              <span className="rounded-full bg-[#DFF3E6] px-3 py-1 text-sm font-semibold text-[#2E9B57]">
                Serves {servingCount}
              </span>
            )}
            {totalMinutes > 0 && (
              <span className="rounded-full bg-[#FFF0C1] px-3 py-1 text-sm font-semibold text-[#7A5200]">
                {formatDuration(totalMinutes)}
              </span>
            )}
            {isAdmin && recipe.status === "draft" && <Badge tone="warning">Draft - not published</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              className="bg-[#FF6B00] text-white shadow-[0_8px_18px_rgba(255,107,0,0.22)] hover:bg-[#E6462D]"
              onClick={() => setOpen(true)}
            >
              <SparklesIcon className="h-4 w-4" />
              Ask assistant
            </Button>
            <LikeButton key={recipe.recipe_id} recipeId={recipe.recipe_id} likeCount={recipe.like_count} />
            <Button variant="secondary" onClick={() => setOpen(true)}>
              <CopyIcon className="h-4 w-4" />
              Copy as new version
            </Button>
            {(recipe.status === "published" || isAdmin) && (
              <IconButton label="Download recipe" icon={<DownloadIcon />} onClick={handleDownload} />
            )}
            {isAdmin && (
              <IconButton
                label="Reset ingredients to grams"
                icon={<RefreshIcon />}
                loading={resettingIngredients}
                onClick={handleResetIngredientsToGrams}
              />
            )}
          </div>
        </div>
        <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-md border border-[#FFD2AE] bg-[#FFF8F1]">
          {recipe.hero_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={recipe.hero_image_url} alt="" className="h-full min-h-72 w-full object-cover" />
          ) : (
            <>
              <div className="absolute left-6 top-8 h-20 w-20 rounded-full border-8 border-[#FFB000]" aria-hidden />
              <div className="absolute bottom-8 right-8 h-16 w-16 rounded-full border-8 border-[#2E9B57]" aria-hidden />
              <div className="absolute right-14 top-12 h-12 w-12 rounded-full bg-[#FFE0DA]" aria-hidden />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/mark-cloche-forward.svg" alt="" className="relative z-10 h-36 w-auto" />
            </>
          )}
        </div>
      </section>

      <ModifyRecipePanel onAsk={() => setOpen(true)} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <RecipeContent recipe={recipe} />

          <RecipeFeedbackPanel recipeId={recipe.recipe_id} />
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4">
            <NutritionCard recipe={recipe} />
            <Card className="border-[#E5C5E0] bg-[#FFF8F1]">
              <CardBody>
                <div className="font-semibold text-[#5A2145]">Version & details</div>
                <dl className="mt-3 space-y-2 text-sm">
                  <MetaRow label="Region" value={region} />
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
                <div className="mt-4 rounded-md bg-[#F7DDED] px-3 py-2 text-xs text-[#5A2145]">
                  Nutrition and metadata are tied to this recipe version.
                </div>
              </CardBody>
            </Card>
            {isAdmin && <VersionHistory versions={history} />}
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

function RecipeLoadingState() {
  return (
    <div className="rounded-md border border-[#FFD2AE] bg-[#FFF8F1] px-4 py-14 text-center">
      <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#FFE7D1]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mark-cloche-forward.svg" alt="" className="h-10 w-auto animate-pulse" />
      </div>
      <PageSpinner label="Opening the cloche..." />
      <p className="mt-2 text-sm text-[#5A4038]">Preparing your recipe.</p>
      <div className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-[1fr_280px]">
        <div className="space-y-3 rounded-md border border-[#FFD2AE] bg-[#FFF1E6] p-4">
          <div className="h-5 w-2/3 rounded bg-[#FFE7D1]" />
          <div className="h-4 w-full rounded bg-[#FFE7D1]" />
          <div className="h-4 w-5/6 rounded bg-[#FFE7D1]" />
        </div>
        <div className="rounded-md border border-[#FFD2AE] bg-white p-4">
          <div className="h-5 w-1/2 rounded bg-[#FFE7D1]" />
          <div className="mt-4 h-12 rounded bg-[#FFE7D1]" />
        </div>
      </div>
    </div>
  );
}

function ModifyRecipePanel({ onAsk }: { onAsk: () => void }) {
  const prompts = ["Make it dairy-free", "Make it spicier", "Reduce calories", "Scale to 6 servings", "Make it vegetarian", "Use chicken thighs"];
  return (
    <section className="rounded-md border border-[#E5C5E0] bg-[#F7DDED] p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[220px_1fr_auto] lg:items-center">
        <div>
          <div className="text-lg font-bold text-[#5A2145]">Modify this recipe</div>
          <p className="mt-1 text-sm text-[#6B3A5A]">Ask CurryForward to adapt this dish.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {prompts.map((prompt, index) => {
            const colors = [
              "bg-[#DFF3E6] text-[#2E9B57]",
              "bg-[#FFE0DA] text-[#E6462D]",
              "bg-[#FFF0C1] text-[#7A5200]",
              "bg-[#FFE7D1] text-[#B84600]",
              "bg-[#DFF3E6] text-[#2E9B57]",
              "bg-[#FFF8F1] text-[#5A2145]",
            ];
            return (
              <button key={prompt} type="button" onClick={onAsk} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${colors[index]}`}>
                {prompt}
              </button>
            );
          })}
        </div>
        <Button className="bg-[#5A2145] text-white hover:bg-[#E6462D]" onClick={onAsk}>
          Ask CurryForward
        </Button>
      </div>
    </section>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "Not published";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

function formatServingCount(recipe: RecipeDetail) {
  const baseAmount = recipe.base_servings.amount;
  const baseUnit = recipe.base_servings.unit?.trim().toLowerCase();
  const servingSizeAmount = recipe.serving_size.amount;
  const servingSizeUnit = recipe.serving_size.unit?.trim().toLowerCase();

  if (baseAmount && baseUnit === "g" && servingSizeAmount && servingSizeUnit === "g") {
    const count = Math.max(1, Math.round(baseAmount / servingSizeAmount));
    return count.toString();
  }

  if (baseAmount && baseUnit && baseUnit !== "g") {
    return `${formatCount(baseAmount)} ${recipe.base_servings.unit}`;
  }

  return null;
}

function formatCount(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1).replace(/\.0$/, "");
}

export default function RecipeDetailPage() {
  return (
    <Suspense fallback={<RecipeLoadingState />}>
      <RecipeDetailInner />
    </Suspense>
  );
}
