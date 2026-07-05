"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { MoreMenu, type MenuItem } from "@/components/ui/Menu";
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  HeartIcon,
  PencilIcon,
  TrashIcon,
  XIcon,
  CheckIcon,
} from "@/components/ui/icons";
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

  async function unpublish(recipe: AdminRecipeSummary) {
    setPendingId(recipe.recipe_id);
    try {
      await api.unpublishResearch(recipe.recipe_id);
      push("Unpublished — recipe is now a draft", "success");
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Unpublish failed", "error");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-1 font-semibold">Recipes ({recipes.length})</div>
        <div className="mb-3 text-xs text-muted">
          Published recipes are live. Edits create a draft copy; duplicates are always drafts. Unpublish a recipe before moving it to Trash.
        </div>
        <div className="space-y-2">
          {recipes.map((r) => {
            const href =
              r.status === "published"
                ? `/recipe?id=${encodeURIComponent(r.recipe_id)}`
                : `/recipe/research?id=${encodeURIComponent(r.recipe_id)}`;
            const busy = pendingId === r.recipe_id;
            const menuItems: MenuItem[] = [
              {
                label: r.status === "published" ? "Create or open edit draft" : "Edit draft",
                icon: <PencilIcon />,
                onClick: () => editRecipe(r),
              },
              { label: "Duplicate as draft", icon: <CopyIcon />, onClick: () => copyRecipe(r) },
              ...(r.status === "published"
                ? [{ label: "Unpublish", icon: <EyeOffIcon />, onClick: () => unpublish(r) }]
                : []),
              {
                label: "Move to Trash",
                icon: <TrashIcon />,
                onClick: () => setConfirmingDeleteId(r.recipe_id),
                disabled: r.status === "published",
                disabledReason: "Unpublish this recipe first",
                danger: true,
              },
            ];
            return (
              <div key={r.recipe_id} className="rounded-md border border-border bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 gap-3">
                    {r.hero_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.hero_image_url}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-gradient-to-br from-brand-soft to-accent-soft"
                        aria-hidden
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/brand/mark-cloche-forward.svg" alt="" className="h-8 w-auto opacity-80" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={href} className="font-medium hover:underline">
                          {r.name}
                        </Link>
                        <Badge tone={r.status === "published" ? "success" : "warning"}>{r.status}</Badge>
                        {r.category && <Badge tone="neutral">{r.category}</Badge>}
                      </div>
                      {r.intro && <p className="mt-1 line-clamp-2 text-sm text-muted">{r.intro}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted">
                        <span>Published {formatDate(r.first_published_at)}</span>
                        <span>Updated {formatDate(r.updated_at)}</span>
                        <span className="inline-flex items-center gap-1">
                          <EyeIcon className="h-3.5 w-3.5" />
                          {r.view_count}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <DownloadIcon className="h-3.5 w-3.5" />
                          {r.download_count}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <HeartIcon className="h-3.5 w-3.5" fill={r.like_count > 0 ? "currentColor" : "none"} />
                          {r.like_count}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {busy && (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent text-muted" />
                    )}
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
                    <MoreMenu items={menuItems} label={`More actions for ${r.name}`} />
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
