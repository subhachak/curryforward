"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";

export interface DisplayMessage {
  id: number;
  role: "user" | "assistant";
  kind: "text" | "search";
  text: string;
}

interface ResearchChatPanelProps {
  messages: DisplayMessage[];
  pendingProposal: { query: string } | null;
  sending: boolean;
  deciding: boolean;
  onSend: (message: string) => void;
  onApprove: () => void;
  onDecline: () => void;
  notes: string;
  onNotesChange: (value: string) => void;
  notesSuggestion: string | null;
  onAcceptNotesSuggestion: () => void;
  onDismissNotesSuggestion: () => void;
}

export function ResearchChatPanel({
  messages,
  pendingProposal,
  sending,
  deciding,
  onSend,
  onApprove,
  onDecline,
  notes,
  onNotesChange,
  notesSuggestion,
  onAcceptNotesSuggestion,
  onDismissNotesSuggestion,
}: ResearchChatPanelProps) {
  const [input, setInput] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pendingProposal, sending]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending || pendingProposal) return;
    setInput("");
    onSend(message);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border bg-surface-muted px-4 py-2.5">
        <div className="text-sm font-semibold text-ink">Research chat</div>
        <button
          type="button"
          onClick={() => setNotesOpen((v) => !v)}
          className="text-xs font-medium text-brand-hover hover:underline"
        >
          {notesOpen ? "Hide notes" : "Notes"}
        </button>
      </div>

      {notesOpen && (
        <div className="border-b border-border bg-surface-muted px-4 py-3">
          <label className="mb-1 block text-xs font-medium text-muted">
            Your research scratchpad — not shown to guests, never published.
          </label>
          <Textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={4}
            placeholder="Sources, half-formed ideas, things to double check…"
          />
        </div>
      )}

      {notesSuggestion && (
        <div className="border-b border-border bg-accent-soft px-4 py-3 text-sm">
          <div className="mb-2 text-foreground">
            <span className="font-semibold">Note suggestion:</span> {notesSuggestion}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onAcceptNotesSuggestion}>
              Add to notes
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismissNotesSuggestion}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((m) =>
          m.kind === "search" ? (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[90%] rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent-hover">
                🔍 Searched: &ldquo;{m.text}&rdquo;
              </div>
            </div>
          ) : (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-brand text-ink" : "bg-surface-muted text-foreground"
                }`}
              >
                {m.text}
              </div>
            </div>
          )
        )}

        {pendingProposal && (
          <div className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-3 text-sm">
            <div className="mb-2 text-foreground">
              🔍 Search the web for: <strong>&ldquo;{pendingProposal.query}&rdquo;</strong>?
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="accent" loading={deciding} onClick={onApprove}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" disabled={deciding} onClick={onDecline}>
                Skip
              </Button>
            </div>
          </div>
        )}

        {sending && <div className="text-xs text-muted">Thinking…</div>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={pendingProposal ? "Approve or skip the search above first…" : "Tell it what to research or build…"}
          disabled={Boolean(pendingProposal)}
        />
        <Button type="submit" size="sm" loading={sending} disabled={!input.trim() || Boolean(pendingProposal)}>
          Send
        </Button>
      </form>
    </div>
  );
}
