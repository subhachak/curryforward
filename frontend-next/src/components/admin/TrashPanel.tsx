"use client";

import { useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, FlameIcon, RestoreIcon, XIcon } from "@/components/ui/icons";
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
  const [confirmingPurgeId, setConfirmingPurgeId] = useState<string | null>(null);

  if (recipes.length === 0) return null;

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

  return (
    <Card className="border-danger/30">
      <CardBody>
        <div className="mb-3 font-semibold">Trash ({recipes.length})</div>
        <div className="space-y-2">
          {recipes.map((r) => {
            const busy = pendingId === r.recipe_id;
            return (
              <div key={r.recipe_id} className="rounded-md border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted">
                      {r.category && <span>{r.category} · </span>}
                      Deleted {r.deleted_at ? new Date(r.deleted_at).toLocaleDateString() : ""}
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
