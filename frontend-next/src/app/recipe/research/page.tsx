"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AutoResearchPanel } from "@/components/research/AutoResearchPanel";
import { ModelPicker } from "@/components/research/ModelPicker";
import { ResearchChatPanel, type DisplayMessage } from "@/components/research/ResearchChatPanel";
import { ResearchDocumentPreview } from "@/components/research/ResearchDocumentPreview";
import { Card, CardBody } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, CopyIcon, EyeIcon, PencilIcon, RefreshIcon, SendIcon, XIcon } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useRecipes } from "@/context/RecipesContext";
import { api, ApiError } from "@/lib/api";
import { reconstructTranscript } from "@/lib/researchTranscript";
import type { ResearchPatchPayload, ResearchTurnResult, RecipeResearchDetail } from "@/lib/types";

function ResearchWorkspaceInner() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { push } = useToast();
  const { reload: reloadRecipes } = useRecipes();
  const router = useRouter();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get("id");

  const [recipe, setRecipe] = useState<RecipeResearchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [pendingProposal, setPendingProposal] = useState<{ query: string; tool_use_id: string } | null>(null);
  const [notesSuggestion, setNotesSuggestion] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [previewMode, setPreviewMode] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [refreshingNutrition, setRefreshingNutrition] = useState(false);
  const [mode, setMode] = useState<"guided" | "auto">("auto");
  const [wideEditPrompt, setWideEditPrompt] = useState("");
  const [wideEditing, setWideEditing] = useState(false);
  const [reviewHighlights, setReviewHighlights] = useState<string[]>([]);
  const [reviewNotes, setReviewNotes] = useState<string | null>(null);

  const nextId = useRef(0);
  const kickedOff = useRef(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function addMessage(role: DisplayMessage["role"], kind: DisplayMessage["kind"], text: string) {
    setMessages((prev) => [...prev, { id: nextId.current++, role, kind, text }]);
  }

  const load = useCallback(async () => {
    if (!recipeId) {
      setError("No recipe specified.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.getResearchRecipe(recipeId);
      setRecipe(r);
      const conversation = (r.research_conversation as {
        messages?: unknown;
        pending_tool_use?: { id: string; query: string } | null;
      }) || {};
      const transcript = reconstructTranscript(conversation.messages);
      setMessages(transcript.map((t) => ({ id: nextId.current++, ...t })));
      if (conversation.pending_tool_use) {
        setPendingProposal({
          query: conversation.pending_tool_use.query,
          tool_use_id: conversation.pending_tool_use.id,
        });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load this recipe");
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const applyTurnResult = useCallback((result: ResearchTurnResult) => {
    if (result.type === "search_proposal") {
      setPendingProposal({ query: result.query, tool_use_id: result.tool_use_id });
      return;
    }
    addMessage("assistant", "text", result.reply);
    setRecipe(result.recipe);
    setSaveStatus("saved");
    if (result.notes_suggestion) setNotesSuggestion(result.notes_suggestion);
  }, []);

  const handleSend = useCallback(
    async (message: string) => {
      if (!recipeId) return;
      addMessage("user", "text", message);
      setSending(true);
      try {
        const result = await api.researchChat(recipeId, { message });
        applyTurnResult(result);
      } catch (e) {
        addMessage("assistant", "text", e instanceof ApiError ? e.message : "Something went wrong.");
      } finally {
        setSending(false);
      }
    },
    [recipeId, applyTurnResult]
  );

  // Kick off the guided-chat conversation automatically the first time the
  // admin views that tab with a brand-new (no history yet) session, so they
  // don't have to type the first message themselves. Gated on mode==="guided"
  // — auto-research is the default landing tab now, and firing off a chat
  // turn nobody looks at would just be a wasted LLM call.
  useEffect(() => {
    if (mode === "guided" && recipe && !kickedOff.current && messages.length === 0 && !pendingProposal) {
      kickedOff.current = true;
      handleSend(`Help me research and build a complete recipe for "${recipe.name}".`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, mode]);

  async function handleDecision(approved: boolean) {
    if (!recipeId || !pendingProposal) return;
    setDeciding(true);
    if (approved) addMessage("assistant", "search", pendingProposal.query);
    const { tool_use_id, query } = pendingProposal;
    setPendingProposal(null);
    try {
      const result = await api.researchChat(recipeId, { tool_use_id, query, approved });
      applyTurnResult(result);
    } catch (e) {
      addMessage("assistant", "text", e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setDeciding(false);
    }
  }

  async function handleCommit(patch: ResearchPatchPayload) {
    if (!recipeId) return;
    setSaveStatus("saving");
    try {
      const updated = await api.patchResearch(recipeId, patch);
      setRecipe(updated);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      push(e instanceof ApiError ? e.message : "Save failed", "error");
    }
  }

  async function handleRefreshNutrition() {
    if (!recipeId) return;
    setRefreshingNutrition(true);
    try {
      const updated = await api.refreshResearchNutrition(recipeId);
      setRecipe(updated);
      setSaveStatus("saved");
      const hasComputedNutrients = [
        updated.nutrition.calories,
        updated.nutrition.protein_g,
        updated.nutrition.fat_g,
        updated.nutrition.carbs_g,
        updated.nutrition.sodium_mg,
      ].some((value) => (value ?? 0) > 0);
      const sources = updated.nutrition.nutrition_sources?.length
        ? ` (${updated.nutrition.nutrition_sources.join(", ")})`
        : "";
      push(
        hasComputedNutrients
          ? `Nutrition facts refreshed${sources}`
          : "Nutrition refreshed, but no usable values could be calculated yet.",
        hasComputedNutrients ? "success" : "info"
      );
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Nutrition refresh failed", "error");
    } finally {
      setRefreshingNutrition(false);
    }
  }

  function handleModelChange(model: string) {
    setRecipe((prev) => (prev ? { ...prev, research_model: model } : prev));
    handleCommit({ model });
  }

  function handleAutoComplete(updated: RecipeResearchDetail) {
    setRecipe(updated);
    setSaveStatus("saved");
    push("Auto-research complete — review the document on the right", "success");
  }

  function handleStartingPromptChange(value: string) {
    setRecipe((prev) => (prev ? { ...prev, starting_prompt: value } : prev));
    if (promptTimer.current) clearTimeout(promptTimer.current);
    promptTimer.current = setTimeout(() => handleCommit({ starting_prompt: value }), 800);
  }

  async function handleRefineSection(section: string, instruction: string) {
    if (!recipeId) return;
    try {
      const updated = await api.refineSection(recipeId, section, instruction);
      setRecipe(updated);
      push("Section refined", "success");
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Refinement failed", "error");
    }
  }

  async function handleWideEdit() {
    if (!recipeId) return;
    const instruction = wideEditPrompt.trim();
    if (!instruction) return;
    setWideEditing(true);
    try {
      const result = await api.wideEditRecipe(recipeId, instruction);
      setRecipe(result.recipe);
      setReviewHighlights(result.changed_fields);
      setReviewNotes(result.review_notes);
      setWideEditPrompt("");
      setSaveStatus("saved");
      push(`Updated ${result.changed_fields.length || 0} section${result.changed_fields.length === 1 ? "" : "s"} for review`, "success");
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Recipe-wide edit failed", "error");
    } finally {
      setWideEditing(false);
    }
  }

  function handleNotesChange(value: string) {
    setRecipe((prev) => (prev ? { ...prev, notes: value } : prev));
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => handleCommit({ notes: value }), 800);
  }

  function handleAcceptNotesSuggestion() {
    if (!notesSuggestion) return;
    const combined = recipe?.notes ? `${recipe.notes}\n${notesSuggestion}` : notesSuggestion;
    setRecipe((prev) => (prev ? { ...prev, notes: combined } : prev));
    handleCommit({ notes: combined });
    setNotesSuggestion(null);
  }

  async function handlePublish(mode: "keep_both" | "replace_original" = "keep_both") {
    if (!recipeId) return;
    setPublishing(true);
    try {
      const published = await api.publishResearch(recipeId, mode);
      await reloadRecipes();
      push(mode === "replace_original" ? "Original recipe replaced" : "Published — this recipe is now visible to guests", "success");
      router.push(`/recipe?id=${encodeURIComponent(published.recipe_id)}`);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Publish failed", "error");
    } finally {
      setPublishing(false);
      setConfirmingPublish(false);
    }
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

  if (loading) return <PageSpinner label="Loading research session…" />;

  if (error || !recipe) {
    return (
      <Card>
        <CardBody className="text-center text-muted">{error || "Recipe not found"}</CardBody>
      </Card>
    );
  }

  const canPublish = Boolean(recipe.name && recipe.components.length && recipe.steps.length);
  const isDraft = recipe.status === "draft";
  const isLinkedEditDraft = isDraft && recipe.source === "revision_draft" && Boolean(recipe.parent_version_id);
  const canResearchAssist = isDraft && recipe.source === "researched" && !recipe.parent_version_id;
  const hasUnmatchedNutrition = Boolean(recipe.nutrition.unmatched_ingredients?.length);
  const publishChecks = [
    { label: "Name", done: Boolean(recipe.name) },
    { label: "Ingredients", done: recipe.components.length > 0 },
    { label: "Steps", done: recipe.steps.length > 0 },
    { label: "Intro", done: Boolean(recipe.intro) },
    { label: "Timing", done: recipe.prep_time_minutes != null || recipe.cook_time_minutes != null },
    { label: "Image", done: Boolean(recipe.hero_image_url) },
    { label: "Nutrition reviewed", done: !hasUnmatchedNutrition },
  ];

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-muted hover:underline">
        &larr; Back to admin
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">{recipe.name}</h1>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Badge tone={isDraft ? "neutral" : "success"}>{isDraft ? "Draft" : "Published"}</Badge>
            <span>{isDraft ? saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : "Saved" : "Read-only"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDraft ? (
            <>
              <ModelPicker value={recipe.research_model} onChange={handleModelChange} />
              <IconButton
                label={previewMode ? "Edit draft" : "Preview as guest"}
                icon={previewMode ? <PencilIcon /> : <EyeIcon />}
                onClick={() => setPreviewMode((v) => !v)}
              />
              <IconButton
                label="Refresh nutrition facts"
                icon={<RefreshIcon />}
                loading={refreshingNutrition}
                onClick={handleRefreshNutrition}
              />
              <IconButton
                label="Publish"
                icon={<SendIcon />}
                disabled={!canPublish}
                onClick={() => setConfirmingPublish(true)}
              />
            </>
          ) : (
            <IconButton label="Back to dashboard" icon={<XIcon />} onClick={() => router.push("/admin")} />
          )}
        </div>
      </div>

      {isDraft ? (
        <>
          {canResearchAssist && (
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setMode("guided")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  mode === "guided" ? "bg-brand text-ink" : "bg-surface-muted text-muted hover:text-foreground"
                }`}
              >
                Guided chat
              </button>
              <button
                type="button"
                onClick={() => setMode("auto")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  mode === "auto" ? "bg-brand text-ink" : "bg-surface-muted text-muted hover:text-foreground"
                }`}
              >
                Auto-research
              </button>
            </div>
          )}

          <Card>
            <CardBody className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-ink">Publish checklist</span>
              {publishChecks.map((item) => (
                <Badge key={item.label} tone={item.done ? "success" : "warning"}>
                  {item.done ? "✓" : "!"} {item.label}
                </Badge>
              ))}
            </CardBody>
          </Card>
        </>
      ) : (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="text-muted">
              Published recipes are read-only here. Start edits from the admin dashboard to create a draft copy.
            </div>
            <IconButton label="Open dashboard" icon={<XIcon />} onClick={() => router.push("/admin")} />
          </CardBody>
        </Card>
      )}

      {confirmingPublish && (
        <Card className="border-brand/40 bg-brand-soft/40">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              {isLinkedEditDraft ? (
                <>
                  Publish <strong>{recipe.name}</strong>? Choose whether this draft replaces the original recipe or becomes a separate recipe.
                </>
              ) : (
                <>
                  Publish <strong>{recipe.name}</strong>? It becomes visible to everyone browsing the site.
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <IconButton label="Cancel publish" icon={<XIcon />} onClick={() => setConfirmingPublish(false)} />
              {isLinkedEditDraft && (
                <IconButton
                  label="Keep both versions"
                  icon={<CopyIcon />}
                  loading={publishing}
                  onClick={() => handlePublish("keep_both")}
                />
              )}
              <IconButton
                label={isLinkedEditDraft ? "Replace original" : "Publish recipe"}
                icon={<CheckIcon />}
                loading={publishing}
                onClick={() => handlePublish(isLinkedEditDraft ? "replace_original" : "keep_both")}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {isDraft ? (
        <div className={canResearchAssist ? "grid gap-4 lg:grid-cols-[360px_1fr]" : "space-y-4"}>
          {canResearchAssist && (
            <div className="lg:sticky lg:top-20 lg:h-[calc(100vh-8rem)]">
              {mode === "guided" ? (
                <ResearchChatPanel
                  recipeId={recipe.recipe_id}
                  messages={messages}
                  pendingProposal={pendingProposal}
                  sending={sending}
                  deciding={deciding}
                  onSend={handleSend}
                  onApprove={() => handleDecision(true)}
                  onDecline={() => handleDecision(false)}
                  notes={recipe.notes ?? ""}
                  onNotesChange={handleNotesChange}
                  notesSuggestion={notesSuggestion}
                  onAcceptNotesSuggestion={handleAcceptNotesSuggestion}
                  onDismissNotesSuggestion={() => setNotesSuggestion(null)}
                />
              ) : (
                <AutoResearchPanel
                  recipe={recipe}
                  onComplete={handleAutoComplete}
                  onPromptChange={handleStartingPromptChange}
                />
              )}
            </div>
          )}
          <div className="space-y-4">
            {!previewMode && (
              <Card className={reviewHighlights.length ? "border-brand/50 bg-brand-soft/30" : ""}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-ink">Recipe-wide AI edit</div>
                        <div className="text-xs text-muted">Apply one broad instruction across the draft, then review highlighted sections.</div>
                      </div>
                      {reviewHighlights.length > 0 && (
                        <IconButton
                          label="Clear review highlights"
                          icon={<CheckIcon />}
                          onClick={() => {
                            setReviewHighlights([]);
                            setReviewNotes(null);
                          }}
                        />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Textarea
                        value={wideEditPrompt}
                        onChange={(e) => setWideEditPrompt(e.target.value)}
                        rows={3}
                        placeholder="Make this recipe keto friendly; make it kid friendly; turn it into a weeknight version..."
                      />
                      <IconButton
                        label="Apply recipe-wide edit"
                        icon={<SendIcon />}
                        loading={wideEditing}
                        disabled={!wideEditPrompt.trim()}
                        onClick={handleWideEdit}
                      />
                    </div>
                    {(reviewHighlights.length > 0 || reviewNotes) && (
                      <div className="rounded-md border border-brand/30 bg-surface px-3 py-2 text-xs text-muted">
                        {reviewHighlights.length > 0 && (
                          <div>
                            Review: <span className="font-medium text-foreground">{reviewHighlights.join(", ")}</span>
                          </div>
                        )}
                      {reviewNotes && <div className="mt-1">{reviewNotes}</div>}
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
            <ResearchDocumentPreview
              key={`${recipe.version_id}:${recipe.updated_at}`}
              recipe={recipe}
              previewMode={previewMode}
              onCommit={handleCommit}
              onRefine={handleRefineSection}
              onRefreshNutrition={isDraft ? handleRefreshNutrition : undefined}
              refreshingNutrition={refreshingNutrition}
              highlightedFields={reviewHighlights}
              onClearHighlights={() => {
                setReviewHighlights([]);
                setReviewNotes(null);
              }}
            />
          </div>
        </div>
      ) : (
        <ResearchDocumentPreview
          key={`${recipe.version_id}:${recipe.updated_at}`}
          recipe={recipe}
          previewMode
          onCommit={() => undefined}
          onRefine={async () => undefined}
          highlightedFields={[]}
          onClearHighlights={() => undefined}
        />
      )}
    </div>
  );
}

export default function ResearchWorkspacePage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <ResearchWorkspaceInner />
    </Suspense>
  );
}
