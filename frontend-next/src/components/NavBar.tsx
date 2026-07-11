"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRecipes } from "@/context/RecipesContext";
import { useAuth } from "@/context/AuthContext";
import { AssistantSearchBar } from "@/components/assistant/AssistantSearchBar";
import { ThemeToggle } from "@/components/ThemeToggle";

function RecipesMenu() {
  const { recipes } = useRecipes();
  const categories = [...new Set(recipes.filter((recipe) => recipe.status !== "draft").map((recipe) => recipe.category).filter((category): category is string => Boolean(category)))].sort();
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
        href="/recipes?published=1"
        className="text-sm font-medium text-foreground hover:text-brand-hover"
      >
        Recipes
      </Link>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-48 rounded-lg border border-border bg-surface py-1.5 shadow-lg">
          <Link
            href="/recipes?published=1"
            className="block px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted"
          >
            All recipes
          </Link>
          <Link href="/#bengali-sweets" className="block px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted">
            Bengali Sweets
          </Link>
          <Link href="/#hard-to-find" className="block px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted">
            Classics
          </Link>
          <div className="my-1 border-t border-border" />
          {categories.map((c) => (
            <Link
              key={c}
              href={`/recipes?published=1&category=${encodeURIComponent(c)}`}
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
  const { recipes } = useRecipes();
  const categories = [...new Set(recipes.filter((recipe) => recipe.status !== "draft").map((recipe) => recipe.category).filter((category): category is string => Boolean(category)))].sort();
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
            href="/recipes?published=1"
            className="block rounded-md py-2 pl-5 pr-2 text-sm text-foreground hover:bg-surface-muted"
            onClick={() => setOpen(false)}
          >
            All recipes
          </Link>
          <Link
            href="/#bengali-sweets"
            className="block rounded-md py-2 pl-5 pr-2 text-sm text-foreground hover:bg-surface-muted"
            onClick={() => setOpen(false)}
          >
            Bengali Sweets
          </Link>
          <Link
            href="/#hard-to-find"
            className="block rounded-md py-2 pl-5 pr-2 text-sm text-foreground hover:bg-surface-muted"
            onClick={() => setOpen(false)}
          >
            Classics
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
                  href={`/recipes?published=1&category=${encodeURIComponent(c)}`}
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
  const { isAdmin, loading } = useAuth();
  const showWorkspace = isAdmin && !loading;

  return (
    <header className="heritage-header sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center" aria-label="Curry Forward home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cf/logos/symbol-micro-light.svg" alt="Curry Forward" className="brand-logo-light brand-mobile h-10 w-10" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cf/logos/symbol-micro-dark.svg" alt="Curry Forward" className="brand-logo-dark brand-mobile h-10 w-10" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cf/logos/logo-compact-light.svg" alt="Curry Forward" className="brand-logo-light brand-desktop h-11 w-auto" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cf/logos/logo-compact-dark.svg" alt="Curry Forward" className="brand-logo-dark brand-desktop h-11 w-auto" />
        </Link>

        <nav className="hidden items-center gap-5 sm:flex">
          <Link href="/" className="text-sm font-medium text-foreground hover:text-brand-hover">
            Home
          </Link>
          <RecipesMenu />
          <Link
            href="/admin"
            aria-hidden={!showWorkspace}
            tabIndex={showWorkspace ? undefined : -1}
            className={`text-sm font-medium text-foreground hover:text-brand-hover ${
              showWorkspace ? "" : "pointer-events-none invisible"
            }`}
          >
            Workspace
          </Link>
        </nav>

        <AssistantSearchBar />

        <ThemeToggle />
        <MobileMenu />
      </div>
    </header>
  );
}
