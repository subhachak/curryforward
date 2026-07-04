// Lightweight, client-side intent heuristics for the Assistant.
//
// There's no backend NL-routing endpoint — recipe customization and
// drafting are already LLM-driven server-side (see llm_agent.py), but
// *which* backend action a free-text message maps to (search vs. customize
// vs. create/draft) has to be decided somewhere. Rather than build a real
// intent classifier for a single-user local app, this does simple
// keyword/length matching. It's deliberately conservative: when unsure, it
// falls back to search, which is harmless.
import type { RecipeSummary } from "./types";

const STOPWORDS = new Set([
  "a", "an", "the", "me", "my", "for", "with", "and", "of", "to", "show",
  "find", "recipe", "recipes", "something", "some", "please", "can", "you",
  "i", "want", "like", "get", "give",
]);

export function searchRecipes(query: string, recipes: RecipeSummary[]): RecipeSummary[] {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

  if (tokens.length === 0) return [];

  return recipes
    .map((r) => {
      const haystack = [r.name, r.category ?? "", ...r.cuisine_tags].join(" ").toLowerCase();
      const score = tokens.filter((t) => haystack.includes(t)).length;
      return { r, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((m) => m.r);
}

const CREATE_INTENT = /\b(create|generate|invent|make me|make up|dream up|new recipe|come up with|draft)\b/i;

export function looksLikeCreateRequest(message: string): boolean {
  return CREATE_INTENT.test(message);
}

// A pasted recipe draft reads very differently from a chat message: long,
// often multi-line, usually mentions quantities/units. If it looks like
// that, treat it as a draft to structure even without an explicit "create"
// verb — pasting *is* the request.
const UNIT_WORDS = /\b(cup|cups|tbsp|tsp|oz|ounce|gram|grams|g|kg|lb|ml|pinch|clove|cloves)\b/i;

export function looksLikeDraftPaste(message: string): boolean {
  if (message.length > 220) return true;
  if (message.split("\n").length >= 3) return true;
  return message.length > 80 && UNIT_WORDS.test(message);
}
