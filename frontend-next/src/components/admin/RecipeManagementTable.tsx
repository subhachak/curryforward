"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
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
import { adminRecipeHref, publicRecipeHref } from "@/lib/recipeLinks";
import type { AdminRecipeSummary } from "@/lib/types";

interface RecipeManagementTableProps {
  recipes: AdminRecipeSummary[];
  onChanged: () => void;
}

type SortKey = "updated" | "name" | "status" | "completeness" | "views";

const columns: { key: SortKey; label: string }[] = [
  { key: "name", label: "Recipe" },
  { key: "status", label: "Status" },
  { key: "completeness", label: "Complete" },
  { key: "views", label: "Engagement" },
  { key: "updated", label: "Updated" },
];

export function RecipeManagementTable({ recipes, onChanged }: RecipeManagementTableProps) {
  const { push } = useToast();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>("updated");

  const sortedRecipes = useMemo(() => {
    const rows = [...recipes];
    rows.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "status") return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
      if (sortBy === "completeness") return completenessScore(b) - completenessScore(a) || a.name.localeCompare(b.name);
      if (sortBy === "views") return b.view_count - a.view_count || a.name.localeCompare(b.name);
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });
    return rows;
  }, [recipes, sortBy]);

  const selectedRecipes = useMemo(
    () => recipes.filter((recipe) => selectedIds.has(recipe.version_id)),
    [recipes, selectedIds]
  );
  const allSelected = recipes.length > 0 && selectedRecipes.length === recipes.length;
  const selectedDrafts = selectedRecipes.filter((recipe) => recipe.status !== "published");
  const selectedPublished = selectedRecipes.filter((recipe) => recipe.status === "published");

  if (recipes.length === 0) {
    return (
      <Card className="bg-white">
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
      router.push(adminRecipeHref(result.draft));
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

  async function bulkDuplicate() {
    setBulkBusy(true);
    try {
      for (const recipe of selectedRecipes) {
        await api.forkRecipe(recipe.recipe_id);
      }
      push(`Duplicated ${selectedRecipes.length} recipe${selectedRecipes.length === 1 ? "" : "s"} as drafts`, "success");
      setSelectedIds(new Set());
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Bulk duplicate failed", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkUnpublish() {
    setBulkBusy(true);
    try {
      for (const recipe of selectedPublished) {
        await api.unpublishResearch(recipe.recipe_id);
      }
      push(`Took down ${selectedPublished.length} recipe${selectedPublished.length === 1 ? "" : "s"} for servicing`, "success");
      setSelectedIds(new Set());
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Bulk take down failed", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkMoveToTrash() {
    setBulkBusy(true);
    try {
      for (const recipe of selectedDrafts) {
        await api.deleteRecipe(recipe.recipe_id);
      }
      push(`Moved ${selectedDrafts.length} draft${selectedDrafts.length === 1 ? "" : "s"} to Trash`, "success");
      setSelectedIds(new Set());
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Bulk move to Trash failed", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function unpublish(recipe: AdminRecipeSummary) {
    setPendingId(recipe.recipe_id);
    try {
      await api.unpublishResearch(recipe.recipe_id);
      push("Taken down for servicing — recipe is now a draft", "success");
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Take down failed", "error");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card className="bg-white">
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-2">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => setSelectedIds(e.target.checked ? new Set(recipes.map((recipe) => recipe.version_id)) : new Set())}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            Select all
          </label>
          {selectedRecipes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{selectedRecipes.length} selected</span>
              <Button size="sm" variant="secondary" loading={bulkBusy} onClick={bulkDuplicate}>
                <CopyIcon className="h-3.5 w-3.5" />
                Duplicate
              </Button>
              <Button size="sm" variant="secondary" loading={bulkBusy} disabled={selectedPublished.length === 0} onClick={bulkUnpublish}>
                <EyeOffIcon className="h-3.5 w-3.5" />
                Take down
              </Button>
              <Button size="sm" variant="danger" loading={bulkBusy} disabled={selectedDrafts.length === 0} onClick={bulkMoveToTrash}>
                <TrashIcon className="h-3.5 w-3.5" />
                Move to Trash
              </Button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="w-9 py-2 pr-2" />
                {columns.map((col) => (
                  <th key={col.key} className="py-2 pr-4 font-semibold">
                    <button
                      type="button"
                      onClick={() => setSortBy(col.key)}
                      className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
                        sortBy === col.key ? "text-ink" : ""
                      }`}
                    >
                      {col.label}
                      {sortBy === col.key && <span aria-hidden>↓</span>}
                    </button>
                  </th>
                ))}
                <th className="w-10 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedRecipes.map((r) => {
                const busy = pendingId === r.recipe_id;
                const score = completenessScore(r);
                const missing = completenessEntries(r).filter(([, complete]) => !complete).map(([label]) => label);
                const menuItems: MenuItem[] = [
                  {
                    label: r.status === "published" ? "Create or open edit draft" : "Edit draft",
                    icon: <PencilIcon />,
                    onClick: () => editRecipe(r),
                  },
                  { label: "Duplicate as draft", icon: <CopyIcon />, onClick: () => copyRecipe(r) },
                  ...(r.status === "published"
                    ? [{ label: "Take down for servicing", icon: <EyeOffIcon />, onClick: () => unpublish(r) }]
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
                  <Fragment key={r.version_id}>
                    <tr className="border-b border-border align-top last:border-0 hover:bg-surface-muted/60">
                      <td className="py-2.5 pr-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.version_id)}
                          onChange={(e) => {
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (e.target.checked) next.add(r.version_id);
                              else next.delete(r.version_id);
                              return next;
                            });
                          }}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-accent"
                          aria-label={`Select ${r.name}`}
                        />
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex min-w-0 items-start gap-3">
                          {r.hero_image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={r.hero_image_url}
                              alt=""
                              className="food-image h-10 w-10 shrink-0 rounded-md border border-border object-cover"
                            />
                          ) : (
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-gradient-to-br from-brand-soft to-accent-soft"
                              aria-hidden
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src="/brand/cf/logos/symbol-light.svg" alt="" className="theme-asset h-5 w-auto opacity-80" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => editRecipe(r)}
                              className="truncate text-left text-sm font-semibold text-ink hover:underline"
                              title="Open in editor"
                            >
                              {r.name}
                            </button>
                            {r.status === "published" && (
                              <Link
                                href={publicRecipeHref(r)}
                                className="ml-2 inline-flex items-center gap-0.5 text-xs text-muted hover:text-accent"
                              >
                                View live <EyeIcon className="h-3 w-3" />
                              </Link>
                            )}
                            {r.intro && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{r.intro}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={r.status === "published" ? "success" : "warning"} className="uppercase">
                            {r.status}
                          </Badge>
                          {r.category && <Badge tone="neutral">{r.category}</Badge>}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div
                          className={`flex items-center gap-1.5 text-xs font-medium ${score === 6 ? "text-success" : "text-warning"}`}
                          title={missing.length ? `Missing: ${missing.join(", ")}` : "All recipe details complete"}
                        >
                          <span className="flex gap-0.5" aria-hidden>
                            {completenessEntries(r).map(([label, complete]) => (
                              <span key={label} className={`h-2 w-2 rounded-full ${complete ? "bg-success" : "bg-border"}`} />
                            ))}
                          </span>
                          {score}/6
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-muted">
                        <div className="flex flex-wrap items-center gap-2.5">
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
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-muted">
                        <div>{formatDate(r.updated_at)}</div>
                        <div className="mt-0.5">{r.first_published_at ? `Published ${formatDate(r.first_published_at)}` : "Not published"}</div>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {busy && (
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent text-muted" />
                          )}
                          <MoreMenu items={menuItems} label={`More actions for ${r.name}`} />
                        </div>
                      </td>
                    </tr>
                    {confirmingDeleteId === r.recipe_id && (
                      <tr className="border-b border-danger/30 bg-danger-soft/20 last:border-0">
                        <td colSpan={columns.length + 2} className="px-2 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          Complete = ingredients, steps, intro, timing, image, category — hover the dots on any row for what&rsquo;s missing.
        </p>
      </CardBody>
    </Card>
  );
}

function formatDate(value: string | null) {
  if (!value) return "not yet";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function completenessEntries(recipe: AdminRecipeSummary): [string, boolean][] {
  return [
    ["ingredients", recipe.completeness.ingredients],
    ["steps", recipe.completeness.steps],
    ["intro", recipe.completeness.intro],
    ["timing", recipe.completeness.timing],
    ["image", recipe.completeness.image],
    ["category", recipe.completeness.category],
  ];
}

function completenessScore(recipe: AdminRecipeSummary) {
  return completenessEntries(recipe).filter(([, complete]) => complete).length;
}
