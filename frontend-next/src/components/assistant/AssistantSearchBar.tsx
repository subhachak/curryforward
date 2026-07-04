"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAssistant } from "@/context/AssistantContext";
import { useAuth } from "@/context/AuthContext";
import { useRecipes } from "@/context/RecipesContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import { looksLikeCreateRequest, looksLikeDraftPaste, searchRecipes } from "@/lib/assistantHeuristics";
import type { ChatHistoryTurn, DraftRecipeResult } from "@/lib/types";

interface Message {
  id: number;
  role: "user" | "assistant";
  content: ReactNode;
}

interface DraftSession {
  draft: DraftRecipeResult | null;
  history: ChatHistoryTurn[];
}

export function AssistantSearchBar() {
  const { open, setOpen, target } = useAssistant();
  const { isAdmin } = useAuth();
  const { recipes, reload } = useRecipes();
  const { push: toast } = useToast();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryTurn[]>([]);
  const [draftSession, setDraftSession] = useState<DraftSession | null>(null);

  const nextId = useRef(0);
  const prevTargetId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function addMessage(role: Message["role"], content: ReactNode) {
    setMessages((prev) => [...prev, { id: nextId.current++, role, content }]);
  }

  function goTo(href: string) {
    setOpen(false);
    router.push(href);
  }

  // Reset both conversation contexts whenever the assistant's focus shifts
  // (navigating to a different recipe, or leaving one) — chatHistory only
  // makes sense for the recipe it was built against, and an in-progress
  // draft only makes sense while there's no recipe in focus.
  useEffect(() => {
    const nextTargetId = target?.recipe.recipe_id ?? null;
    if (prevTargetId.current !== nextTargetId) {
      setChatHistory([]);
      setDraftSession(null);
      if (messages.length > 0) {
        if (target) {
          addMessage("assistant", <>Now focused on <strong>{target.recipe.name}</strong> — tell me what to change.</>);
        } else {
          addMessage("assistant", "Back to general search — ask me to find a recipe or create a new one.");
        }
      }
    }
    prevTargetId.current = nextTargetId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  // Focus the input when opened externally (e.g. the home page's "Ask the
  // assistant" button), not just when the user clicks the input directly.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  async function handleCustomize(message: string) {
    if (!target) return;
    try {
      const result = await api.chat(target.recipe.recipe_id, message, chatHistory);
      const summary = result.change_summary || "Done.";
      addMessage("assistant", summary);
      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: summary },
      ]);
      if (result.persisted) {
        target.onPersisted();
      } else {
        target.onPreview(result.new_version);
        if (result.note) addMessage("assistant", result.note);
      }
    } catch (e) {
      addMessage("assistant", e instanceof ApiError ? e.message : "Something went wrong with that change.");
    }
  }

  function handleSearch(message: string) {
    const matches = searchRecipes(message, recipes);
    if (matches.length === 0) {
      addMessage(
        "assistant",
        <div>
          I couldn&apos;t find a match for that.{" "}
          <button className="underline" onClick={() => goTo("/recipes")}>
            Browse all recipes
          </button>
          {isAdmin && <> — or paste/describe a recipe and I&apos;ll draft it.</>}
        </div>
      );
      return;
    }
    addMessage(
      "assistant",
      <div className="space-y-1.5">
        <div>Here&apos;s what I found:</div>
        {matches.map((r) => (
          <button
            key={r.recipe_id}
            className="block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-left text-sm hover:bg-brand-soft"
            onClick={() => goTo(`/recipe?id=${encodeURIComponent(r.recipe_id)}`)}
          >
            {r.name}
            {r.category && <span className="ml-1 text-xs text-muted">({r.category})</span>}
          </button>
        ))}
      </div>
    );
  }

  async function handleSaveDraft(draft: DraftRecipeResult) {
    try {
      const created = await api.createRecipe({
        name: draft.name,
        category: draft.category,
        cuisine_tags: draft.cuisine_tags,
        base_servings_amount: draft.base_servings.amount,
        base_servings_unit: draft.base_servings.unit,
        components: draft.components,
        steps: draft.steps,
      });
      await reload();
      setDraftSession(null);
      addMessage(
        "assistant",
        <div>
          Saved!{" "}
          <button className="underline" onClick={() => goTo(`/recipe?id=${encodeURIComponent(created.recipe_id)}`)}>
            View {created.name}
          </button>
        </div>
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Save failed", "error");
    }
  }

  async function handleDraftTurn(message: string, session: DraftSession) {
    try {
      const result = await api.draftRecipe(message, session.history, session.draft);
      const summary = result.change_summary || `Drafted "${result.name}".`;
      const newHistory: ChatHistoryTurn[] = [
        ...session.history,
        { role: "user", content: message },
        { role: "assistant", content: summary },
      ];
      setDraftSession({ draft: result, history: newHistory });
      addMessage(
        "assistant",
        <div className="space-y-2">
          <div>{summary}</div>
          <div className="rounded-md border border-border bg-surface-muted p-2 text-xs">
            <div className="font-semibold text-foreground">{result.name}</div>
            <div className="text-muted">
              {result.components.length} component{result.components.length === 1 ? "" : "s"},{" "}
              {result.steps.length} step{result.steps.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-ink hover:bg-brand-hover"
              onClick={() => handleSaveDraft(result)}
            >
              Save recipe
            </button>
            <span className="text-xs text-muted">or keep describing changes…</span>
          </div>
        </div>
      );
    } catch (e) {
      addMessage("assistant", e instanceof ApiError ? e.message : "Drafting failed.");
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    setOpen(true);
    addMessage("user", message);
    setSending(true);
    try {
      if (target) {
        await handleCustomize(message);
      } else if (draftSession) {
        await handleDraftTurn(message, draftSession);
      } else if (isAdmin && (looksLikeCreateRequest(message) || looksLikeDraftPaste(message))) {
        const session: DraftSession = { draft: null, history: [] };
        setDraftSession(session);
        await handleDraftTurn(message, session);
      } else {
        handleSearch(message);
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 max-w-md">
      <form onSubmit={handleSend}>
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={target ? `Ask about ${target.recipe.name}…` : "Search, ask, or paste a recipe…"}
            className="w-full rounded-full border border-border bg-surface-muted py-2 pl-9 pr-3 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
        </div>
      </form>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[28rem] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border bg-surface-muted px-4 py-2.5">
            <div className="text-sm font-semibold text-ink">Assistant</div>
            <div className="text-xs text-muted">
              {target ? `Focused on ${target.recipe.name}` : "Search & create"}
            </div>
          </div>

          <div ref={listRef} className="max-h-96 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-foreground">
                {target ? (
                  <>
                    Hi! I&apos;m focused on <strong>{target.recipe.name}</strong>. Tell me what to
                    change — e.g. &ldquo;make it spicier&rdquo; or &ldquo;halve the sugar&rdquo;.
                    {!isAdmin && (
                      <div className="mt-1 text-xs text-muted">
                        Guest mode — changes preview for this session only.
                      </div>
                    )}
                  </>
                ) : isAdmin ? (
                  <>
                    Hi! Ask me to find a recipe, or paste/describe a new one and I&apos;ll draft
                    it — e.g. &ldquo;a spicy Thai green curry&rdquo; or paste a full recipe you
                    found somewhere.
                  </>
                ) : (
                  <>
                    Hi! Ask me to find a recipe — e.g. &ldquo;show me something spicy with
                    chicken&rdquo;. Open a recipe and I can help customize it too (preview only as
                    a guest).{" "}
                    <Link href="/login" className="underline" onClick={() => setOpen(false)}>
                      Log in as admin
                    </Link>{" "}
                    to create and save new recipes.
                  </>
                )}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-brand text-ink" : "bg-surface-muted text-foreground"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && <div className="text-xs text-muted">Thinking…</div>}
          </div>
        </div>
      )}
    </div>
  );
}
