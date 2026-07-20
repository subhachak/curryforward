"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AutoResearchPanel } from "@/components/research/AutoResearchPanel";
import { CopyAssistField } from "@/components/research/CopyAssistField";
import { RecipeManagementTable } from "@/components/admin/RecipeManagementTable";
import { TrashPanel } from "@/components/admin/TrashPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import {
  CheckIcon,
  EyeIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  UploadIcon,
  XIcon,
} from "@/components/ui/icons";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRecipes } from "@/context/RecipesContext";
import { api, ApiError } from "@/lib/api";
import { adminRecipeHref, adminRecipeRef } from "@/lib/recipeLinks";
import type {
  AdminAuditLog,
  AdminRecipeSummary,
  LLMSettingsResponse,
  LLMUsageResponse,
  PendingRecipeFeedback,
  RecipeImportPreview,
  RecipeImportRow,
  RecipeResearchDetail,
  SiteAnalytics,
  TrashedRecipeSummary,
} from "@/lib/types";

type WorkspaceTab = "dashboard" | "recipes" | "research" | "feedback" | "trash" | "analytics" | "models";
type RecipeStatusFilter = "all" | "published" | "draft";
type ImportStatus = { tone: "info" | "success" | "warning" | "error"; text: string } | null;

const tabs: { id: WorkspaceTab; label: string }[] = [
  { id: "dashboard", label: "Overview" },
  { id: "recipes", label: "Recipes" },
  { id: "research", label: "Create recipe" },
  { id: "feedback", label: "Feedback" },
  { id: "trash", label: "Trash" },
  { id: "analytics", label: "Analytics" },
  { id: "models", label: "Models" },
];

const navGroups: { label: string; tabs: WorkspaceTab[] }[] = [
  { label: "Content", tabs: ["dashboard", "recipes", "research", "feedback"] },
  { label: "Operations", tabs: ["analytics", "models", "trash"] },
];

const tabCopy: Record<WorkspaceTab, { title: string; description: string }> = {
  dashboard: {
    title: "Workspace overview",
    description: "Here’s what needs attention across CurryForward.",
  },
  recipes: {
    title: "All recipes",
    description: "Manage published recipes, drafts, edit copies, and operational cleanup.",
  },
  research: {
    title: "New recipe",
    description: "Create a recipe draft from a prompt, pasted recipe, web research, or spreadsheet.",
  },
  feedback: {
    title: "Feedback",
    description: "Approve, reject, and monitor AI-flagged ratings, reviews, and comments.",
  },
  trash: {
    title: "Trash",
    description: "Restore deleted drafts or permanently remove recipe records.",
  },
  analytics: {
    title: "Analytics",
    description: "Track recipe engagement, model usage, content operations, and admin activity.",
  },
  models: {
    title: "Models",
    description: "Set default models for public, admin, import, and research workflows.",
  },
};

const promptExamples = [
  "Create a Bengali mutton kosha recipe",
  "Research a classic patishapta recipe",
  "Convert this recipe to a lower-sugar version",
  "Make a traditional nolen gur sandesh",
];

