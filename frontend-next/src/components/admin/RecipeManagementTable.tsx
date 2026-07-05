"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { AdminRecipeSummary } from "@/lib/types";

interface RecipeManagementTableProps {
  recipes: AdminRecipeSummary[];
  onChanged: () => void;
}

export function RecipeManagementTable({ recipes, onChanged }: RecipeManagementTableProps) {
  const { push } = useToast();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  if (recipes.length === 0) {
    return (
      <Card>
        <CardBody className="text-sm text-muted">No recipes yet.</CardBody>
      </Card>
    );
  }

  async function copyRecipe(recipe: AdminRecipeSummary) {
    setPendingId(recipe.recipe_id);
    try {
      await api.forkRecipe(recipe.recipe_id);
      push("Copied — a new draft was created", "success");
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Copy failed", "error");
    } finally {
      setPendingId(null);
    }
  }

  async function editRecipe(recipe: AdminRecipeSummary) {
    setPendingId(recipe.recipe_id);
    try {
      const result = await api.createEditDraft(recipe.recipe_id);
      if (result.note) push(result.note, result.created ? "success" : "info");
      onChanged();
      router.push(`/recipe/research?id=${encodeURIComponent(result.draft.recipe_id)}`);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Edit failed", "error");
    } finally {
      setPendingId(null);
    }
  }

  async function del(recipe: AdminRecipeSummary) {
    setPendingId(recipe.recipe_id);
    try {
      await api.deleteRecipe(recipe.recipe_id);
      push("Moved to Trash", "success");
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Delete failed", "error");
    } finally {
      setPendingId(null);
      setConfirmingDeleteId(null);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-3 font-semibold">Recipes ({recipes.length})</div>
        <div className="space-y-2">
          {recipes.map((r) => {
            const href =
              r.status === "published"
                ? `/recipe?id=${encodeURIComponent(r.recipe_id)}`
                : `/recipe/research?id=${encodeURIComponent(r.recipe_id)}`;
            const busy = pendingId === r.recipe_id;
            return (
              <div key={r.recipe_id} className="rounded-md border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={href} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone={r.status === "published" ? "success" : "warning"}>{r.status}</Badge>
                      {r.category && <span>{r.category}</span>}
                      <span>{r.view_count} views</span>
                      <span>{r.download_count} downloads</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" loading={busy} onClick={() => editRecipe(r)}>
                      Edit
                    </Button>
                    <Button variant="secondary" size="sm" loading={busy} onClick={() => copyRecipe(r)}>
                      Copy
                    </Button>
                    {r.status === "draft" && (
                      <Button variant="danger" size="sm" onClick={() => setConfirmingDeleteId(r.recipe_id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                {confirmingDeleteId === r.recipe_id && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger-soft/40 p-3">
                    <div className="text-sm">
                      Move <strong>{r.name}</strong> to Trash? You can restore it later.
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setConfirmingDeleteId(null)}>
                        Cancel
                      </Button>
                      <Button variant="danger" size="sm" loading={busy} onClick={() => del(r)}>
                        Yes, delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
