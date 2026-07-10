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
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Running the crew — this can take a minute or more. Feel free to navigate
              away and come back; it keeps running in the background and picks up here
              when you return.
            </p>
            {activity.length > 0 && (
              <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
                <div className="mb-1 text-xs font-semibold text-ink">Live activity</div>
                <ul className="space-y-1 text-xs text-muted">
                  {activity.slice(-6).map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-1.5">
              {AUTO_RESEARCH_SECTIONS.map((key) => {
                const done = progress.includes(key);
                const draftingStarted = activity.some((item) => item.includes("Drafting recipe sections"));
                // The four specialists all start immediately in parallel, so
                // "not done yet" means "running." The orchestrator's merge
                // step only starts once all four finish, so it's genuinely
                // still pending until then, not running.
                const specialistsDone = ["history", "ingredients", "steps", "tips"].every((s) =>
                  progress.includes(s)
                );
                const statusLabel = done
                  ? null
                  : !draftingStarted || (key === "merge" && !specialistsDone)
                    ? "pending"
                    : "running…";
                return (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                        done ? "bg-brand text-ink" : "border border-border text-muted"
                      }`}
                    >
                      {done ? <CheckIcon className="h-3 w-3" /> : ""}
                    </span>
                    <span className={done ? "text-foreground" : "text-muted"}>{SECTION_LABELS[key]}</span>
                    {statusLabel && <span className="text-xs text-muted">{statusLabel}</span>}
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
