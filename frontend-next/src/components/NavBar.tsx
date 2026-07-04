"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(pathname === "/" ? searchParams.get("q") || "" : "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (value.trim()) params.set("q", value.trim());
    router.push(`/${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <form onSubmit={submit} className="flex-1 max-w-md">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search recipes by name, category, cuisine…"
          className="w-full rounded-full border border-border bg-stone-50 py-2 pl-9 pr-3 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
        />
      </div>
    </form>
  );
}

export function NavBar() {
  const { isAdmin, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold text-lg">
          <span aria-hidden>🍛</span>
          <span>Curryforward</span>
        </Link>

        {/* Remount on route change so the box resets when navigation (e.g. a
            post-login redirect home) drops the ?q= that isn't reflected by
            re-running this component's own initial state. */}
        <Suspense key={pathname} fallback={<div className="flex-1 max-w-md" />}>
          <SearchBox />
        </Suspense>

        <div className="ml-auto flex items-center gap-3">
          {!loading && (
            <Badge tone={isAdmin ? "success" : "neutral"}>
              {isAdmin ? "Admin" : "Guest"}
            </Badge>
          )}
          {isAdmin ? (
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => router.push("/login")}>
              Admin log in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
