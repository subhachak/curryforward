"use client";

import { useState } from "react";
import { HeartIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";

// Guests have no accounts, so there's no server-side per-visitor dedup for
// likes — this just keeps the toggle state honest within one browser.
const STORAGE_KEY = "curryforward:liked-recipes";

function readLikedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeLikedIds(ids: Set<string>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

// Keyed by recipeId at the call site (see recipe/page.tsx) so a navigation
// to a different recipe remounts this component instead of needing effects
// to resync liked/count from props.
export function LikeButton({ recipeId, likeCount }: { recipeId: string; likeCount: number }) {
  const [liked, setLiked] = useState(() => readLikedIds().has(recipeId));
  const [count, setCount] = useState(likeCount);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    setPending(true);
    const wasLiked = liked;
    setLiked(!wasLiked);
    setCount((c) => (wasLiked ? Math.max(0, c - 1) : c + 1));
    try {
      const result = wasLiked ? await api.unlikeRecipe(recipeId) : await api.likeRecipe(recipeId);
      setCount(result.like_count);
      const ids = readLikedIds();
      if (wasLiked) ids.delete(recipeId);
      else ids.add(recipeId);
      writeLikedIds(ids);
    } catch {
      setLiked(wasLiked);
      setCount((c) => (wasLiked ? c + 1 : Math.max(0, c - 1)));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={liked}
      aria-label={liked ? "Unlike recipe" : "Like recipe"}
      title={liked ? "Unlike recipe" : "Like recipe"}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${
        liked
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface text-foreground hover:bg-surface-muted"
      }`}
    >
      <HeartIcon className="h-4 w-4" fill={liked ? "currentColor" : "none"} />
      <span>{count}</span>
    </button>
  );
}
