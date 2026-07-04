"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { RecipeDetail } from "@/lib/types";

export interface ActiveRecipeTarget {
  recipe: RecipeDetail;
  onPersisted: () => void;
  onPreview: (updated: RecipeDetail) => void;
}

interface AssistantContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /**
   * Lets the floating Assistant widget know "the user is looking at this
   * recipe" without threading props through every page — a recipe detail
   * page registers itself here on load and clears it on unmount, so the
   * assistant routes chat messages to that recipe's /chat endpoint instead
   * of treating them as a search/create request.
   */
  target: ActiveRecipeTarget | null;
  setTarget: (target: ActiveRecipeTarget | null) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ActiveRecipeTarget | null>(null);
  const value = useMemo(() => ({ open, setOpen, target, setTarget }), [open, target]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within AssistantProvider");
  return ctx;
}
