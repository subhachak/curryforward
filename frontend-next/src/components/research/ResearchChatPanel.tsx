"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, PencilIcon, SearchIcon, SendIcon, XIcon } from "@/components/ui/icons";
import { CopyAssistField } from "@/components/research/CopyAssistField";

export interface DisplayMessage {
  id: number;
  role: "user" | "assistant";
  kind: "text" | "search";
  text: string;
}

interface ResearchChatPanelProps {
  recipeId: string;
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
  recipeId,
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
        <IconButton
          label={notesOpen ? "Hide notes" : "Show notes"}
          icon={<PencilIcon />}
          variant="ghost"
          onClick={() => setNotesOpen((v) => !v)}
        />
      </div>

      {notesOpen && (
        <div className="border-b border-border bg-surface-muted px-4 py-3">
          <label className="mb-1 block text-xs font-medium text-muted">
            Your research scratchpad — not shown to guests, never published.
          </label>
          <CopyAssistField
            recipeId={recipeId}
            fieldLabel="research scratchpad notes"
            value={notes}
            onChange={onNotesChange}
            rows={4}
            multiline
            placeholder="Sources, half-formed ideas, things to double check…"
          />
        </div>
      )}

      {notesSuggestion && (
        <div className="border-b border-border bg-accent-soft px-4 py-3 text-sm">
          <div className="mb-2 text-foreground">
            <span className="font-semibold">Note suggestion:</span> {notesSuggestion}
          </div>
          <div className="flex gap-1.5">
            <IconButton label="Add to notes" icon={<CheckIcon />} onClick={onAcceptNotesSuggestion} />
            <IconButton label="Dismiss note suggestion" icon={<XIcon />} variant="ghost" onClick={onDismissNotesSuggestion} />
          </div>
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((m) =>
          m.kind === "search" ? (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[90%] rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent-hover">
                <span className="inline-flex items-center gap-1">
                  <SearchIcon className="h-3.5 w-3.5" /> Searched: &ldquo;{m.text}&rdquo;
                </span>
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
              <span className="inline-flex items-center gap-1">
                <SearchIcon className="h-4 w-4" /> Search the web for: <strong>&ldquo;{pendingProposal.query}&rdquo;</strong>?
              </span>
            </div>
            <div className="flex gap-1.5">
              <IconButton label="Approve search" icon={<CheckIcon />} variant="accent" loading={deciding} onClick={onApprove} />
              <IconButton label="Skip search" icon={<XIcon />} disabled={deciding} onClick={onDecline} />
            </div>
          </div>
        )}

        {sending && <div className="text-xs text-muted">Thinking…</div>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
        <CopyAssistField
          recipeId={recipeId}
          fieldLabel="research chat message"
          value={input}
          onChange={setInput}
          placeholder={pendingProposal ? "Approve or skip the search above first…" : "Tell it what to research or build…"}
          disabled={Boolean(pendingProposal)}
          className="flex-1"
        />
        <IconButton
          type="submit"
          label="Send"
          icon={<SendIcon />}
          loading={sending}
          disabled={!input.trim() || Boolean(pendingProposal)}
        />
      </form>
    </div>
  );
}
