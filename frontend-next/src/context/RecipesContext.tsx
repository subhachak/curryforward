"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { RecipeSummary } from "@/lib/types";
import { useToast } from "@/context/ToastContext";

interface RecipesContextValue {
  recipes: RecipeSummary[];
  categories: string[];
  tags: string[];
  loading: boolean;
  reload: () => Promise<void>;
}

const RecipesContext = createContext<RecipesContextValue | null>(null);

export function RecipesProvider({ children }: { children: React.ReactNode }) {
  const { push } = useToast();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listRecipes();
      setRecipes(list);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Failed to load recipes", "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => r.category && set.add(r.category));
    return [...set].sort();
  }, [recipes]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => r.cuisine_tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [recipes]);

  const value = useMemo(
    () => ({ recipes, categories, tags, loading, reload }),
    [recipes, categories, tags, loading, reload]
  );

  return <RecipesContext.Provider value={value}>{children}</RecipesContext.Provider>;
}

export function useRecipes() {
  const ctx = useContext(RecipesContext);
  if (!ctx) throw new Error("useRecipes must be used within RecipesProvider");
  return ctx;
}
