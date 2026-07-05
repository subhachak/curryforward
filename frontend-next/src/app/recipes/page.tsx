"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RecipeCard } from "@/components/RecipeCard";
import { PageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { useRecipes } from "@/context/RecipesContext";

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-brand bg-brand-soft text-brand-hover"
          : "border-border bg-surface text-muted hover:bg-surface-muted"
      }`}
    >
      {label}
    </button>
  );
}

function RecipesInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { recipes, categories, tags, loading } = useRecipes();

  const query = (searchParams.get("q") || "").trim().toLowerCase();
  const category = searchParams.get("category") || "";
  const tag = searchParams.get("tag") || "";

  function setFilter(key: "category" | "tag", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && params.get(key) !== value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/recipes${params.toString() ? `?${params}` : ""}`);
  }

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      if (category && r.category !== category) return false;
      if (tag && !r.cuisine_tags.includes(tag)) return false;
      if (query) {
        const haystack = [r.name, r.category ?? "", ...r.cuisine_tags].join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [recipes, query, category, tag]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">All recipes</h1>
        <p className="text-sm text-muted">Browse by category, cuisine, or search by name.</p>
      </div>

      {(categories.length > 0 || tags.length > 0) && (
        <div className="space-y-2">
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip label="All categories" active={!category} onClick={() => setFilter("category", "")} />
              {categories.map((c) => (
                <FilterChip
                  key={c}
                  label={c}
                  active={category === c}
                  onClick={() => setFilter("category", c)}
                />
              ))}
            </div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <FilterChip key={t} label={t} active={tag === t} onClick={() => setFilter("tag", t)} />
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading recipes…" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-muted">
          {query || category || tag ? (
            <>
              No recipes match your filters.{" "}
              <button className="underline" onClick={() => router.push("/recipes")}>
                Clear filters
              </button>
            </>
          ) : (
            "No recipes yet."
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Badge tone="neutral">{filtered.length}</Badge>
            recipe{filtered.length === 1 ? "" : "s"}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => (
              <RecipeCard key={r.recipe_id} recipe={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function RecipesPage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading recipes…" />}>
      <RecipesInner />
    </Suspense>
  );
}
