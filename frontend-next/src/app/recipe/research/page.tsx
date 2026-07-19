"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ResearchDocumentPreview } from "@/components/research/ResearchDocumentPreview";
import { Card, CardBody } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, CopyIcon, RefreshIcon, SendIcon, XIcon } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRecipes } from "@/context/RecipesContext";
import { api, ApiError } from "@/lib/api";
import { publicRecipeHref } from "@/lib/recipeLinks";
import type { ResearchPatchPayload, RecipeResearchDetail } from "@/lib/types";

type WorkspaceMode = "edit" | "review";

const sectionAnchors = [
  { id: "section-details", label: "Details" },
  { id: "section-ingredients", label: "Ingredients" },
  { id: "section-steps", label: "Steps" },
  { id: "section-tips", label: "Tips" },
];

function ResearchWorkspaceInner() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { push } = useToast();
  const { reload: reloadRecipes } = useRecipes();
  const router = useRouter();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get("id");

  const [recipe, setRecipe] = useState<RecipeResearchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [refreshingNutrition, setRefreshingNutrition] = useState(false);
  const [mode, setMode] = useState<WorkspaceMode>("edit");
  const [wideEditPrompt, setWideEditPrompt] = useState("");
  const [wideEditing, setWideEditing] = useState(false);
  const [reviewHighlights, setReviewHighlights] = useState<string[]>([]);
  const [reviewNotes, setReviewNotes] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (recipe) setTitleDraft(recipe.name);
  }, [recipe?.name, recipe?.version_id]);

  const load = useCallback(async () => {
    if (!recipeId) {
      setError("No recipe specified.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.getResearchRecipe(recipeId);
      setRecipe(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load this recipe");
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleCommit(patch: ResearchPatchPayload) {
    if (!recipeId) return;
    setSaveStatus("saving");
    try {
      const updated = await api.patchResearch(recipeId, patch);
      setRecipe(updated);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      push(e instanceof ApiError ? e.message : "Save failed", "error");
    }
  }

  async function handleRefreshNutrition() {
    if (!recipeId) return;
    setRefreshingNutrition(true);
    try {
      const updated = await api.refreshResearchNutrition(recipeId);
      setRecipe(updated);
      setSaveStatus("saved");
      const hasComputedNutrients = [
        updated.nutrition.calories,
        updated.nutrition.protein_g,
        updated.nutrition.fat_g,
        updated.nutrition.carbs_g,
        updated.nutrition.sodium_mg,
      ].some((value) => (value ?? 0) > 0);
      const sources = updated.nutrition.nutrition_sources?.length
        ? ` (${updated.nutrition.nutrition_sources.join(", ")})`
        : "";
      push(
        hasComputedNutrients
          ? `Nutrition facts refreshed${sources}`
          : "Nutrition refreshed, but no usable values could be calculated yet.",
        hasComputedNutrients ? "success" : "info"
      );
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Nutrition refresh failed", "error");
    } finally {
      setRefreshingNutrition(false);
    }
  }

  async function handleRefineSection(section: string, instruction: string) {
    if (!recipeId) return;
    try {
      const updated = await api.refineSection(recipeId, section, instruction);
      setRecipe(updated);
      push("Section refined", "success");
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Refinement failed", "error");
    }
  }

  async function handleWideEdit(instructionOverride?: string) {
    if (!recipeId) return;
    const instruction = (instructionOverride ?? wideEditPrompt).trim();
    if (!instruction) return;
    setWideEditing(true);
    try {
      const result = await api.wideEditRecipe(recipeId, instruction);
      setRecipe(result.recipe);
      setReviewHighlights(result.changed_fields);
      setReviewNotes(result.review_notes);
      if (!instructionOverride) setWideEditPrompt("");
      setSaveStatus("saved");
      push(`Updated ${result.changed_fields.length || 0} section${result.changed_fields.length === 1 ? "" : "s"} for review`, "success");
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Recipe-wide edit failed", "error");
    } finally {
      setWideEditing(false);
    }
  }

  async function handlePublish(mode: "keep_both" | "replace_original" = "keep_both") {
    if (!recipeId) return;
    setPublishing(true);
    try {
      const published = await api.publishResearch(recipeId, mode);
      await reloadRecipes();
      push(mode === "replace_original" ? "Original recipe replaced" : "Published — this recipe is now visible to guests", "success");
      router.push(publicRecipeHref(published));
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Publish failed", "error");
    } finally {
      setPublishing(false);
      setConfirmingPublish(false);
    }
  }

  if (authLoading) return <PageSpinner />;

  if (!isAdmin) {
    return (
      <Card>
        <CardBody className="text-center text-muted">
          Log in to access this section.{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
          .
        </CardBody>
      </Card>
    );
  }

  if (loading) return <PageSpinner label="Loading research session…" />;

  if (error || !recipe) {
    return (
      <Card>
        <CardBody className="text-center text-muted">{error || "Recipe not found"}</CardBody>
      </Card>
    );
  }

  const canPublish = Boolean(recipe.name && recipe.components.length && recipe.steps.length);
  const isDraft = recipe.status === "draft";
  const isLinkedEditDraft = isDraft && recipe.source === "revision_draft" && Boolean(recipe.parent_version_id);
  const hasUnmatchedNutrition = Boolean(recipe.nutrition.unmatched_ingredients?.length);
  const publishChecks = [
    { label: "Name", done: Boolean(recipe.name) },
    { label: "Ingredients", done: recipe.components.length > 0 },
    { label: "Steps", done: recipe.steps.length > 0 },
    { label: "Intro", done: Boolean(recipe.intro) },
    { label: "Timing", done: recipe.prep_time_minutes != null || recipe.cook_time_minutes != null },
    { label: "Image", done: Boolean(recipe.hero_image_url) },
    { label: "Nutrition reviewed", done: !hasUnmatchedNutrition },
  ];
  const issues = [
    !recipe.hero_image_url ? "No hero image" : null,
    !recipe.intro ? "Intro is missing" : null,
    recipe.serving_size.amount != null && recipe.serving_size.amount < 10 ? "Serving size looks very low" : null,
    recipe.nutrition.nutrition_issues?.length ? `${recipe.nutrition.nutrition_issues.length} nutrition item${recipe.nutrition.nutrition_issues.length === 1 ? "" : "s"} need review` : null,
    hasUnmatchedNutrition ? `${recipe.nutrition.unmatched_ingredients?.length || 0} ingredient${(recipe.nutrition.unmatched_ingredients?.length || 0) === 1 ? "" : "s"} missing from nutrition` : null,
  ].filter(Boolean) as string[];
  const showReviewRail = isDraft && mode === "edit";
  const previewMode = mode === "review";
  const shellGridClass = showReviewRail ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]" : "space-y-4";

  return (
    <div className="space-y-4">
      <div className="sticky top-16 z-20 rounded-lg border border-border bg-background/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href="/admin" className="text-sm text-muted hover:underline">
              &larr; Back to Workspace
            </Link>
            {isDraft ? (
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  const trimmed = titleDraft.trim();
                  if (trimmed && trimmed !== recipe.name) void handleCommit({ name: trimmed });
                  else setTitleDraft(recipe.name);
                }}
                aria-label="Recipe title"
                className="-mx-1 mt-2 w-full max-w-xl truncate rounded-md border border-transparent bg-transparent px-1 text-2xl font-bold text-ink transition-colors hover:border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
              />
            ) : (
              <h1 className="mt-2 truncate text-2xl font-bold text-ink">{recipe.name}</h1>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={isDraft ? "neutral" : "success"}>{isDraft ? "Draft" : "Published"}</Badge>
              <span>{isDraft ? saveStatus === "saving" ? "Saving..." : saveStatus === "error" ? "Save failed" : "Saved" : "Read-only"}</span>
              {recipe.updated_at && <span>Last edited {new Date(recipe.updated_at).toLocaleString()}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isDraft ? (
              <>
                <div
                  className="relative grid h-11 w-44 grid-cols-2 rounded-full border border-border bg-surface p-1 text-sm shadow-inner"
                  role="switch"
                  aria-checked={previewMode}
                  aria-label="Toggle recipe editor mode"
                >
                  <span
                    className={`absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-full bg-brand shadow-sm transition-transform duration-200 ${
                      previewMode ? "translate-x-full" : "translate-x-0"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setMode("edit")}
                    className={`relative z-10 rounded-full px-3 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 ${
                      !previewMode ? "text-ink" : "text-muted hover:text-foreground"
                    }`}
                    aria-pressed={!previewMode}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("review")}
                    className={`relative z-10 rounded-full px-3 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 ${
                      previewMode ? "text-ink" : "text-muted hover:text-foreground"
                    }`}
                    aria-pressed={previewMode}
                  >
                    Review
                  </button>
                </div>
                <IconButton
                  label="Refresh nutrition facts"
                  icon={<RefreshIcon />}
                  loading={refreshingNutrition}
                  onClick={handleRefreshNutrition}
                />
                <IconButton
                  label="Publish"
                  icon={<SendIcon />}
                  disabled={!canPublish}
                  onClick={() => setConfirmingPublish(true)}
                />
              </>
            ) : (
              <IconButton label="Back to dashboard" icon={<XIcon />} onClick={() => router.push("/admin")} />
            )}
          </div>
        </div>
        {isDraft && !previewMode && (
          <nav className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3" aria-label="Jump to section">
            {sectionAnchors.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() =>
                  document.getElementById(section.id)?.scrollIntoView({ behavior: "auto", block: "start" })
                }
                className="rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                {section.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {!isDraft && (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="text-muted">
              Published recipes are read-only here. Start edits from the admin dashboard to create a draft copy.
            </div>
            <IconButton label="Open dashboard" icon={<XIcon />} onClick={() => router.push("/admin")} />
          </CardBody>
        </Card>
      )}

      {confirmingPublish && (
        <Card className="border-brand/40 bg-brand-soft/40">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              {isLinkedEditDraft ? (
                <>
                  Publish <strong>{recipe.name}</strong>? Choose whether this draft replaces the original recipe or becomes a separate recipe.
                </>
              ) : (
                <>
                  Publish <strong>{recipe.name}</strong>? It becomes visible to everyone browsing the site.
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <IconButton label="Cancel publish" icon={<XIcon />} onClick={() => setConfirmingPublish(false)} />
              {isLinkedEditDraft && (
                <IconButton
                  label="Keep both versions"
                  icon={<CopyIcon />}
                  loading={publishing}
                  onClick={() => handlePublish("keep_both")}
                />
              )}
              <IconButton
                label={isLinkedEditDraft ? "Replace original" : "Publish recipe"}
                icon={<CheckIcon />}
                loading={publishing}
                onClick={() => handlePublish(isLinkedEditDraft ? "replace_original" : "keep_both")}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {isDraft ? (
        <div className={shellGridClass}>
          <main className="min-w-0 space-y-4">
            {!previewMode && (
              <Card className={reviewHighlights.length ? "border-brand/50 bg-brand-soft/30" : ""}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-ink">Recipe-wide AI edit</div>
                      <div className="text-xs text-muted">Apply one broad instruction across the draft, then review highlighted sections.</div>
                    </div>
                    {reviewHighlights.length > 0 && (
                      <IconButton
                        label="Clear review highlights"
                        icon={<CheckIcon />}
                        onClick={() => {
                          setReviewHighlights([]);
                          setReviewNotes(null);
                        }}
                      />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Textarea
                      value={wideEditPrompt}
                      onChange={(e) => setWideEditPrompt(e.target.value)}
                      rows={3}
                      placeholder="Make this recipe keto friendly; make it kid friendly; turn it into a weeknight version..."
                    />
                    <IconButton
                      label="Apply recipe-wide edit"
                      icon={<SendIcon />}
                      loading={wideEditing}
                      disabled={!wideEditPrompt.trim()}
                      onClick={() => void handleWideEdit()}
                    />
                  </div>
                  {(reviewHighlights.length > 0 || reviewNotes) && (
                    <div className="rounded-md border border-brand/30 bg-surface px-3 py-2 text-xs text-muted">
                      {reviewHighlights.length > 0 && (
                        <div>
                          Review: <span className="font-medium text-foreground">{reviewHighlights.join(", ")}</span>
                        </div>
                      )}
                      {reviewNotes && <div className="mt-1">{reviewNotes}</div>}
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
            <ResearchDocumentPreview
              key={`${recipe.version_id}:${recipe.updated_at}`}
              recipe={recipe}
              previewMode={previewMode}
              onCommit={handleCommit}
              onRefine={handleRefineSection}
              onModifyRecipe={(instruction) => handleWideEdit(instruction)}
              onRefreshNutrition={isDraft ? handleRefreshNutrition : undefined}
              refreshingNutrition={refreshingNutrition}
              highlightedFields={reviewHighlights}
              onClearHighlights={() => {
                setReviewHighlights([]);
                setReviewNotes(null);
              }}
            />
          </main>

          {showReviewRail && (
            <aside className="space-y-3 xl:sticky xl:top-40 xl:max-h-[calc(100vh-11rem)] xl:overflow-auto">
              <Card>
                <CardBody className="space-y-3">
                  <div>
                    <div className="font-semibold text-ink">Recipe readiness</div>
                    <div className="text-xs text-muted">Publish checks, issues, and final actions.</div>
                  </div>
                  <div className="space-y-2">
                    {publishChecks.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
                        <span>{item.label}</span>
                        <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Ready" : "Needs review"}</Badge>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardBody className="space-y-3">
                  <div className="font-semibold text-ink">Issues detected</div>
                  {issues.length ? (
                    <ul className="space-y-2 text-sm text-muted">
                      {issues.map((issue) => (
                        <li key={issue} className="rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2">
                          {issue}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">No blocking issues detected.</div>
                  )}
                  <IconButton
                    label="Refresh nutrition facts"
                    icon={<RefreshIcon />}
                    loading={refreshingNutrition}
                    onClick={handleRefreshNutrition}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardBody className="space-y-3">
                  <div className="font-semibold text-ink">Publish</div>
                  <div className="text-sm text-muted">
                    {canPublish ? "Ready when your review is complete." : "Name, ingredients, and steps are required before publishing."}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <IconButton label="Preview" icon={<CheckIcon />} onClick={() => setMode("review")} />
                    <IconButton
                      label="Publish"
                      icon={<SendIcon />}
                      disabled={!canPublish}
                      onClick={() => setConfirmingPublish(true)}
                    />
                  </div>
                </CardBody>
              </Card>
            </aside>
          )}
        </div>
      ) : (
        <ResearchDocumentPreview
          key={`${recipe.version_id}:${recipe.updated_at}`}
          recipe={recipe}
          previewMode
          onCommit={() => undefined}
          onRefine={async () => undefined}
          highlightedFields={[]}
          onClearHighlights={() => undefined}
        />
      )}
    </div>
  );
}

export default function ResearchWorkspacePage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <ResearchWorkspaceInner />
    </Suspense>
  );
}
