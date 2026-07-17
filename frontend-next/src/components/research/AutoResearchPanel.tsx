"use client";

import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, SearchIcon, XIcon } from "@/components/ui/icons";
import { api, ApiError } from "@/lib/api";
import {
  AUTO_RESEARCH_SECTIONS,
  type RecipeResearchDetail,
} from "@/lib/types";

interface AutoResearchPanelProps {
  recipe: RecipeResearchDetail;
  onComplete: (recipe: RecipeResearchDetail) => void;
}

type Phase = "idle" | "running";

const INITIAL_POLL_INTERVAL_MS = 5000;
const MAX_POLL_INTERVAL_MS = 15000;

const SECTION_LABELS: Record<string, string> = {
  history: "History & intro",
  ingredients: "Ingredients",
  steps: "Steps",
  tips: "Tips & watch-outs",
  merge: "Merge",
};

export function AutoResearchPanel({ recipe, onComplete }: AutoResearchPanelProps) {
  const recipeId = recipe.recipe_id;
  const [phase, setPhase] = useState<Phase>(recipe.auto_research_status === "running" ? "running" : "idle");
  const [error, setError] = useState<string | null>(recipe.auto_research_error);
  const [progress, setProgress] = useState<string[]>(recipe.auto_research_progress || []);
  const [activity, setActivity] = useState<string[]>(recipe.auto_research_activity || []);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(INITIAL_POLL_INTERVAL_MS);
  const pollingActiveRef = useRef(false);

  // A background job may already be in flight — e.g. the admin started a run,
  // navigated away or the connection dropped (the crew can take a minute or
  // more), and came back. Resume polling instead of showing "idle" and
  // letting them kick off a duplicate run.
  useEffect(() => {
    if (phase === "running") startPolling();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    pollingActiveRef.current = false;
  }

  function startPolling() {
    stopPolling();
    pollingActiveRef.current = true;
    pollDelayRef.current = INITIAL_POLL_INTERVAL_MS;
    scheduleNextPoll(0);
  }

  function scheduleNextPoll(delay = pollDelayRef.current) {
    if (!pollingActiveRef.current) return;
    pollRef.current = setTimeout(pollOnce, delay);
    pollDelayRef.current = Math.min(MAX_POLL_INTERVAL_MS, Math.round(pollDelayRef.current * 1.5));
  }

  async function pollOnce() {
    pollRef.current = null;
    if (!pollingActiveRef.current) return;
    let updated: RecipeResearchDetail;
    try {
      updated = await api.getResearchRecipe(recipeId);
    } catch {
      scheduleNextPoll();
      return; // transient fetch error — try again next tick
    }
    setProgress(updated.auto_research_progress || []);
    setActivity(updated.auto_research_activity || []);
    if (updated.auto_research_status === "running") {
      scheduleNextPoll();
      return;
    }

    stopPolling();
    if (updated.auto_research_status === "error") {
      setError(updated.auto_research_error || "Auto-research failed");
      setPhase("idle");
      return;
    }
    setProgress([]);
    setActivity(updated.auto_research_activity || []);
    setPhase("idle");
    onComplete(updated);
  }

  async function handleRun() {
    setError(null);
    try {
      const started = await api.runAutoResearch(recipeId);
      setProgress(started.auto_research_progress || []);
      setActivity(started.auto_research_activity || []);
      setPhase("running");
      startPolling();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Auto-research failed");
      setPhase("idle");
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      stopPolling();
      await api.cancelAutoResearch(recipeId);
      setProgress([]);
      setActivity(["Auto-research stopped."]);
      setPhase("idle");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't stop — try again");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border bg-surface-muted px-4 py-2.5">
        <div className="text-sm font-semibold text-ink">Auto-research</div>
        <p className="mt-0.5 text-xs text-muted">
          Plans searches, researches, drafts sections, and merges them into the recipe.
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger-soft/40 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {phase === "idle" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">
              Starts with the prompt above, gathers focused web context, then runs
              History, Ingredients, Steps, and Tips specialists concurrently.
            </p>
            <IconButton label="Run auto-research" icon={<SearchIcon />} variant="accent" onClick={handleRun} />
          </div>
        )}

        {phase === "running" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border border-border bg-surface-muted px-3 py-2.5">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {activity[activity.length - 1] || "Getting started…"}
                </p>
                <p className="text-xs text-muted">
                  {progress.length} of {AUTO_RESEARCH_SECTIONS.length} sections done · safe to navigate away
                </p>
              </div>
            </div>

            {activity.length > 1 && (
              <details className="group rounded-md border border-border">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-muted hover:text-ink">
                  Activity log
                  <span className="text-muted transition-transform group-open:rotate-180">⌄</span>
                </summary>
                <ul className="max-h-40 space-y-1.5 overflow-y-auto border-t border-border px-3 py-2 text-xs text-muted">
                  {activity.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-2">
                      <span className="text-border">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="relative">
              {AUTO_RESEARCH_SECTIONS.map((key, index) => {
                const done = progress.includes(key);
                const draftingStarted = activity.some((item) => item.includes("Drafting recipe sections"));
                // The four specialists all start immediately in parallel, so
                // "not done yet" means "running." The orchestrator's merge
                // step only starts once all four finish, so it's genuinely
                // still pending until then, not running.
                const specialistsDone = ["history", "ingredients", "steps", "tips"].every((s) =>
                  progress.includes(s)
                );
                const running =
                  !done && draftingStarted && !(key === "merge" && !specialistsDone);
                const statusLabel = done ? null : running ? "running…" : "pending";
                const isLast = index === AUTO_RESEARCH_SECTIONS.length - 1;
                return (
                  <div key={key} className="relative flex gap-3 pb-4 last:pb-0">
                    {!isLast && (
                      <span
                        className={`absolute left-[8px] top-5 h-[calc(100%-2px)] w-px ${
                          done ? "bg-brand" : "bg-border"
                        }`}
                      />
                    )}
                    <span
                      className={`relative z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${
                        done
                          ? "bg-brand text-white"
                          : running
                            ? "border-2 border-accent bg-accent-soft"
                            : "border border-border bg-surface"
                      }`}
                    >
                      {done ? (
                        <CheckIcon className="h-3 w-3" />
                      ) : running ? (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                      ) : null}
                    </span>
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pt-px">
                      <span
                        className={`text-sm ${
                          done ? "font-medium text-foreground" : running ? "text-ink" : "text-muted"
                        }`}
                      >
                        {SECTION_LABELS[key]}
                      </span>
                      {statusLabel && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            running ? "bg-accent-soft text-accent-hover" : "text-muted"
                          }`}
                        >
                          {statusLabel}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <IconButton label="Stop auto-research" icon={<XIcon />} loading={cancelling} onClick={handleCancel} />
          </div>
        )}

      </div>
    </div>
  );
}
