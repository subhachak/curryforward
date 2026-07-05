"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRecipes } from "@/context/RecipesContext";
import { useAuth } from "@/context/AuthContext";
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
        className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-brand-hover"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/icon-recipes-book.svg" alt="" aria-hidden className="h-6 w-6" />
        Recipes
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

function MobileMenu() {
  const { categories } = useRecipes();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="sm:hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-foreground"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 border-b border-border bg-surface px-4 py-2 shadow-lg">
          <Link
            href="/"
            className="block rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
            onClick={() => setOpen(false)}
          >
            Home
          </Link>
          <Link
            href="/recipes"
            className="block rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
            onClick={() => setOpen(false)}
          >
            All recipes
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="block rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
              onClick={() => setOpen(false)}
            >
              Workspace
            </Link>
          )}
          {categories.length > 0 && (
            <div className="mt-1 border-t border-border pt-1">
              {categories.map((c) => (
                <Link
                  key={c}
                  href={`/recipes?category=${encodeURIComponent(c)}`}
                  className="block rounded-md px-2 py-2 text-sm capitalize text-muted hover:bg-surface-muted"
                  onClick={() => setOpen(false)}
                >
                  {c}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NavBar() {
  const { isAdmin } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-primary-horizontal.svg" alt="CurryForward" className="h-11 w-auto sm:h-12" />
        </Link>

        <nav className="hidden items-center gap-5 sm:flex">
          <Link href="/" className="text-sm font-medium text-foreground hover:text-brand-hover">
            Home
          </Link>
          <RecipesMenu />
          {isAdmin && (
            <Link href="/admin" className="text-sm font-medium text-foreground hover:text-brand-hover">
              Workspace
            </Link>
          )}
        </nav>

        <AssistantSearchBar />

        <MobileMenu />
      </div>
    </header>
  );
}