const modelGroups = [
  {
    title: "Public experience",
    description: "Guest-facing AI behavior and recipe Q&A.",
    keys: ["recipe_context_chat", "recipe_customize"],
  },
  {
    title: "Recipe creation",
    description: "Draft generation, research planning, and broader recipe edits.",
    keys: ["recipe_draft", "gap_generation", "research_plan", "auto_research_crew", "recipe_wide_edit", "admin_assistant"],
  },
  {
    title: "Admin cleanup",
    description: "Moderation, extraction, and focused copy refinement.",
    keys: ["feedback_moderation", "dish_name_extraction", "copy_rewrite", "section_refine"],
  },
  {
    title: "Imports",
    description: "Spreadsheet and CSV mapping into draft recipes.",
    keys: ["recipe_import"],
  },
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
  const [siteAnalytics, setSiteAnalytics] = useState<SiteAnalytics | null>(null);
  const [auditLog, setAuditLog] = useState<AdminAuditLog[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [adminRecipes, setAdminRecipes] = useState<AdminRecipeSummary[]>([]);
  const [trash, setTrash] = useState<TrashedRecipeSummary[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(true);
  const [researchPrompt, setResearchPrompt] = useState("");
  const [startingResearch, setStartingResearch] = useState(false);
  const [activeResearchDraft, setActiveResearchDraft] = useState<RecipeResearchDetail | null>(null);
  const [importPreview, setImportPreview] = useState<RecipeImportPreview | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>(null);
  const [importing, setImporting] = useState(false);
  const [previewingImport, setPreviewingImport] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => {
    if (typeof window === "undefined") return "dashboard";
    const requested = new URLSearchParams(window.location.search).get("tab");
    return tabs.some((t) => t.id === requested) ? (requested as WorkspaceTab) : "dashboard";
  });
  const [workspaceSearch, setWorkspaceSearch] = useState("");
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
      const [usage, audit, site] = await Promise.all([api.getLLMUsage(), api.getAuditLog(), api.getSiteAnalytics()]);
      setLLMUsage(usage);
      setAuditLog(audit);
      setSiteAnalytics(site);
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
    let draft: RecipeResearchDetail | null = null;
    try {
      draft = await api.startResearch(prompt);
      // A new research prompt is already the user's intent to run the crew;
      // don't make them confirm that intent with a second click.
      setResearchPrompt("");
      const started = await api.runAutoResearch(adminRecipeRef(draft));
      setActiveResearchDraft(started);
    } catch (e) {
      // If draft creation succeeded but launching failed, keep the draft on
      // screen so the admin can retry instead of losing their prompt.
      if (draft) setActiveResearchDraft(draft);
      push(e instanceof ApiError ? e.message : "Couldn't start research", "error");
    } finally {
      setStartingResearch(false);
    }
  }

  function handleResearchComplete(updated: RecipeResearchDetail) {
    setActiveResearchDraft(updated);
    push("Research complete — opening the editor for review", "success");
    router.push(adminRecipeHref(updated));
  }

  async function handleImportPreview(file: File) {
    setPreviewingImport(true);
    setImportStatus({ tone: "info", text: `Reading ${file.name}...` });
    try {
      const preview = await api.previewRecipeImport(file);
      setImportPreview(preview);
      setImportStatus({
        tone: preview.valid_count > 0 ? "success" : "warning",
        text: `Previewed ${preview.rows.length} row${preview.rows.length === 1 ? "" : "s"} from ${file.name}: ${
          preview.valid_count
        } ready, ${preview.issue_count} need cleanup.`,
      });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Import preview failed";
      setImportPreview(null);
      setImportStatus({ tone: "error", text: message });
      push(message, "error");
    } finally {
      setPreviewingImport(false);
    }
  }

  async function handleImportCommit(rows: RecipeImportRow[]) {
    setImporting(true);
    setImportStatus({ tone: "info", text: "Importing valid rows as draft recipes..." });
    try {
      const result = await api.commitRecipeImport(rows);
      push(`Imported ${result.created.length} draft recipe${result.created.length === 1 ? "" : "s"}`, "success");
      setImportPreview(null);
      setImportStatus({
        tone: result.created.length > 0 ? "success" : "warning",
        text: `Imported ${result.created.length} draft recipe${result.created.length === 1 ? "" : "s"}. ${
          result.skipped.length
        } row${result.skipped.length === 1 ? "" : "s"} skipped.`,
      });
      await handleRecipesChanged();
      setActiveTab("recipes");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Import failed";
      setImportStatus({ tone: "error", text: message });
      push(message, "error");
    } finally {
      setImporting(false);
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
    const q = workspaceSearch.trim().toLowerCase();
    return adminRecipes.filter((recipe) => {
      const matchesStatus = statusFilter === "all" || recipe.status === statusFilter;
      const matchesCategory = categoryFilter === "all" || recipe.category === categoryFilter;
      const haystack = [recipe.name, recipe.category, recipe.status, recipe.lineage, recipe.intro].filter(Boolean).join(" ").toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [adminRecipes, categoryFilter, statusFilter, workspaceSearch]);
  const filteredFeedback = useMemo(() => {
    const q = workspaceSearch.trim().toLowerCase();
    if (!q) return pendingFeedback;
    return pendingFeedback.filter((item) =>
      [item.recipe_name, item.author_name, item.comment, item.moderation_reason]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [pendingFeedback, workspaceSearch]);
  const filteredTrash = useMemo(() => {
    const q = workspaceSearch.trim().toLowerCase();
    if (!q) return trash;
    return trash.filter((recipe) => [recipe.name, recipe.category].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [trash, workspaceSearch]);
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

  const activeCopy = tabCopy[activeTab];
  const searchPlaceholder = getSearchPlaceholder(activeTab);
  const showSearch = ["recipes", "feedback", "trash", "models"].includes(activeTab);
  const navCounts: Partial<Record<WorkspaceTab, number>> = {
    recipes: adminRecipes.length,
    feedback: pendingFeedbackCount,
    trash: trash.length,
  };

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="grid gap-6 lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-white p-3 shadow-sm lg:sticky lg:top-5 lg:flex lg:h-[calc(100vh-2.5rem)] lg:flex-col lg:self-start">
          <div className="flex items-center justify-between px-2 py-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">CurryForward</div>
              <div className="mt-0.5 font-semibold text-ink">Workspace</div>
            </div>
            <Link href="/" aria-label="View live site" className="rounded-md p-2 text-muted transition hover:bg-surface-muted hover:text-ink">
              <EyeIcon className="h-4 w-4" />
            </Link>
          </div>

          <nav className="mt-4 flex gap-2 overflow-x-auto lg:block lg:space-y-5 lg:overflow-visible" aria-label="Workspace navigation">
            {navGroups.map((group) => (
              <div key={group.label} className="shrink-0">
                <div className="mb-1 hidden px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted lg:block">{group.label}</div>
                <div className="flex gap-1 lg:flex-col">
                  {group.tabs.map((tabId) => {
                    const tab = tabs.find((item) => item.id === tabId)!;
                    const count = navCounts[tab.id];
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(tab.id);
                          setWorkspaceSearch("");
                        }}
                        className={`flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 ${
                          activeTab === tab.id
                            ? "bg-ink text-white dark:text-[#211411]"
                            : "text-muted hover:bg-surface-muted hover:text-foreground"
                        }`}
                      >
                        <span>{tab.label}</span>
                        {count !== undefined && count > 0 && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeTab === tab.id ? "bg-black/10 text-current" : "bg-surface-muted text-muted"}`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-auto hidden border-t border-border pt-3 lg:block">
            <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-muted hover:text-foreground">
              <LogOutIcon className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </aside>

        <main className="min-w-0 space-y-5 py-1">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">{activeCopy.title}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted">{activeCopy.description}</p>
            </div>
            {activeTab !== "research" && (
              <Button onClick={() => setActiveTab("research")}>
                <PlusIcon className="h-4 w-4" />
                New recipe
              </Button>
            )}
          </div>

          {showSearch && (
            <label className="flex max-w-xl items-center gap-2 rounded-md border border-border bg-white px-3 py-2.5 text-sm text-muted shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
              <SearchIcon className="h-4 w-4" />
              <input
                value={workspaceSearch}
                onChange={(e) => setWorkspaceSearch(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted focus:outline-none"
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
              {workspaceSearch && (
                <button type="button" onClick={() => setWorkspaceSearch("")} aria-label="Clear search" className="rounded p-1 hover:bg-surface-muted">
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
          )}

          {activeTab === "recipes" && (
            <RecipeFilterBar
              statusFilter={statusFilter}
              categoryFilter={categoryFilter}
              categories={categories}
              onStatusChange={setStatusFilter}
              onCategoryChange={setCategoryFilter}
            />
          )}

      {activeTab === "dashboard" && (
        <DashboardTab
          recipes={adminRecipes}
          publishedCount={publishedCount}
          draftCount={draftCount}
          pendingFeedbackCount={pendingFeedbackCount}
          trashCount={trash.length}
          auditLog={auditLog}
          loadingAnalytics={loadingAnalytics}
          onNavigate={setActiveTab}
        />
      )}

      {activeTab === "recipes" && (
        <RecipesTab
          loading={loadingRecipes}
          recipes={filteredRecipes}
          totalRecipes={adminRecipes.length}
          onRecipesChanged={handleRecipesChanged}
        />
      )}

      {activeTab === "research" && (
        <NewRecipeTab
          prompt={researchPrompt}
          starting={startingResearch}
          preview={importPreview}
          importStatus={importStatus}
          previewingImport={previewingImport}
          importing={importing}
          onPromptChange={setResearchPrompt}
          onSubmit={handleStartResearch}
          activeDraft={activeResearchDraft}
          onResearchComplete={handleResearchComplete}
          onPreview={handleImportPreview}
          onImport={handleImportCommit}
          onClear={() => {
            setImportPreview(null);
            setImportStatus(null);
          }}
        />
      )}

      {activeTab === "feedback" && (
        <FeedbackTab
          loadingFeedback={loadingFeedback}
          pendingFeedback={filteredFeedback}
          totalFeedback={pendingFeedback.length}
          onFeedbackDecided={handleFeedbackDecided}
        />
      )}

      {activeTab === "trash" && (
        <TrashTab loading={loadingRecipes} recipes={filteredTrash} totalRecipes={trash.length} onChanged={handleRecipesChanged} />
      )}

      {activeTab === "analytics" && (
        <AnalyticsTab
          topRecipes={topRecipes}
          totalViews={totalViews}
          totalDownloads={totalDownloads}
          loadingAnalytics={loadingAnalytics}
          llmUsage={llmUsage}
          siteAnalytics={siteAnalytics}
          auditLog={auditLog}
        />
      )}

      {activeTab === "models" && (
        <ModelsTab loading={loadingLLMSettings} settings={llmSettings} searchQuery={workspaceSearch} onChanged={loadLLMSettings} />
      )}
        </main>
        </div>
    </div>
  );
}

function DashboardTab({
  recipes,
  publishedCount,
  draftCount,
  pendingFeedbackCount,
  trashCount,
  auditLog,
  loadingAnalytics,
  onNavigate,
}: {
  recipes: AdminRecipeSummary[];
  publishedCount: number;
  draftCount: number;
  pendingFeedbackCount: number;
  trashCount: number;
  auditLog: AdminAuditLog[];
  loadingAnalytics: boolean;
  onNavigate: (tab: WorkspaceTab) => void;
}) {
  const drafts = recipes.filter((recipe) => recipe.status === "draft");
  const published = recipes.filter((recipe) => recipe.status === "published");
  const publishedMissingHero = published.filter((recipe) => !recipe.hero_image_url);
  const missingIntro = recipes.filter((recipe) => !recipe.intro?.trim());
  const staleDrafts = drafts.filter((recipe) => isOlderThanDays(recipe.updated_at, 14));
  const activeDrafts = [...drafts]
    .sort((a, b) => timestampValue(b.updated_at) - timestampValue(a.updated_at))
    .slice(0, 6);

  const attentionItems = [
    {
      label: "Drafts waiting review",
      detail: "Open the draft queue and move publishable recipes forward.",
      value: draftCount,
      tab: "recipes" as WorkspaceTab,
      tone: "warning",
    },
    {
      label: "Feedback pending approval",
      detail: "AI-screened reviews and comments need an admin decision.",
      value: pendingFeedbackCount,
      tab: "feedback" as WorkspaceTab,
      tone: "danger",
    },
    {
      label: "Published recipes without hero images",
      detail: "These are live, but visually underpowered.",
      value: publishedMissingHero.length,
      tab: "recipes" as WorkspaceTab,
      tone: "warning",
    },
    {
      label: "Recipes missing intro copy",
      detail: "Add a short intro so cards, search, and recipe pages feel complete.",
      value: missingIntro.length,
      tab: "recipes" as WorkspaceTab,
      tone: "warning",
    },
    {
      label: "Trash ready for cleanup",
      detail: "Restore useful records or permanently remove old clutter.",
      value: trashCount,
      tab: "trash" as WorkspaceTab,
      tone: "danger",
    },
  ];

  const openAttentionItems = attentionItems.filter((item) => item.value > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm lg:grid-cols-4">
        {[
          { label: "Published", value: publishedCount, detail: "Live now", tab: "recipes" as WorkspaceTab },
          { label: "Drafts", value: draftCount, detail: `${staleDrafts.length} stale`, tab: "recipes" as WorkspaceTab },
          { label: "Feedback", value: pendingFeedbackCount, detail: "Needs review", tab: "feedback" as WorkspaceTab },
          { label: "Trash", value: trashCount, detail: "Ready for cleanup", tab: "trash" as WorkspaceTab },
        ].map((metric) => (
          <button key={metric.label} type="button" onClick={() => onNavigate(metric.tab)} className="bg-white p-4 text-left transition hover:bg-surface focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand/40">
            <span className="text-xs font-medium text-muted">{metric.label}</span>
            <span className="mt-1 block text-2xl font-bold text-ink">{metric.value}</span>
            <span className="mt-0.5 block text-xs text-muted">{metric.detail}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="bg-white">
          <CardBody>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-ink">Needs attention</div>
                <p className="text-xs text-muted">Only items that need action.</p>
              </div>
              <span className="rounded-full bg-warning/15 px-2 py-1 text-xs font-semibold text-warning">{openAttentionItems.length}</span>
            </div>
            {openAttentionItems.length ? (
              <div className="mt-4 divide-y divide-border">
                {openAttentionItems.slice(0, 4).map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onNavigate(item.tab)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left first:pt-0 last:pb-0 hover:text-accent focus:outline-none"
                >
                  <span>
                    <span className="block text-sm font-medium text-foreground">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted">{item.detail}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${item.tone === "danger" ? "bg-danger/10 text-danger" : "bg-warning/15 text-warning"}`}>{item.value}</span>
                </button>
              ))}
              </div>
            ) : (
              <div className="mt-6 text-sm text-muted">Everything is clear. No action needed.</div>
            )}
          </CardBody>
        </Card>

        <Card className="bg-white">
          <CardBody>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-ink">Continue working</div>
                <p className="text-xs text-muted">Your most recently updated drafts.</p>
              </div>
              <button type="button" onClick={() => onNavigate("recipes")} className="text-xs font-semibold text-accent hover:underline">View all</button>
            </div>
            {activeDrafts.length ? (
              <div className="mt-4 divide-y divide-border">
                {activeDrafts.slice(0, 5).map((recipe) => (
                  <Link key={recipe.version_id} href={adminRecipeHref(recipe)} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-accent">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{recipe.name}</span>
                      <span className="mt-0.5 block text-xs text-muted">Updated {formatDate(recipe.updated_at)}</span>
                    </span>
                    <span className="hidden shrink-0 gap-1 sm:flex">
                      {draftBadges(recipe).slice(0, 2).map((badge) => <span key={badge} className="rounded-full bg-surface-muted px-2 py-1 text-[10px] font-medium text-muted">{badge}</span>)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-6 text-sm text-muted">No active drafts.</div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="bg-white">
        <CardBody>
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-ink">Recent activity</div>
            <button type="button" onClick={() => onNavigate("analytics")} className="text-xs font-semibold text-accent hover:underline">View analytics</button>
          </div>
          {loadingAnalytics ? <PageSpinner label="Loading activity..." /> : auditLog.length ? (
            <div className="mt-3 divide-y divide-border">
              {auditLog.slice(0, 4).map((row) => (
                <div key={row.log_id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="capitalize text-foreground">{row.action.replaceAll("_", " ")}</span>
                  <span className="shrink-0 text-xs text-muted">{formatDate(row.created_at)}</span>
                </div>
              ))}
            </div>
          ) : <div className="mt-4 text-sm text-muted">No activity yet.</div>}
        </CardBody>
      </Card>
    </div>
  );
}

function timestampValue(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isOlderThanDays(value: string | null, days: number) {
  const timestamp = timestampValue(value);
  if (!timestamp) return false;
  return Date.now() - timestamp > days * 24 * 60 * 60 * 1000;
}

function draftBadges(recipe: AdminRecipeSummary) {
  const badges = [];
  if (!recipe.hero_image_url) badges.push("Needs image");
  if (!recipe.intro?.trim()) badges.push("Needs intro");
  if (isOlderThanDays(recipe.updated_at, 14)) badges.push("Stale");
  if (!badges.length) badges.push("Ready to review");
  return badges;
}

function DashboardFact({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="text-2xl font-bold text-ink">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function RecipeFilterBar({
  statusFilter,
  categoryFilter,
  categories,
  onStatusChange,
  onCategoryChange,
}: {
  statusFilter: RecipeStatusFilter;
  categoryFilter: string;
  categories: string[];
  onStatusChange: (value: RecipeStatusFilter) => void;
  onCategoryChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Filters</span>
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value as RecipeStatusFilter)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function RecipesTab({
  loading,
  recipes,
  totalRecipes,
  onRecipesChanged,
}: {
  loading: boolean;
  recipes: AdminRecipeSummary[];
  totalRecipes: number;
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
    <div className="space-y-3">
      <div className="text-xs text-muted">Showing {recipes.length} of {totalRecipes}</div>
      <RecipeManagementTable recipes={recipes} onChanged={onRecipesChanged} />
    </div>
  );
}

function NewRecipeTab({
  prompt,
  starting,
  activeDraft,
  preview,
  importStatus,
  previewingImport,
  importing,
  onPromptChange,
  onSubmit,
  onResearchComplete,
  onPreview,
  onImport,
  onClear,
}: {
  prompt: string;
  starting: boolean;
  activeDraft: RecipeResearchDetail | null;
  preview: RecipeImportPreview | null;
  importStatus: ImportStatus;
  previewingImport: boolean;
  importing: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onResearchComplete: (recipe: RecipeResearchDetail) => void;
  onPreview: (file: File) => void;
  onImport: (rows: RecipeImportRow[]) => void;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<"ai" | "import">("ai");
  const importActive = Boolean(preview || previewingImport);

  return (
    <div className="space-y-4">
      <div
        className="relative grid h-11 w-80 grid-cols-2 rounded-full border border-border bg-surface p-1 text-sm shadow-inner"
        role="switch"
        aria-checked={mode === "import"}
        aria-label="Choose how to create a recipe"
      >
        <span
          className={`absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-full bg-brand shadow-sm transition-transform duration-200 ${
            mode === "import" ? "translate-x-full" : "translate-x-0"
          }`}
        />
        <button
          type="button"
          onClick={() => setMode("ai")}
          className={`relative z-10 whitespace-nowrap rounded-full px-3 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 ${
            mode === "ai" ? "text-white dark:text-[#211411]" : "text-muted hover:text-foreground"
          }`}
          aria-pressed={mode === "ai"}
        >
          Create with AI
        </button>
        <button
          type="button"
          onClick={() => setMode("import")}
          className={`relative z-10 whitespace-nowrap rounded-full px-3 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 ${
            mode === "import" ? "text-white dark:text-[#211411]" : "text-muted hover:text-foreground"
          }`}
          aria-pressed={mode === "import"}
        >
          Import spreadsheet
          {importActive && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
      </div>

      {mode === "ai" && (
        <Card className="bg-white">
          <CardBody className="space-y-4">
            <form onSubmit={onSubmit} className="space-y-3">
              <CopyAssistField
                fieldLabel="new recipe research prompt"
                value={prompt}
                onChange={onPromptChange}
                placeholder="A dish name, a longer description, or paste a draft recipe to refine..."
                multiline
                rows={8}
              />
              <div className="flex flex-wrap gap-2">
                {promptExamples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => onPromptChange(example)}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-brand-soft hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/40"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <IconButton
                  type="submit"
                  label="Start new draft"
                  icon={<SendIcon />}
                  size="md"
                  loading={starting}
                  disabled={!prompt.trim()}
                />
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {activeDraft && (
        <Card className="bg-white">
          <CardBody className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Research progress</h2>
              <p className="text-sm text-muted">
                Research starts automatically. When the draft is ready, CurryForward opens the editor automatically.
              </p>
            </div>
            <div className="min-h-[32rem]">
              <AutoResearchPanel
                recipe={activeDraft}
                onComplete={onResearchComplete}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {mode === "import" && (
        <ImportTab
          preview={preview}
          status={importStatus}
          previewing={previewingImport}
          importing={importing}
          onPreview={onPreview}
          onImport={onImport}
          onClear={onClear}
        />
      )}
    </div>
  );
}

function ImportTab({
  preview,
  status,
  previewing,
  importing,
  onPreview,
  onImport,
  onClear,
}: {
  preview: RecipeImportPreview | null;
  status: ImportStatus;
  previewing: boolean;
  importing: boolean;
  onPreview: (file: File) => void;
  onImport: (rows: RecipeImportRow[]) => void;
  onClear: () => void;
}) {
  const validRows = preview?.rows.filter((row) => row.issues.length === 0) ?? [];
  const [selectedImportKeys, setSelectedImportKeys] = useState<Set<string>>(new Set());

  const selectedRows = preview?.rows.filter((row) => selectedImportKeys.has(importRowKey(row)) && row.issues.length === 0) ?? [];
  const allValidSelected = validRows.length > 0 && selectedRows.length === validRows.length;

  return (
    <div className="space-y-4">
      <Card className="bg-white">
        <CardBody className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Import from Excel</h2>
            <p className="text-sm text-muted">
              Upload a workbook with one or more tabs. CurryForward maps each sheet into recipe drafts for review.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted">
              <UploadIcon className="h-4 w-4" />
              Choose workbook
              <input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onPreview(file);
                }}
              />
            </label>
            {previewing && <span className="text-sm text-muted">Mapping workbook...</span>}
            {preview && <IconButton label="Clear import preview" icon={<XIcon />} onClick={onClear} />}
          </div>
          {status && (
            <div className={`rounded-md border p-3 text-sm ${importStatusClass(status.tone)}`}>
              {status.text}
            </div>
          )}
          <div className="rounded-md border border-border bg-surface-muted p-3 text-xs text-muted">
            Each tab should have a header row. Works best with columns like name, category, cuisine_tags, servings,
            ingredients, steps, intro, history, tips, watch_outs, and source_url. Messy column names are okay.
          </div>
        </CardBody>
      </Card>

      {preview && (
        <Card className="bg-white">
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-ink">Preview</div>
                <div className="text-sm text-muted">
                  {preview.valid_count} ready · {preview.issue_count} need cleanup ·{" "}
                  {preview.file_type.toUpperCase()} ·{" "}
                  {preview.source === "ai" ? `AI mapped with ${preview.model}` : "fallback parser used"}
                </div>
                {preview.ai_error && <div className="mt-1 text-xs text-warning">{preview.ai_error}</div>}
              </div>
              <IconButton
                label="Import valid rows as drafts"
                icon={<CheckIcon />}
                loading={importing}
                disabled={validRows.length === 0}
                onClick={() => onImport(selectedRows.length ? selectedRows : validRows)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={allValidSelected}
                  onChange={(e) =>
                    setSelectedImportKeys(e.target.checked ? new Set(validRows.map(importRowKey)) : new Set())
                  }
                  className="h-4 w-4 rounded border-border accent-accent"
                />
                Select all valid rows
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">
                  {selectedRows.length || validRows.length} of {validRows.length} valid rows will import
                </span>
                {selectedRows.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setSelectedImportKeys(new Set())}>
                    Clear selection
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {preview.rows.slice(0, 30).map((row, index) => (
                <div
                  key={`${row.sheet_name ?? "sheet"}-${row.row_number}-${index}`}
                  className={`rounded-md border p-3 ${
                    row.issues.length ? "border-warning/50 bg-warning-soft/30" : "border-border bg-surface"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedImportKeys.has(importRowKey(row))}
                        disabled={row.issues.length > 0}
                        onChange={(e) => {
                          setSelectedImportKeys((current) => {
                            const next = new Set(current);
                            const key = importRowKey(row);
                            if (e.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-accent disabled:opacity-40"
                        aria-label={`Select import row ${row.name}`}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {row.sheet_name ? `${row.sheet_name} · ` : ""}Row {row.row_number}: {row.name}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {row.category || "No category"} · {row.components[0]?.ingredients.length ?? 0} ingredients ·{" "}
                          {row.steps.length} steps
                        </div>
                      </div>
                    </div>
                    {row.issues.length > 0 && (
                      <div className="text-xs font-medium text-warning">{row.issues.join(", ")}</div>
                    )}
                  </div>
                  {row.intro && <p className="mt-2 line-clamp-2 text-sm text-muted">{row.intro}</p>}
                </div>
              ))}
            </div>
            {preview.rows.length > 30 && (
              <div className="text-sm text-muted">Showing first 30 rows. Import still includes all valid rows.</div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function importRowKey(row: RecipeImportRow) {
  return `${row.sheet_name ?? "sheet"}-${row.row_number}-${row.name}`;
}

function importStatusClass(tone: NonNullable<ImportStatus>["tone"]) {
  if (tone === "error") return "border-danger/40 bg-danger-soft/50 text-danger";
  if (tone === "warning") return "border-warning/40 bg-warning-soft/40 text-warning";
  if (tone === "success") return "border-success/40 bg-success-soft/40 text-success";
  return "border-border bg-surface-muted text-muted";
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-3 rounded-md border border-border bg-surface p-5 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-brand-soft text-ink">
        <span className="h-5 w-5">{icon}</span>
      </div>
      <div className="mt-3 font-semibold text-ink">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function FeedbackTab({
  loadingFeedback,
  pendingFeedback,
  totalFeedback,
  onFeedbackDecided,
}: {
  loadingFeedback: boolean;
  pendingFeedback: PendingRecipeFeedback[];
  totalFeedback: number;
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
        <FeedbackReviewPanel items={pendingFeedback} totalItems={totalFeedback} onDecided={onFeedbackDecided} />
      )}
    </div>
  );
}

function FeedbackReviewPanel({
  items,
  totalItems,
  onDecided,
}: {
  items: PendingRecipeFeedback[];
  totalItems: number;
  onDecided: () => void;
}) {
  const { push } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.feedback_id)),
    [items, selectedIds]
  );
  const allSelected = items.length > 0 && selectedItems.length === items.length;

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

  async function bulkDecide(approved: boolean) {
    setBulkBusy(true);
    try {
      for (const item of selectedItems) {
        await api.decideFeedback(item.feedback_id, approved);
      }
      push(`${approved ? "Approved" : "Rejected"} ${selectedItems.length} feedback item${selectedItems.length === 1 ? "" : "s"}`, "success");
      setSelectedIds(new Set());
      onDecided();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Bulk feedback decision failed", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <Card className="bg-white">
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Feedback review</div>
          <div className="text-xs text-muted">Showing {items.length} of {totalItems}</div>
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={<CheckIcon />}
            title="No feedback needs review"
            body="Flagged comments, ratings, and recipe notes will appear here after the AI moderation scan."
            action={
              <Link href="/recipes" className="text-sm font-medium text-accent hover:underline">
                View public recipes
              </Link>
            }
          />
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelectedIds(e.target.checked ? new Set(items.map((item) => item.feedback_id)) : new Set())}
                  className="h-4 w-4 rounded border-border accent-accent"
                />
                Select all
              </label>
              {selectedItems.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">{selectedItems.length} selected</span>
                  <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => bulkDecide(true)}>
                    <CheckIcon className="h-3.5 w-3.5" />
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" loading={bulkBusy} onClick={() => bulkDecide(false)}>
                    <XIcon className="h-3.5 w-3.5" />
                    Reject
                  </Button>
                </div>
              )}
            </div>
            {items.map((item) => {
              const busy = pendingId === item.feedback_id;
              return (
                <div key={item.feedback_id} className="rounded-md border border-border bg-surface p-2.5 transition-colors hover:bg-surface-muted/60">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.feedback_id)}
                        onChange={(e) => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.add(item.feedback_id);
                            else next.delete(item.feedback_id);
                            return next;
                          });
                        }}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-accent"
                        aria-label={`Select feedback for ${item.recipe_name}`}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground">{item.recipe_name}</span>
                          {item.rating != null && <Badge tone="neutral">{item.rating}/5</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-muted">{item.author_name || "Anonymous"}</div>
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
  totalRecipes,
  onChanged,
}: {
  loading: boolean;
  recipes: TrashedRecipeSummary[];
  totalRecipes: number;
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
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-white px-3 py-2 text-sm text-muted shadow-sm">
        Showing {recipes.length} of {totalRecipes} trashed recipes.
      </div>
      <TrashPanel recipes={recipes} onChanged={onChanged} />
    </div>
  );
}

function AnalyticsTab({
  topRecipes,
  totalViews,
  totalDownloads,
  loadingAnalytics,
  llmUsage,
  siteAnalytics,
  auditLog,
}: {
  topRecipes: AdminRecipeSummary[];
  totalViews: number;
  totalDownloads: number;
  loadingAnalytics: boolean;
  llmUsage: LLMUsageResponse | null;
  siteAnalytics: SiteAnalytics | null;
  auditLog: AdminAuditLog[];
}) {
  const totalModelCalls = llmUsage?.summary.reduce((sum, row) => sum + row.call_count, 0) ?? 0;
  const totalTokens = llmUsage?.summary.reduce((sum, row) => sum + row.total_tokens, 0) ?? 0;
  const maxModelCalls = Math.max(1, ...(llmUsage?.summary ?? []).map((row) => row.call_count));

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="bg-white xl:col-span-3">
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-semibold">Public traffic · last 30 days</div>
              <div className="mt-1 text-sm text-muted">Admin sessions and private workspace routes are excluded.</div>
            </div>
            <div className="flex gap-6 text-right">
              <div><div className="text-2xl font-semibold text-ink">{siteAnalytics?.page_views_30d ?? 0}</div><div className="text-xs text-muted">Page views</div></div>
              <div><div className="text-2xl font-semibold text-ink">{siteAnalytics?.unique_visitors_30d ?? 0}</div><div className="text-xs text-muted">Visitors</div></div>
            </div>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div><div className="mb-2 text-xs font-semibold uppercase text-muted">Top pages</div>{(siteAnalytics?.top_pages ?? []).slice(0, 5).map((row) => <div key={row.path} className="flex justify-between border-b border-border py-2 text-sm last:border-0"><span className="truncate text-foreground">{row.path}</span><span className="text-muted">{row.views}</span></div>)}</div>
            <div><div className="mb-2 text-xs font-semibold uppercase text-muted">Traffic sources</div>{(siteAnalytics?.top_sources ?? []).slice(0, 5).map((row) => <div key={row.source} className="flex justify-between border-b border-border py-2 text-sm last:border-0"><span className="truncate text-foreground">{row.source}</span><span className="text-muted">{row.views}</span></div>)}</div>
          </div>
        </CardBody>
      </Card>
      <Card className="bg-white xl:col-span-2">
        <CardBody>
          <div className="font-semibold">Recipe engagement</div>
          <div className="mt-3 flex gap-6">
            <DashboardFact label="Views" value={totalViews} />
            <DashboardFact label="Downloads" value={totalDownloads} />
          </div>
          <div className="mt-4 space-y-3">
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

      <Card className="bg-white">
        <CardBody>
          <div className="font-semibold">Users</div>
          <p className="mt-2 text-sm text-muted">
            Single-admin auth today — no guest accounts or sessions to report yet.
          </p>
        </CardBody>
      </Card>

      <Card className="bg-white xl:col-span-3">
        <CardBody>
          <div className="font-semibold">Model usage</div>
          {loadingAnalytics ? (
            <PageSpinner label="Loading model usage..." />
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-surface p-3">
                  <div className="text-xs uppercase text-muted">Logged calls</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{totalModelCalls}</div>
                </div>
                <div className="rounded-md border border-border bg-surface p-3">
                  <div className="text-xs uppercase text-muted">Tokens</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{totalTokens || "Partial"}</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(llmUsage?.summary ?? []).slice(0, 6).map((row) => (
                  <div
                    key={`${row.task}-${row.model}`}
                    className="grid gap-2 rounded-md border border-border bg-surface p-3 text-sm md:grid-cols-[1fr_160px]"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{row.task}</div>
                      <div className="truncate text-xs text-muted">{row.model || "unknown model"}</div>
                    </div>
                    <div className="text-xs text-muted">
                      <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(8, (row.call_count / maxModelCalls) * 100)}%` }}
                        />
                      </div>
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

      <Card className="bg-white xl:col-span-3">
        <CardBody>
          <div className="font-semibold">Recent admin activity</div>
          {loadingAnalytics ? (
            <PageSpinner label="Loading audit log..." />
          ) : auditLog.length > 0 ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {auditLog.slice(0, 8).map((row) => (
                <div
                  key={row.log_id}
                  className="border-l-2 border-accent/60 bg-surface py-2 pl-3 pr-2 text-sm"
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

function getSearchPlaceholder(tab: WorkspaceTab) {
  if (tab === "recipes") return "Search recipes and drafts";
  if (tab === "feedback") return "Search flagged feedback";
  if (tab === "trash") return "Search trash";
  if (tab === "models") return "Search model workflows";
  if (tab === "analytics") return "Search activity and usage";
  if (tab === "research") return "Search or jump to actions";
  return "Search recipes, drafts, or actions";
}

function ModelsTab({
  loading,
  settings,
  searchQuery,
  onChanged,
}: {
  loading: boolean;
  settings: LLMSettingsResponse | null;
  searchQuery: string;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  async function applyPreset(pick: (setting: LLMSettingsResponse["settings"][number]) => string) {
    if (!settings) return;
    setBulkBusy(true);
    try {
      const changes = settings.settings.filter((setting) => pick(setting) !== setting.model);
      for (const setting of changes) {
        await api.updateLLMSetting(setting.key, pick(setting));
      }
      push(
        changes.length ? `Updated ${changes.length} model setting${changes.length === 1 ? "" : "s"}` : "Already up to date",
        changes.length ? "success" : "info"
      );
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Bulk update failed", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading || !settings) {
    return (
      <Card className="bg-white">
        <CardBody>
          <PageSpinner label="Loading model settings..." />
        </CardBody>
      </Card>
    );
  }

  const byKey = new Map(settings.settings.map((setting) => [setting.key, setting]));
  const groupedKeys = new Set(modelGroups.flatMap((group) => group.keys));
  const providerStatus = Array.from(new Set(settings.models.map((model) => model.provider ?? "Other"))).map(
    (provider) => ({
      provider,
      available: settings.models.some((model) => (model.provider ?? "Other") === provider && model.available !== false),
    })
  );
  const models = settings.models;
  function cheapestModelFor(key: string) {
    const pool = isAnthropicOnlyTask(key) ? models.filter((m) => m.id.startsWith("anthropic/")) : models;
    return (pool.find((m) => m.available !== false) ?? pool[0])?.id;
  }
  const q = searchQuery.trim().toLowerCase();
  const grouped = [
    ...modelGroups.map((group) => ({
      ...group,
      settings: group.keys.map((key) => byKey.get(key)).filter(Boolean) as LLMSettingsResponse["settings"],
    })),
    {
      title: "Other",
      description: "Additional configured workflow defaults.",
      settings: settings.settings.filter((setting) => !groupedKeys.has(setting.key)),
    },
  ]
    .map((group) => ({
      ...group,
      settings: q
        ? group.settings.filter((setting) =>
            [
              group.title,
              group.description,
              setting.key,
              setting.label,
              setting.description,
              setting.model,
              setting.default_model,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)
          )
        : group.settings,
    }))
    .filter((group) => group.settings.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-white px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="font-semibold uppercase tracking-wide text-muted">Providers</span>
          {providerStatus.map((p) => (
            <span key={p.provider} className={p.available ? "text-foreground" : "text-danger"}>
              {p.provider} {p.available ? "✓" : "✗ missing key"}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => applyPreset((setting) => setting.default_model)}>
            Reset all to recommended
          </Button>
          <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => applyPreset((setting) => cheapestModelFor(setting.key) ?? setting.model)}>
            Set all to cheapest available
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border bg-white px-3 py-2.5 text-xs text-muted">
        <span className="font-semibold uppercase tracking-wide text-muted">Badges</span>
        <span><strong className="font-medium text-foreground">public-facing</strong> — guests can trigger this</span>
        <span><strong className="font-medium text-foreground">admin-only</strong> — internal moderation/cleanup</span>
        <span><strong className="font-medium text-foreground">Anthropic-only</strong> — model choice restricted</span>
        <span><strong className="font-medium text-foreground">import</strong> — spreadsheet mapping</span>
        <span><strong className="font-medium text-foreground">cheap</strong> — a lower-cost model is recommended</span>
      </div>
      {grouped.length ? grouped.map((group) => (
        <Card key={group.title} className="bg-white">
          <CardBody>
            <div>
              <div className="font-semibold text-ink">{group.title}</div>
              <p className="mt-1 text-sm text-muted">{group.description}</p>
            </div>
            <div className="mt-4 space-y-3">
              {group.settings.map((setting) => (
                <div
                  key={setting.key}
                  className="grid gap-3 rounded-md border border-border bg-surface p-3 lg:grid-cols-[1fr_320px]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-foreground">{setting.label}</div>
                      {modelBadges(setting.key).map((badge) => (
                        <span key={badge} className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted">
                          {badge}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 text-xs text-muted">{setting.description}</div>
                    <div className="mt-2 text-xs text-muted">
                      Recommended: <span className="font-medium text-foreground">{modelLabel(settings, setting.default_model)}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Current: <span className="font-medium text-foreground">{modelLabel(settings, setting.model)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={setting.model}
                      onChange={(e) => update(setting.key, e.target.value)}
                      disabled={savingKey === setting.key}
                      className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-60"
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
      )) : (
        <Card className="bg-white">
          <CardBody>
            <EmptyState icon={<SearchIcon />} title="No model settings found" body="Try a different model, provider, or workflow search." />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function modelLabel(settings: LLMSettingsResponse, modelId: string) {
  return settings.models.find((model) => model.id === modelId)?.label ?? modelId;
}

function isAnthropicOnlyTask(key: string) {
  return key === "recipe_customize" || key === "recipe_draft" || key === "gap_generation";
}

function modelBadges(key: string) {
  const badges = [];
  if (key === "recipe_context_chat" || key === "recipe_customize") badges.push("public-facing");
  if (key.includes("import")) badges.push("import");
  if (isAnthropicOnlyTask(key)) badges.push("Anthropic-only");
  if (key.includes("moderation") || key.includes("rewrite") || key.includes("extraction") || key.includes("admin")) badges.push("admin-only");
  if (key.includes("plan") || key.includes("flash_lite")) badges.push("cheap");
  return badges;
}
