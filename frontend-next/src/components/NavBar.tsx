"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRecipes } from "@/context/RecipesContext";
import { AssistantSearchBar } from "@/components/assistant/AssistantSearchBar";

function RecipesMenu() {
  const { categories } = useRecipes();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function closeSoon() {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  return (
    <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <Link
        href="/recipes"
        className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-brand-hover"
      >
        Recipes
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Link>
      {open && categories.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-2 w-48 rounded-lg border border-border bg-surface py-1.5 shadow-lg">
          <Link
            href="/recipes"
            className="block px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted"
          >
            All recipes
          </Link>
          <div className="my-1 border-t border-border" />
          {categories.map((c) => (
            <Link
              key={c}
              href={`/recipes?category=${encodeURIComponent(c)}`}
              className="block px-3 py-1.5 text-sm capitalize text-foreground hover:bg-surface-muted"
            >
              {c}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold text-lg text-ink">
          <span aria-hidden>🍛</span>
          <span>Curryforward</span>
        </Link>

        <nav className="hidden items-center gap-5 sm:flex">
          <Link href="/" className="text-sm font-medium text-foreground hover:text-brand-hover">
            Home
          </Link>
          <RecipesMenu />
        </nav>

        <AssistantSearchBar />
      </div>
    </header>
  );
}
