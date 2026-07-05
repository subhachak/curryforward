"use client";

import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, SearchIcon, SendIcon, XIcon } from "@/components/ui/icons";
import { CopyAssistField } from "@/components/research/CopyAssistField";
import { api, ApiError } from "@/lib/api";
import {
  AUTO_RESEARCH_SECTIONS,
  type RecipeResearchDetail,
  type ResearchJobSummary,
  type SearchQueryItem,
} from "@/lib/types";

interface AutoResearchPanelProps {
  recipe: RecipeResearchDetail;
  onComplete: (recipe: RecipeResearchDetail) => void;
  onPromptChange: (value: string) => void;
}

type Phase = "idle" | "planning" | "reviewing" | "running";

const POLL_INTERVAL_MS = 2500;

const SECTION_LABELS: Record<string, string> = {
  history: "History & intro",
  ingredients: "Ingredients",
  steps: "Steps",
  tips: "Tips & watch-outs",
  merge: "Merge",
};

export function AutoResearchPanel({ recipe, onComplete, onPromptChange }: AutoResearchPanelProps) {
  const recipeId = recipe.recipe_id;
  const [phase, setPhase] = useState<Phase>(recipe.auto_research_status === "running" ? "running" : "idle");
  const [plan, setPlan] = useState<string | null>(null);
  const [queries, setQueries] = useState<SearchQueryItem[]>([]);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(recipe.auto_research_error);
  const [progress, setProgress] = useState<string[]>(recipe.auto_research_progress || []);
  const [jobs, setJobs] = useState<ResearchJobSummary[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A background job may already be in flight — e.g. the admin started a run,
  // navigated away or the connection dropped (the crew can take a minute or
  // more), and came back. Resume polling instead of showing "idle" and
  // letting them kick off a duplicate run.
  useEffect(() => {
    if (phase === "running") startPolling();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.listResearchJobs(recipeId).then(setJobs).catch(() => undefined);
  }, [recipeId]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      let updated: RecipeResearchDetail;
      try {
        updated = await api.getResearchRecipe(recipeId);
      } catch {
        return; // transient fetch error — try again next tick
      }
      setProgress(updated.auto_research_progress || []);
      if (updated.auto_research_status === "running") return;

      stopPolling();
      if (updated.auto_research_status === "error") {
        setError(updated.auto_research_error || "Auto-research failed");
        setPhase("reviewing");
        return;
      }
      setPlan(null);
      setQueries([]);
      setApproved(new Set());
      setProgress([]);
      setPhase("idle");
      api.listResearchJobs(recipeId).then(setJobs).catch(() => undefined);
      onComplete(updated);
    }, POLL_INTERVAL_MS);
  }

  async function handlePlan() {
    setPhase("planning");
    setError(null);
    try {
      const result = await api.planAutoResearch(recipeId);
      setPlan(result.plan);
      setQueries(result.queries);
      setApproved(new Set(result.queries.map((_, i) => i)));
      setPhase("reviewing");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Planning failed");
      setPhase("idle");
    }
  }

  async function handleRun() {
    setError(null);
    try {
      const approvedQueries = queries.filter((_, i) => approved.has(i)).map((q) => q.query);
      const started = await api.runAutoResearch(recipeId, approvedQueries);
      setProgress(started.auto_research_progress || []);
      setPhase("running");
      startPolling();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Auto-research failed");
      setPhase("reviewing");
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      stopPolling();
      await api.cancelAutoResearch(recipeId);
      api.listResearchJobs(recipeId).then(setJobs).catch(() => undefined);
      setProgress([]);
      // Keep the reviewed plan/batch on screen so they can tweak the
      // starting prompt and immediately re-run, rather than starting over.
      setPhase(queries.length > 0 ? "reviewing" : "idle");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't stop — try again");
    } finally {
      setCancelling(false);
    }
  }

  function toggle(idx: number) {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function updateQueryText(idx: number, text: string) {
    setQueries((prev) => prev.map((q, i) => (i === idx ? { ...q, query: text } : q)));
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border bg-surface-muted px-4 py-2.5">
        <div className="text-sm font-semibold text-ink">Auto-research</div>
        <p className="mt-0.5 text-xs text-muted">
          Four specialist agents research and draft the recipe in parallel — approve a
          batch of searches once, then let it run.
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            Starting prompt — a name, a description, or a pasted draft to refine
          </label>
          <CopyAssistField
            recipeId={recipeId}
            fieldLabel="auto-research starting prompt"
            value={recipe.starting_prompt ?? ""}
            onChange={onPromptChange}
            rows={3}
            multiline
            placeholder="What should the crew research and build?"
          />
        </div>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger-soft/40 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {phase === "idle" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">
              Proposes a batch of web searches for you to approve, then runs History,
              Ingredients, Steps, and Tips specialists concurrently and merges their
              output into the document on the right.
            </p>
            <IconButton label="Propose searches" icon={<SearchIcon />} variant="accent" onClick={handlePlan} />
          </div>
        )}

        {phase === "planning" && <div className="text-xs text-muted">Proposing searches…</div>}

        {phase === "reviewing" && (
          <div className="space-y-3">
            {plan && (
              <div className="rounded-md border border-brand/30 bg-brand-soft/30 px-3 py-2 text-sm text-foreground">
                {plan}
              </div>
            )}
            <p className="text-sm text-foreground">
              Review the batch — uncheck any you don&apos;t want, edit the query text,
              then run.
            </p>
            <div className="space-y-2">
              {queries.map((q, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-border bg-surface-muted p-2"
                >
                  <input
                    type="checkbox"
                    className="mt-2.5"
                    checked={approved.has(i)}
                    onChange={() => toggle(i)}
                  />
                  <div className="flex-1 space-y-1">
                    <CopyAssistField
                      recipeId={recipeId}
                      fieldLabel={`${q.category} search query`}
                      value={q.query}
                      onChange={(value) => updateQueryText(i, value)}
                      inputClassName="text-sm"
                    />
                    <div className="text-xs text-muted">{q.category}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <IconButton label="Run auto-research" icon={<SendIcon />} variant="accent" onClick={handleRun} />
              <IconButton label="Cancel auto-research plan" icon={<XIcon />} onClick={() => setPhase("idle")} />
            </div>
          </div>
        )}

        {phase === "running" && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Running the crew — this can take a minute or more. Feel free to navigate
              away and come back; it keeps running in the background and picks up here
              when you return.
            </p>
            <div className="space-y-1.5">
              {AUTO_RESEARCH_SECTIONS.map((key) => {
                const done = progress.includes(key);
                // The four specialists all start immediately in parallel, so
                // "not done yet" means "running." The orchestrator's merge
                // step only starts once all four finish, so it's genuinely
                // still pending until then, not running.
                const specialistsDone = ["history", "ingredients", "steps", "tips"].every((s) =>
                  progress.includes(s)
                );
                const statusLabel = done ? null : key === "merge" && !specialistsDone ? "pending" : "running…";
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

        {jobs.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="mb-2 text-xs font-semibold text-ink">Research trail</div>
            <div className="space-y-2">
              {jobs.slice(0, 3).map((job) => (
                <div key={job.job_id} className="rounded-md border border-border bg-surface-muted p-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground">{job.status}</span>
                    <span className="text-muted">
                      {job.started_at ? new Date(job.started_at).toLocaleString() : ""}
                    </span>
                  </div>
                  {job.approved_queries.length > 0 && (
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted">
                      {job.approved_queries.slice(0, 3).map((query) => (
                        <li key={query}>{query}</li>
                      ))}
                    </ul>
                  )}
                  {job.error && <div className="mt-1 text-xs text-danger">{job.error}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
