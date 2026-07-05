"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReviewQueuePanel } from "@/components/ReviewQueuePanel";
import { ModelPicker } from "@/components/research/ModelPicker";
import { RecipeManagementTable } from "@/components/admin/RecipeManagementTable";
import { TrashPanel } from "@/components/admin/TrashPanel";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRecipes } from "@/context/RecipesContext";
import { api, ApiError } from "@/lib/api";
import type { AdminRecipeSummary, ReviewQueueItem, TrashedRecipeSummary } from "@/lib/types";

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

  const pendingReviews = reviewQueue.length;
  const draftCount = adminRecipes.filter((r) => r.status === "draft").length;
  const publishedCount = adminRecipes.filter((r) => r.status === "published").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Admin</h1>
          <p className="text-sm text-muted">Start research, edit drafts, review imports, and manage Trash.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardBody>
            <div className="text-xs font-semibold uppercase text-muted">Recipes</div>
            <div className="mt-2 text-2xl font-bold text-ink">{adminRecipes.length}</div>
            <div className="mt-1 text-sm text-muted">
              {publishedCount} published, {draftCount} drafts
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs font-semibold uppercase text-muted">Review Queue</div>
            <div className="mt-2 text-2xl font-bold text-ink">{pendingReviews}</div>
            <div className="mt-1 text-sm text-muted">imports waiting for approval</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs font-semibold uppercase text-muted">Trash</div>
            <div className="mt-2 text-2xl font-bold text-ink">{trash.length}</div>
            <div className="mt-1 text-sm text-muted">recoverable draft recipes</div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <Card>
          <CardBody className="space-y-3">
            <div>
              <div className="font-semibold">Research a new recipe</div>
              <p className="text-sm text-muted">
                Start a draft with guided chat or auto-research, then publish from the agentic workspace.
              </p>
            </div>
            <form onSubmit={handleStartResearch} className="space-y-2">
              <Textarea
                value={researchPrompt}
                onChange={(e) => setResearchPrompt(e.target.value)}
                placeholder="A dish name, a longer description, or paste a draft recipe to refine..."
                rows={5}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ModelPicker value={researchModel} onChange={setResearchModel} />
                <Button type="submit" size="sm" loading={startingResearch} disabled={!researchPrompt.trim()}>
                  Start
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        {loadingRecipes ? (
          <Card>
            <CardBody>
              <PageSpinner label="Loading recipes…" />
            </CardBody>
          </Card>
        ) : (
          <RecipeManagementTable recipes={adminRecipes} onChanged={handleRecipesChanged} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {loadingQueue ? (
          <Card>
            <CardBody>
              <PageSpinner label="Loading review queue…" />
            </CardBody>
          </Card>
        ) : reviewQueue.length > 0 ? (
          <ReviewQueuePanel items={reviewQueue} onDecided={handleReviewDecided} />
        ) : (
          <Card>
            <CardBody>
              <div className="font-semibold">Review queue</div>
              <div className="mt-2 text-sm text-muted">No recipes waiting for review.</div>
            </CardBody>
          </Card>
        )}

        {loadingRecipes ? (
          <Card>
            <CardBody>
              <PageSpinner label="Loading trash…" />
            </CardBody>
          </Card>
        ) : (
          <TrashPanel recipes={trash} onChanged={handleRecipesChanged} />
        )}
      </div>
    </div>
  );
}
