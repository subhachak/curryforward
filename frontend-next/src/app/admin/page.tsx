"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReviewQueuePanel } from "@/components/ReviewQueuePanel";
import { ModelPicker } from "@/components/research/ModelPicker";
import { RecipeManagementTable } from "@/components/admin/RecipeManagementTable";
import { TrashPanel } from "@/components/admin/TrashPanel";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRecipes } from "@/context/RecipesContext";
import { api, ApiError } from "@/lib/api";
import type { AdminRecipeSummary, ReviewQueueItem, TrashedRecipeSummary } from "@/lib/types";

type WorkspaceTab = "recipes" | "research" | "review" | "trash" | "analytics";
type RecipeStatusFilter = "all" | "published" | "draft";

const tabs: { id: WorkspaceTab; label: string }[] = [
  { id: "recipes", label: "All recipes" },
  { id: "research", label: "Research new recipe" },
  { id: "review", label: "Review queue" },
  { id: "trash", label: "Trash" },
  { id: "analytics", label: "Analytics" },
];

export default function AdminPage() {
  const { isAdmin, loading: authLoading, logout } = useAuth();
  const { reload: reloadRecipes } = useRecipes();
  const { push } = useToast();
  const router = useRouter();

  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [adminRecipes, setAdminRecipes] = useState<AdminRecipeSummary[]>([]);
  const [trash, setTrash] = useState<TrashedRecipeSummary[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(true);
  const [researchPrompt, setResearchPrompt] = useState("");
  const [researchModel, setResearchModel] = useState<string | null>(null);
  const [startingResearch, setStartingResearch] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("recipes");
  const [recipeSearch, setRecipeSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecipeStatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const loadReviewQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      setReviewQueue(await api.reviewQueue());
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Failed to load review queue", "error");
    } finally {
      setLoadingQueue(false);
    }
  }, [push]);

  const loadRecipeManagement = useCallback(async () => {
    setLoadingRecipes(true);
    try {
      const [recipes, trashed] = await Promise.all([api.listAllRecipesAdmin(), api.listTrash()]);
      setAdminRecipes(recipes);
      setTrash(trashed);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Failed to load recipes", "error");
    } finally {
      setLoadingRecipes(false);
    }
  }, [push]);

  useEffect(() => {
    if (isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadReviewQueue();
      loadRecipeManagement();
    }
  }, [isAdmin, loadReviewQueue, loadRecipeManagement]);

  async function handleStartResearch(e: FormEvent) {
    e.preventDefault();
    const prompt = researchPrompt.trim();
    if (!prompt) return;
    setStartingResearch(true);
    try {
      const draft = await api.startResearch(prompt, researchModel ?? undefined);
      router.push(`/recipe/research?id=${encodeURIComponent(draft.recipe_id)}`);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Couldn't start research", "error");
      setStartingResearch(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  async function handleReviewDecided() {
    await Promise.all([loadReviewQueue(), reloadRecipes()]);
  }

  async function handleRecipesChanged() {
    await Promise.all([loadRecipeManagement(), reloadRecipes()]);
  }

  const pendingReviews = reviewQueue.length;
  const draftCount = adminRecipes.filter((r) => r.status === "draft").length;
  const publishedCount = adminRecipes.filter((r) => r.status === "published").length;
  const totalViews = adminRecipes.reduce((sum, r) => sum + r.view_count, 0);
  const totalDownloads = adminRecipes.reduce((sum, r) => sum + r.download_count, 0);
  const categories = useMemo(
    () => Array.from(new Set(adminRecipes.map((r) => r.category).filter(Boolean) as string[])).sort(),
    [adminRecipes]
  );
  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.trim().toLowerCase();
    return adminRecipes.filter((recipe) => {
      const matchesStatus = statusFilter === "all" || recipe.status === statusFilter;
      const matchesCategory = categoryFilter === "all" || recipe.category === categoryFilter;
      const haystack = [recipe.name, recipe.category, recipe.lineage].filter(Boolean).join(" ").toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [adminRecipes, categoryFilter, recipeSearch, statusFilter]);
  const topRecipes = [...adminRecipes]
    .sort((a, b) => b.view_count + b.download_count - (a.view_count + a.download_count))
    .slice(0, 5);

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Workspace</h1>
          <p className="text-sm text-muted">Manage recipes, research drafts, imports, analytics, and cleanup.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </div>

      <div className="grid gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatTile label="Total recipes" value={adminRecipes.length} />
        <StatTile label="Published" value={publishedCount} />
        <StatTile label="Drafts" value={draftCount} />
        <StatTile label="Reviews" value={pendingReviews} />
        <StatTile label="Views" value={totalViews} />
        <StatTile label="Downloads" value={totalDownloads} />
      </div>

      <div className="overflow-x-auto border-b border-border">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-brand text-ink"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "recipes" && (
        <RecipesTab
          loading={loadingRecipes}
          recipes={filteredRecipes}
          totalRecipes={adminRecipes.length}
          search={recipeSearch}
          statusFilter={statusFilter}
          categoryFilter={categoryFilter}
          categories={categories}
          onSearchChange={setRecipeSearch}
          onStatusChange={setStatusFilter}
          onCategoryChange={setCategoryFilter}
          onStartResearch={() => setActiveTab("research")}
          onRecipesChanged={handleRecipesChanged}
        />
      )}

      {activeTab === "research" && (
        <ResearchTab
          prompt={researchPrompt}
          model={researchModel}
          starting={startingResearch}
          onPromptChange={setResearchPrompt}
          onModelChange={setResearchModel}
          onSubmit={handleStartResearch}
        />
      )}

      {activeTab === "review" && (
        <ReviewTab loading={loadingQueue} items={reviewQueue} onDecided={handleReviewDecided} />
      )}

      {activeTab === "trash" && (
        <TrashTab loading={loadingRecipes} recipes={trash} onChanged={handleRecipesChanged} />
      )}

      {activeTab === "analytics" && (
        <AnalyticsTab
          topRecipes={topRecipes}
          draftCount={draftCount}
          pendingReviews={pendingReviews}
          trashCount={trash.length}
        />
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
    </div>
  );
}

function RecipesTab({
  loading,
  recipes,
  totalRecipes,
  search,
  statusFilter,
  categoryFilter,
  categories,
  onSearchChange,
  onStatusChange,
  onCategoryChange,
  onStartResearch,
  onRecipesChanged,
}: {
  loading: boolean;
  recipes: AdminRecipeSummary[];
  totalRecipes: number;
  search: string;
  statusFilter: RecipeStatusFilter;
  categoryFilter: string;
  categories: string[];
  onSearchChange: (value: string) => void;
  onStatusChange: (value: RecipeStatusFilter) => void;
  onCategoryChange: (value: string) => void;
  onStartResearch: () => void;
  onRecipesChanged: () => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardBody>
          <PageSpinner label="Loading recipes..." />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <div className="grid gap-3 lg:grid-cols-[1fr_160px_180px_auto]">
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search recipes..."
              aria-label="Search recipes"
            />
            <select
              value={statusFilter}
              onChange={(e) => onStatusChange(e.target.value as RecipeStatusFilter)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Drafts</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <Button type="button" onClick={onStartResearch}>
              New research
            </Button>
          </div>
          <div className="mt-3 text-sm text-muted">
            Showing {recipes.length} of {totalRecipes} recipes.
          </div>
        </CardBody>
      </Card>
      <RecipeManagementTable recipes={recipes} onChanged={onRecipesChanged} />
    </div>
  );
}

function ResearchTab({
  prompt,
  model,
  starting,
  onPromptChange,
  onModelChange,
  onSubmit,
}: {
  prompt: string;
  model: string | null;
  starting: boolean;
  onPromptChange: (value: string) => void;
  onModelChange: (value: string | null) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Research a new recipe</h2>
          <p className="text-sm text-muted">
            Start with a dish name, a rough idea, or a pasted recipe draft. The agentic editor opens after the draft is
            created.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="A dish name, a longer description, or paste a draft recipe to refine..."
            rows={8}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ModelPicker value={model} onChange={onModelChange} />
            <Button type="submit" loading={starting} disabled={!prompt.trim()}>
              Start research
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ReviewTab({
  loading,
  items,
  onDecided,
}: {
  loading: boolean;
  items: ReviewQueueItem[];
  onDecided: () => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardBody>
          <PageSpinner label="Loading review queue..." />
        </CardBody>
      </Card>
    );
  }
  if (items.length > 0) return <ReviewQueuePanel items={items} onDecided={onDecided} />;
  return (
    <Card>
      <CardBody>
        <div className="font-semibold">Review queue</div>
        <div className="mt-2 text-sm text-muted">No recipes waiting for review.</div>
      </CardBody>
    </Card>
  );
}

function TrashTab({
  loading,
  recipes,
  onChanged,
}: {
  loading: boolean;
  recipes: TrashedRecipeSummary[];
  onChanged: () => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardBody>
          <PageSpinner label="Loading trash..." />
        </CardBody>
      </Card>
    );
  }
  return <TrashPanel recipes={recipes} onChanged={onChanged} />;
}

function AnalyticsTab({
  topRecipes,
  draftCount,
  pendingReviews,
  trashCount,
}: {
  topRecipes: AdminRecipeSummary[];
  draftCount: number;
  pendingReviews: number;
  trashCount: number;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardBody>
          <div className="font-semibold">Recipe engagement</div>
          <div className="mt-3 space-y-3">
            {topRecipes.length > 0 ? (
              topRecipes.map((recipe) => (
                <div
                  key={recipe.recipe_id}
                  className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{recipe.name}</div>
                    <div className="text-xs text-muted">{recipe.status}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted">
                    <div>{recipe.view_count} views</div>
                    <div>{recipe.download_count} downloads</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted">No engagement data yet.</div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="font-semibold">Users</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-surface-muted p-3">
              <div className="text-xs uppercase text-muted">Auth model</div>
              <div className="mt-1 text-lg font-semibold text-ink">1 admin</div>
            </div>
            <div className="rounded-md border border-border bg-surface-muted p-3">
              <div className="text-xs uppercase text-muted">Guest accounts</div>
              <div className="mt-1 text-lg font-semibold text-ink">Not tracked</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">
            User-level analytics need account/session instrumentation before this can show active users or retention.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="font-semibold">Model usage</div>
          <p className="mt-3 text-sm text-muted">
            Research drafts store their selected model, but completed model-call counts and token usage are not logged
            yet. Add request logging before using this for cost reporting.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="font-semibold">Content operations</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <div className="text-2xl font-bold text-ink">{pendingReviews}</div>
              <div className="text-xs text-muted">reviews</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-ink">{draftCount}</div>
              <div className="text-xs text-muted">drafts</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-ink">{trashCount}</div>
              <div className="text-xs text-muted">trashed</div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
