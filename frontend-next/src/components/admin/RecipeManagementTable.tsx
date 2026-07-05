"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { CopyIcon, EyeIcon, PencilIcon, TrashIcon, XIcon, CheckIcon } from "@/components/ui/icons";
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
      push("Duplicated as a new draft", "success");
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
        <div className="mb-1 font-semibold">Recipes ({recipes.length})</div>
        <div className="mb-3 text-xs text-muted">
          Published recipes are live. Edits create a draft copy; duplicates are always drafts; only drafts can move to Trash.
        </div>
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
                      <span>Published {formatDate(r.first_published_at)}</span>
                      <span>Updated {formatDate(r.updated_at)}</span>
                      <span>{r.view_count} views</span>
                      <span>{r.download_count} downloads</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Link
                      href={href}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground transition-colors hover:bg-surface-muted"
                      aria-label={r.status === "published" ? "View public recipe" : "Open draft"}
                      title={r.status === "published" ? "View public recipe" : "Open draft"}
                    >
                      <span className="h-4 w-4">
                        <EyeIcon />
                      </span>
                    </Link>
                    <IconButton
                      label={r.status === "published" ? "Create or open edit draft" : "Edit draft"}
                      icon={<PencilIcon />}
                      loading={busy}
                      onClick={() => editRecipe(r)}
                    />
                    <IconButton
                      label="Duplicate as draft"
                      icon={<CopyIcon />}
                      loading={busy}
                      onClick={() => copyRecipe(r)}
                    />
                    {r.status === "draft" && (
                      <IconButton
                        label="Move draft to Trash"
                        icon={<TrashIcon />}
                        variant="danger"
                        onClick={() => setConfirmingDeleteId(r.recipe_id)}
                      />
                    )}
                  </div>
                </div>

                {confirmingDeleteId === r.recipe_id && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger-soft/40 p-3">
                    <div className="text-sm">
                      Move draft <strong>{r.name}</strong> to Trash? You can restore it later.
                    </div>
                    <div className="flex gap-1.5">
                      <IconButton
                        label="Cancel"
                        icon={<XIcon />}
                        variant="secondary"
                        onClick={() => setConfirmingDeleteId(null)}
                      />
                      <IconButton
                        label="Confirm move to Trash"
                        icon={<CheckIcon />}
                        variant="danger"
                        loading={busy}
                        onClick={() => del(r)}
                      />
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

function formatDate(value: string | null) {
  if (!value) return "not yet";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
