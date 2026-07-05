// The backend persists the *raw* LiteLLM/OpenAI-shaped message list (tool
// calls/tool results included) so a research session survives a refresh or a
// closed browser tab — see RecipeVersion.research_conversation. That's not a
// display-friendly transcript, so this reconstructs one when a workspace is
// (re)loaded: each assistant text message is a JSON envelope
// ({reply, recipe_patch, notes_suggestion}) — we only need `reply` for
// display — and each tool call becomes a resolved "searched for" line (if it
// were still pending, `pending_tool_use` on the conversation object says so,
// and the caller shows a live approval card instead of a bubble). "tool"-role
// messages carry the actual search results back to the model — not shown as
// a separate bubble, the search line already represents that exchange.

interface RawToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface RawMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: RawToolCall[] | null;
}

export interface TranscriptEntry {
  role: "user" | "assistant";
  kind: "text" | "search";
  text: string;
}

export function reconstructTranscript(messages: unknown): TranscriptEntry[] {
  if (!Array.isArray(messages)) return [];
  const entries: TranscriptEntry[] = [];

  for (const raw of messages as RawMessage[]) {
    if (raw.role === "system" || raw.role === "tool") continue;

    if (raw.role === "assistant" && raw.tool_calls?.length) {
      for (const call of raw.tool_calls) {
        try {
          const args = JSON.parse(call.function.arguments);
          if (typeof args.query === "string") {
            entries.push({ role: "assistant", kind: "search", text: args.query });
          }
        } catch {
          // malformed tool-call arguments — skip rather than show garbage
        }
      }
      continue;
    }

    if (typeof raw.content === "string" && raw.content) {
      let text = raw.content;
      try {
        const parsed = JSON.parse(raw.content);
        if (typeof parsed.reply === "string") text = parsed.reply;
      } catch {
        // not JSON — show the raw text as a fallback
      }
      entries.push({ role: raw.role as "user" | "assistant", kind: "text", text });
    }
  }
  return entries;
}
