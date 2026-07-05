"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModelPicker } from "@/components/research/ModelPicker";
import { CopyAssistField } from "@/components/research/CopyAssistField";
import { RecipeManagementTable } from "@/components/admin/RecipeManagementTable";
import { TrashPanel } from "@/components/admin/TrashPanel";
import { Card, CardBody } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, LogOutIcon, PlusIcon, SendIcon, XIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRecipes } from "@/context/RecipesContext";
import { api, ApiError } from "@/lib/api";
import type {
  AdminAuditLog,
  AdminRecipeSummary,
  LLMSettingsResponse,
  LLMUsageResponse,
  PendingRecipeFeedback,
  TrashedRecipeSummary,
} from "@/lib/types";

type WorkspaceTab = "recipes" | "research" | "feedback" | "trash" | "analytics" | "models";
type RecipeStatusFilter = "all" | "published" | "draft";

const tabs: { id: WorkspaceTab; label: string }[] = [
  { id: "recipes", label: "All recipes" },
  { id: "research", label: "Research new recipe" },
  { id: "feedback", label: "Feedback" },
  { id: "trash", label: "Trash" },
  { id: "analytics", label: "Analytics" },
  { id: "models", label: "Models" },
];

export default function AdminPage() {
  const { isAdmin, loading: authLoading, logout } = useAuth();
  const { reload: reloadRecipes } = useRecipes();
  const { push } = useToast();
  const router = useRouter();

  const [pendingFeedback, setPendingFeedback] = useState<PendingRecipeFeedback[]>([]);
  const [loadingFeedback, setLoadingFeedback] = useState(true);
  const [llmSettings, setLLMSettings] = useState<LLMSettingsResponse | null>(null);
  const [loadingLLMSettings, setLoadingLLMSettings] = useState(true);
  const [llmUsage, setLLMUsage] = useState<LLMUsageResponse | null>(null);
  const [auditLog, setAuditLog] = useState<AdminAuditLog[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
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

  const loadFeedbackQueue = useCallback(async () => {
    setLoadingFeedback(true);
    try {
      setPendingFeedback(await api.listPendingFeedback());
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Failed to load feedback review", "error");
    } finally {
      setLoadingFeedback(false);
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

  const loadLLMSettings = useCallback(async () => {
    setLoadingLLMSettings(true);
    try {
      setLLMSettings(await api.getLLMSettings());
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Failed to load model settings", "error");
    } finally {
      setLoadingLLMSettings(false);
    }
  }, [push]);

  const loadAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    try {
      const [usage, audit] = await Promise.all([api.getLLMUsage(), api.getAuditLog()]);
      setLLMUsage(usage);
      setAuditLog(audit);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Failed to load analytics", "error");
    } finally {
      setLoadingAnalytics(false);
    }
  }, [push]);

  useEffect(() => {
    if (isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadFeedbackQueue();
      loadRecipeManagement();
      loadLLMSettings();
      loadAnalytics();
    }
  }, [isAdmin, loadAnalytics, loadFeedbackQueue, loadLLMSettings, loadRecipeManagement]);

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

  async function handleFeedbackDecided() {
    await loadFeedbackQueue();
  }

  async function handleRecipesChanged() {
    await Promise.all([loadRecipeManagement(), reloadRecipes()]);
  }

  const pendingFeedbackCount = pendingFeedback.length;
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
          <p className="text-sm text-muted">Manage recipes, research drafts, feedback, analytics, and cleanup.</p>
        </div>
        <IconButton label="Log out" icon={<LogOutIcon />} onClick={handleLogout} />
      </div>

      <div className="grid gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatTile label="Total recipes" value={adminRecipes.length} />
        <StatTile label="Published" value={publishedCount} />
        <StatTile label="Drafts" value={draftCount} />
        <StatTile label="Feedback" value={pendingFeedbackCount} />
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

      {activeTab === "feedback" && (
        <FeedbackTab
          loadingFeedback={loadingFeedback}
          pendingFeedback={pendingFeedback}
          onFeedbackDecided={handleFeedbackDecided}
        />
      )}

      {activeTab === "trash" && (
        <TrashTab loading={loadingRecipes} recipes={trash} onChanged={handleRecipesChanged} />
      )}

      {activeTab === "analytics" && (
        <AnalyticsTab
          topRecipes={topRecipes}
          draftCount={draftCount}
          pendingFeedback={pendingFeedbackCount}
          trashCount={trash.length}
          loadingAnalytics={loadingAnalytics}
          llmUsage={llmUsage}
          auditLog={auditLog}
        />
      )}

      {activeTab === "models" && (
        <ModelsTab loading={loadingLLMSettings} settings={llmSettings} onChanged={loadLLMSettings} />
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
            <IconButton label="Research new recipe" icon={<PlusIcon />} size="md" onClick={onStartResearch} />
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
          <CopyAssistField
            fieldLabel="new recipe research prompt"
            value={prompt}
            onChange={onPromptChange}
            placeholder="A dish name, a longer description, or paste a draft recipe to refine..."
            multiline
            rows={8}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ModelPicker value={model} onChange={onModelChange} />
            <IconButton
              type="submit"
              label="Start research"
              icon={<SendIcon />}
              size="md"
              loading={starting}
              disabled={!prompt.trim()}
            />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function FeedbackTab({
  loadingFeedback,
  pendingFeedback,
  onFeedbackDecided,
}: {
  loadingFeedback: boolean;
  pendingFeedback: PendingRecipeFeedback[];
  onFeedbackDecided: () => void;
}) {
  return (
    <div className="max-w-3xl">
      {loadingFeedback ? (
        <Card>
          <CardBody>
            <PageSpinner label="Loading feedback review..." />
          </CardBody>
        </Card>
      ) : (
        <FeedbackReviewPanel items={pendingFeedback} onDecided={onFeedbackDecided} />
      )}
    </div>
  );
}

function FeedbackReviewPanel({
  items,
  onDecided,
}: {
  items: PendingRecipeFeedback[];
  onDecided: () => void;
}) {
  const { push } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function decide(item: PendingRecipeFeedback, approved: boolean) {
    setPendingId(item.feedback_id);
    try {
      await api.decideFeedback(item.feedback_id, approved);
      push(approved ? "Feedback approved" : "Feedback rejected", "success");
      onDecided();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Feedback decision failed", "error");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="font-semibold">Feedback review</div>
        {items.length === 0 ? (
          <div className="mt-2 text-sm text-muted">No flagged comments or reviews waiting for approval.</div>
        ) : (
          <div className="mt-3 space-y-3">
            {items.map((item) => {
              const busy = pendingId === item.feedback_id;
              return (
                <div key={item.feedback_id} className="rounded-md border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{item.recipe_name}</div>
                      <div className="mt-1 text-xs text-muted">
                        {item.author_name || "Anonymous"}
                        {item.rating ? ` · ${item.rating}/5` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <IconButton
                        label="Approve feedback"
                        icon={<CheckIcon />}
                        loading={busy}
                        onClick={() => decide(item, true)}
                      />
                      <IconButton
                        label="Reject feedback"
                        icon={<XIcon />}
                        variant="danger"
                        loading={busy}
                        onClick={() => decide(item, false)}
                      />
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{item.comment}</p>
                  {item.moderation_reason && (
                    <div className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                      {item.moderation_reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
  pendingFeedback,
  trashCount,
  loadingAnalytics,
  llmUsage,
  auditLog,
}: {
  topRecipes: AdminRecipeSummary[];
  draftCount: number;
  pendingFeedback: number;
  trashCount: number;
  loadingAnalytics: boolean;
  llmUsage: LLMUsageResponse | null;
  auditLog: AdminAuditLog[];
}) {
  const totalModelCalls = llmUsage?.summary.reduce((sum, row) => sum + row.call_count, 0) ?? 0;
  const totalTokens = llmUsage?.summary.reduce((sum, row) => sum + row.total_tokens, 0) ?? 0;

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
          {loadingAnalytics ? (
            <PageSpinner label="Loading model usage..." />
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs uppercase text-muted">Logged calls</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{totalModelCalls}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs uppercase text-muted">Tokens</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{totalTokens || "Partial"}</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(llmUsage?.summary ?? []).slice(0, 5).map((row) => (
                  <div
                    key={`${row.task}-${row.model}`}
                    className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{row.task}</div>
                      <div className="truncate text-xs text-muted">{row.model || "unknown model"}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted">
                      <div>{row.call_count} calls</div>
                      <div>{row.total_tokens || "no token data"}</div>
                    </div>
                  </div>
                ))}
                {(llmUsage?.summary ?? []).length === 0 && (
                  <div className="text-sm text-muted">No model calls logged yet.</div>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="font-semibold">Content operations</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <div className="text-2xl font-bold text-ink">{pendingFeedback}</div>
              <div className="text-xs text-muted">feedback</div>
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

      <Card>
        <CardBody>
          <div className="font-semibold">Recent admin activity</div>
          {loadingAnalytics ? (
            <PageSpinner label="Loading audit log..." />
          ) : auditLog.length > 0 ? (
            <div className="mt-3 space-y-2">
              {auditLog.slice(0, 8).map((row) => (
                <div
                  key={row.log_id}
                  className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{row.action.replaceAll("_", " ")}</div>
                    <div className="truncate text-xs text-muted">
                      {[row.target_type, row.target_id].filter(Boolean).join(" · ") || "workspace"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted">{formatDate(row.created_at)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted">No admin actions logged yet.</div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ModelsTab({
  loading,
  settings,
  onChanged,
}: {
  loading: boolean;
  settings: LLMSettingsResponse | null;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function update(key: string, model: string) {
    setSavingKey(key);
    try {
      await api.updateLLMSetting(key, model);
      push("Model default updated", "success");
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Could not update model default", "error");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading || !settings) {
    return (
      <Card>
        <CardBody>
          <PageSpinner label="Loading model settings..." />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Model defaults</div>
            <p className="mt-1 text-sm text-muted">
              Pick the default model for each task. Research drafts can still override these with their own model.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {settings.settings.map((setting) => (
            <div key={setting.key} className="grid gap-3 rounded-md border border-border bg-surface p-3 lg:grid-cols-[1fr_320px]">
              <div>
                <div className="text-sm font-medium text-foreground">{setting.label}</div>
                <div className="mt-1 text-xs text-muted">{setting.description}</div>
                <div className="mt-1 text-xs text-muted">Recommended: {modelLabel(settings, setting.default_model)}</div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={setting.model}
                  onChange={(e) => update(setting.key, e.target.value)}
                  disabled={savingKey === setting.key}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-60"
                  aria-label={`Model for ${setting.label}`}
                >
                  {settings.models.map((model) => (
                    <option
                      key={model.id}
                      value={model.id}
                      disabled={isAnthropicOnlyTask(setting.key) && !model.id.startsWith("anthropic/")}
                    >
                      {model.label}
                      {model.available === false ? " (key missing)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function modelLabel(settings: LLMSettingsResponse, modelId: string) {
  return settings.models.find((model) => model.id === modelId)?.label ?? modelId;
}

function isAnthropicOnlyTask(key: string) {
  return key === "recipe_customize" || key === "recipe_draft" || key === "gap_generation";
}
