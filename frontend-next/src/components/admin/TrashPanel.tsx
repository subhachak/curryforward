"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, FlameIcon, RestoreIcon, TrashIcon, XIcon } from "@/components/ui/icons";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { TrashedRecipeSummary } from "@/lib/types";

interface TrashPanelProps {
  recipes: TrashedRecipeSummary[];
  onChanged: () => void;
}

export function TrashPanel({ recipes, onChanged }: TrashPanelProps) {
  const { push } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmingPurgeId, setConfirmingPurgeId] = useState<string | null>(null);
  const [confirmingBulkPurge, setConfirmingBulkPurge] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedRecipes = useMemo(
    () => recipes.filter((recipe) => selectedIds.has(recipe.recipe_id)),
    [recipes, selectedIds]
  );
  const allSelected = recipes.length > 0 && selectedRecipes.length === recipes.length;

  if (recipes.length === 0) {
    return (
      <Card className="border-danger/20 bg-white">
        <CardBody>
          <div className="flex items-start gap-3 rounded-md bg-danger-soft/30 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-danger">
              <TrashIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-ink">Trash is empty</div>
              <div className="mt-1 text-sm text-muted">
                Deleted drafts and unpublished recipes will appear here before permanent removal.
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  async function restore(recipe: TrashedRecipeSummary) {
    setPendingId(recipe.recipe_id);
    try {
      await api.restoreRecipe(recipe.recipe_id);
      push("Restored", "success");
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Restore failed", "error");
    } finally {
      setPendingId(null);
    }
  }

  async function purge(recipe: TrashedRecipeSummary) {
    setPendingId(recipe.recipe_id);
    try {
      await api.purgeRecipe(recipe.recipe_id);
      push("Permanently deleted", "success");
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Purge failed", "error");
    } finally {
      setPendingId(null);
      setConfirmingPurgeId(null);
    }
  }

  async function bulkRestore() {
    setBulkBusy(true);
    try {
      for (const recipe of selectedRecipes) {
        await api.restoreRecipe(recipe.recipe_id);
      }
      push(`Restored ${selectedRecipes.length} recipe${selectedRecipes.length === 1 ? "" : "s"}`, "success");
      setSelectedIds(new Set());
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Bulk restore failed", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkPurge() {
    setBulkBusy(true);
    try {
      for (const recipe of selectedRecipes) {
        await api.purgeRecipe(recipe.recipe_id);
      }
      push(`Permanently deleted ${selectedRecipes.length} recipe${selectedRecipes.length === 1 ? "" : "s"}`, "success");
      setSelectedIds(new Set());
      setConfirmingBulkPurge(false);
      onChanged();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Bulk purge failed", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <Card className="border-danger/30 bg-white">
      <CardBody>
        <div className="mb-3 font-semibold">Trash ({recipes.length})</div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/20 bg-danger-soft/20 p-2">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => setSelectedIds(e.target.checked ? new Set(recipes.map((recipe) => recipe.recipe_id)) : new Set())}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            Select all
          </label>
          {selectedRecipes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{selectedRecipes.length} selected</span>
              <Button size="sm" variant="secondary" loading={bulkBusy} onClick={bulkRestore}>
                <RestoreIcon className="h-3.5 w-3.5" />
                Restore
              </Button>
              <Button size="sm" variant="danger" loading={bulkBusy} onClick={() => setConfirmingBulkPurge(true)}>
                <FlameIcon className="h-3.5 w-3.5" />
                Delete forever
              </Button>
            </div>
          )}
        </div>
        {confirmingBulkPurge && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger-soft/40 p-3">
            <div className="text-sm">
              Permanently delete {selectedRecipes.length} selected recipe{selectedRecipes.length === 1 ? "" : "s"}?
              This cannot be undone.
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setConfirmingBulkPurge(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" loading={bulkBusy} onClick={bulkPurge}>
                Confirm delete
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {recipes.map((r) => {
            const busy = pendingId === r.recipe_id;
            return (
              <div key={r.recipe_id} className="rounded-md border border-border bg-surface p-2.5 transition-colors hover:bg-danger-soft/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.recipe_id)}
                      onChange={(e) => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (e.target.checked) next.add(r.recipe_id);
                          else next.delete(r.recipe_id);
                          return next;
                        });
                      }}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-accent"
                      aria-label={`Select ${r.name}`}
                    />
                    <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted">
                      {r.category && <span>{r.category} · </span>}
                      Deleted {r.deleted_at ? new Date(r.deleted_at).toLocaleDateString() : ""}
                    </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <IconButton
                      label="Restore draft"
                      icon={<RestoreIcon />}
                      loading={busy}
                      onClick={() => restore(r)}
                    />
                    <IconButton
                      label="Permanently delete"
                      icon={<FlameIcon />}
                      variant="danger"
                      onClick={() => setConfirmingPurgeId(r.recipe_id)}
                    />
                  </div>
                </div>

                {confirmingPurgeId === r.recipe_id && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger-soft/40 p-3">
                    <div className="text-sm">
                      Permanently delete <strong>{r.name}</strong> and all its version history? This
                      cannot be undone — there is no Trash for this.
                    </div>
                    <div className="flex gap-1.5">
                      <IconButton
                        label="Cancel"
                        icon={<XIcon />}
                        onClick={() => setConfirmingPurgeId(null)}
                      />
                      <IconButton
                        label="Confirm permanent delete"
                        icon={<CheckIcon />}
                        variant="danger"
                        loading={busy}
                        onClick={() => purge(r)}
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
