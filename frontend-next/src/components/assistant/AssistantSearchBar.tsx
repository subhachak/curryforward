"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAssistant } from "@/context/AssistantContext";
import { useAuth } from "@/context/AuthContext";
import { useRecipes } from "@/context/RecipesContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import { looksLikeCreateRequest, looksLikeDraftPaste, searchRecipes } from "@/lib/assistantHeuristics";
import { RefreshIcon, SearchIcon, SendIcon, SparklesIcon, XIcon } from "@/components/ui/icons";
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

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function MarkdownMessage({ text }: { text: string }) {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\s+\*\s+(?=\*\*|[A-Za-z0-9])/g, "\n* ");
  const lines = normalized.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let numberedItems: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const content = paragraph.join(" ").trim();
    if (content) {
      blocks.push(
        <p key={`p-${blocks.length}`}>
          <InlineMarkdown text={content} />
        </p>
      );
    }
    paragraph = [];
  }

  function flushList() {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="ml-5 list-disc space-y-1">
          {listItems.map((item, index) => (
            <li key={index}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
    if (numberedItems.length > 0) {
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="ml-5 list-decimal space-y-1">
          {numberedItems.map((item, index) => (
            <li key={index}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ol>
      );
      numberedItems = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      numberedItems = [];
      listItems.push(bullet[1]);
    } else if (numbered) {
      flushParagraph();
      listItems = [];
      numberedItems.push(numbered[1]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return <div className="space-y-2 leading-relaxed">{blocks.length ? blocks : text}</div>;
}

export function AssistantSearchBar() {
  const { open, setOpen, target } = useAssistant();
  const { isAdmin } = useAuth();
  const { recipes, reload } = useRecipes();
  const { push: toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [headerInput, setHeaderInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryTurn[]>([]);
  const [researchAssistantHistory, setResearchAssistantHistory] = useState<ChatHistoryTurn[]>([]);
  const [draftSession, setDraftSession] = useState<DraftSession | null>(null);
  const [routeRecipeId, setRouteRecipeId] = useState<string | null>(null);

  const nextId = useRef(0);
  const prevTargetId = useRef<string | null>(null);
  const prevRouteFocus = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const isResearchWorkspace = normalizedPathname === "/recipe/research";
  const researchRecipeId = isResearchWorkspace ? routeRecipeId : null;
  const isWorkspace = normalizedPathname.startsWith("/admin");
  const isBrowse = normalizedPathname.startsWith("/recipes");
  const isHome = normalizedPathname === "/" || normalizedPathname === "/home-v2" || normalizedPathname === "/home-classic";
  const routeFocus = researchRecipeId ? `research:${researchRecipeId}` : target?.recipe.recipe_id ? `recipe:${target.recipe.recipe_id}` : normalizedPathname;

  const assistantContext = useMemo(() => {
    if (researchRecipeId && isAdmin) {
      return {
        title: "Workspace edit assistant",
        badge: "Editing draft",
        headerPlaceholder: "Ask about this draft, schema, grams, or technique...",
        inputPlaceholder: "What is 2 cups of almond flour in grams?",
      };
    }
    if (target) {
      return {
        title: `${target.recipe.name} assistant`,
        badge: `Viewing: ${target.recipe.name}`,
        headerPlaceholder: "Ask about this recipe...",
        inputPlaceholder: "Make this less spicy, scale it, or ask about an ingredient...",
      };
    }
    if (isWorkspace && isAdmin) {
      return {
        title: "Workspace assistant",
        badge: "Workspace operations",
        headerPlaceholder: "Search recipes, drafts, or actions...",
        inputPlaceholder: "Find drafts needing review, import recipes, or ask about model usage...",
      };
    }
    if (isBrowse) {
      return {
        title: "Recipe finder",
        badge: "Searching all recipes",
        headerPlaceholder: "Search or ask...",
        inputPlaceholder: "Bengali fish curry under 45 minutes...",
      };
    }
    if (isHome) {
      return {
        title: "Ask CurryForward",
        badge: "Recipe discovery",
        headerPlaceholder: "Ask CurryForward",
        inputPlaceholder: "Search, ask, or paste a recipe...",
      };
    }
    return {
      title: "Ask CurryForward",
      badge: "Searching all recipes",
      headerPlaceholder: "Search, ask, or paste a recipe...",
      inputPlaceholder: "Search, ask, or paste a recipe...",
    };
  }, [isAdmin, isBrowse, isHome, isWorkspace, researchRecipeId, target]);

  const suggestions = useMemo(() => {
    if (researchRecipeId && isAdmin) {
      return [
        "What is 2 cups almond flour in grams?",
        "Which fields are missing before publish?",
        "Suggest utensils for this recipe",
        "How should I convert this pan size?",
      ];
    }
    if (target) {
      return ["Make this less spicy", "Scale to 8 servings", "Make it dairy-free", "Explain this ingredient"];
    }
    if (isWorkspace && isAdmin) {
      return ["Create a new recipe draft", "Find recipes missing nutrition", "Import recipes from Excel", "Which model edits recipes?"];
    }
    if (isBrowse) {
      return ["Bengali sweets with nolen gur", "Quick chicken dinner", "Vegetarian festive recipes", "Fish curry under 45 minutes"];
    }
    return ["Find Bengali sweets", "Show easy chicken recipes", "Create a patishapta draft", "What can I make for dinner?"];
  }, [isAdmin, isBrowse, isWorkspace, researchRecipeId, target]);

  function addMessage(role: Message["role"], content: ReactNode) {
    setMessages((prev) => [...prev, { id: nextId.current++, role, content }]);
  }

  function goTo(href: string) {
    setOpen(false);
    router.push(href);
  }

  function clearChat() {
    setMessages([]);
    setChatHistory([]);
    setResearchAssistantHistory([]);
    setDraftSession(null);
    setInput("");
    setHeaderInput("");
  }

  useEffect(() => {
    if (!isResearchWorkspace) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRouteRecipeId(null);
      return;
    }
    setRouteRecipeId(new URLSearchParams(window.location.search).get("id"));
  }, [isResearchWorkspace]);

  // Reset both conversation contexts whenever the assistant's focus shifts
  // (navigating to a different recipe, or leaving one) — chatHistory only
  // makes sense for the recipe it was built against, and an in-progress
  // draft only makes sense while there's no recipe in focus.
  useEffect(() => {
    const nextTargetId = target?.recipe.recipe_id ?? null;
    if (prevTargetId.current !== nextTargetId) {
      setChatHistory([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!researchRecipeId) setDraftSession(null);
      if (messages.length > 0) {
        if (target) {
          addMessage("assistant", <>Now focused on <strong>{target.recipe.name}</strong>.</>);
        } else {
          addMessage("assistant", "Back to all recipes and CurryForward discovery.");
        }
      }
    }
    prevTargetId.current = nextTargetId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    if (prevRouteFocus.current !== routeFocus) {
      setResearchAssistantHistory([]);
      if (researchRecipeId && isAdmin && messages.length > 0) {
        addMessage("assistant", "Now focused on this draft edit workspace.");
      }
      prevRouteFocus.current = routeFocus;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeFocus, researchRecipeId, isAdmin]);

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
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  async function handleAdminResearchAsk(message: string) {
    if (!researchRecipeId) return;
    try {
      const result = await api.askResearchAssistant(researchRecipeId, {
        question: message,
        history: researchAssistantHistory.slice(-8),
      });
      addMessage("assistant", result.reply);
      setResearchAssistantHistory((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      ]);
    } catch (e) {
      addMessage("assistant", e instanceof ApiError ? e.message : "The workspace assistant is unavailable.");
    }
  }

  async function handleCustomize(message: string) {
    if (!target) return;
    try {
      const result = await api.chat(target.recipe.recipe_id, message, chatHistory);
      const summary = result.reply || result.change_summary || "Done.";
      addMessage("assistant", summary);
      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: summary },
      ]);
      if (result.persisted) {
        target.onPersisted();
      } else if (result.new_version) {
        target.onPreview(result.new_version);
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
        <div className="space-y-2">
          <div>I didn&apos;t find an exact recipe for that yet.</div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md bg-[#FF6B00] px-2.5 py-1 text-xs font-semibold text-white" onClick={() => goTo("/recipes")}>
              Browse recipes
            </button>
            {isAdmin && (
              <button className="rounded-md border border-[#E8D3B8] px-2.5 py-1 text-xs font-semibold text-[#5A2145]" onClick={() => setInput(`Create a recipe for ${message}`)}>
                Create draft
              </button>
            )}
          </div>
        </div>
      );
      return;
    }
    addMessage(
      "assistant",
      <div className="space-y-1.5">
        <div className="font-semibold text-[#2E1B14]">Recipes</div>
        {matches.map((r) => (
          <button
            key={r.recipe_id}
            className="block w-full rounded-md border border-[#E8D3B8] bg-white px-3 py-2 text-left text-sm hover:bg-[#FFF8F1]"
            onClick={() => goTo(`/recipe?id=${encodeURIComponent(r.recipe_id)}`)}
          >
            <span className="font-semibold text-[#2E1B14]">{r.name}</span>
            <span className="mt-0.5 block text-xs text-[#8A7564]">
              {[r.category, ...r.cuisine_tags].filter(Boolean).slice(0, 3).join(" · ") || "Recipe"}
            </span>
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
        base_servings_amount: null,
        base_servings_unit: "g",
        serving_size_amount: 100,
        serving_size_unit: "g",
        components: draft.components,
        steps: draft.steps,
        hero_image_url: null,
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

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || sending) return;
    setInput("");
    setHeaderInput("");
    setOpen(true);
    addMessage("user", message);
    setSending(true);
    try {
      if (researchRecipeId && isAdmin) {
        await handleAdminResearchAsk(message);
      } else if (target) {
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

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    await sendMessage(input);
  }

  async function handleHeaderSubmit(e: FormEvent) {
    e.preventDefault();
    if (headerInput.trim()) {
      await sendMessage(headerInput);
    } else {
      setOpen(true);
    }
  }

  return (
    <>
      <form onSubmit={handleHeaderSubmit} className="ml-auto min-w-0 flex-1 max-w-sm">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A7564]" />
          <input
            value={headerInput}
            onChange={(e) => setHeaderInput(e.target.value)}
            placeholder={assistantContext.headerPlaceholder}
            className="w-full rounded-md border border-[#E8D3B8] bg-white py-2 pl-9 pr-10 text-sm placeholder:text-[#8A7564] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B00]/25"
          />
          <button
            type="submit"
            aria-label="Open Ask CurryForward"
            title="Open Ask CurryForward"
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md bg-[#FFF1E6] text-[#5A2145] hover:bg-[#FFE0C4]"
          >
            <SparklesIcon className="h-4 w-4" />
          </button>
        </div>
      </form>

      {open && (
        <div className="fixed inset-0 z-[80] flex justify-end">
          <button
            type="button"
            aria-label="Close Ask CurryForward"
            className="absolute inset-0 bg-black/10"
            onClick={() => setOpen(false)}
          />
          <aside className="relative z-[81] flex h-dvh w-full max-w-[460px] flex-col border-l border-[#E8D3B8] bg-white shadow-2xl sm:w-[440px]">
            <div className="shrink-0 border-b border-[#E8D3B8] bg-[#FFF8F1] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-[#2E1B14]">{assistantContext.title}</div>
                  <div className="mt-1 inline-flex rounded-full bg-[#F7DDED] px-2 py-0.5 text-[11px] font-semibold text-[#5A2145]">
                    {assistantContext.badge}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearChat}
                    aria-label="Clear assistant chat"
                    title="Clear chat"
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-[#E8D3B8] bg-white text-[#5A4038] hover:bg-[#FFF1E6]"
                  >
                    <RefreshIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close Ask CurryForward"
                    title="Close Ask CurryForward"
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-[#E8D3B8] bg-white text-[#5A4038] hover:bg-[#FFF1E6]"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-white px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <div className="rounded-md border border-[#E8D3B8] bg-[#FFF8F1] px-3 py-2 text-sm text-[#2E1B14]">
                    {researchRecipeId && isAdmin ? (
                      <>
                        I can answer edit questions using the draft, internal schemas, local nutrition data, and web lookup when needed.
                      </>
                    ) : target ? (
                      <>
                        Hi! I&apos;m focused on <strong>{target.recipe.name}</strong>.{" "}
                        {isAdmin
                          ? "Ask a question, preview a change, or create a lighter version."
                          : "Ask a question about this recipe’s ingredients, steps, timing, serving, or substitutions."}
                      </>
                    ) : isWorkspace && isAdmin ? (
                      <>Search recipes, ask about workspace operations, or start a new recipe workflow.</>
                    ) : isAdmin ? (
                      <>Hi! Ask me to find a recipe, or paste/describe a new one and I&apos;ll draft it.</>
                    ) : (
                      <>Hi! Ask me to find a recipe, explain a dish, or discover what to cook next.</>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => sendMessage(suggestion)}
                        className="rounded-full border border-[#E8D3B8] bg-white px-3 py-1.5 text-xs font-medium text-[#5A4038] hover:border-[#FF6B00] hover:text-[#2E1B14]"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "user" ? "bg-[#FFB000] text-[#2E1B14]" : "bg-[#FFF8F1] text-[#2E1B14]"
                    }`}
                >
                  {m.role === "assistant" && typeof m.content === "string" ? (
                    <MarkdownMessage text={m.content} />
                  ) : (
                    m.content
                  )}
                </div>
              </div>
              ))}
              {sending && <div className="text-xs text-[#8A7564]">Thinking...</div>}
            </div>

            <form onSubmit={handleSend} className="shrink-0 border-t border-[#E8D3B8] bg-[#FFF8F1] p-3">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={assistantContext.inputPlaceholder}
                  className="min-w-0 flex-1 rounded-md border border-[#E8D3B8] bg-white px-3 py-2 text-sm placeholder:text-[#8A7564] focus:outline-none focus:ring-2 focus:ring-[#FF6B00]/25"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || sending}
                  aria-label="Send to Ask CurryForward"
                  title="Send"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#FF6B00] text-white disabled:opacity-50"
                >
                  {sending ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <SendIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
