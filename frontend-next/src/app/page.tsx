"use client";

import Link from "next/link";
import { useMemo } from "react";
import { RecipeCard } from "@/components/RecipeCard";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { useRecipes } from "@/context/RecipesContext";
import { useAssistant } from "@/context/AssistantContext";

const FEATURES = [
  {
    title: "Recipes that evolve, not just print",
    body: "Every tweak — spicier, less sugar, dairy-free — becomes a new version with full history, not an edit that overwrites the original.",
  },
  {
    title: "A nutrition label, not a guess",
    body: "Every version gets its own calculated Nutrition Facts panel, recomputed automatically whenever the ingredients change.",
  },
  {
    title: "Ask for what you want",
    body: "Skip the scrolling. Tell the assistant what you're in the mood for, or ask it to customize a recipe on the spot.",
  },
  {
    title: "Copy instead of losing the original",
    body: "Want a different direction for a recipe? Copy it into its own lineage — the source recipe stays untouched.",
  },
];

export default function HomePage() {
  const { recipes, loading } = useRecipes();
  const { setOpen } = useAssistant();

  const latest = useMemo(() => {
    return [...recipes]
      .filter((r) => r.created_at)
      .sort((a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime())
      .slice(0, 3);
  }, [recipes]);

  return (
    <div className="space-y-16">
      <section className="grid gap-8 py-8 sm:py-14 lg:grid-cols-2 lg:items-center">
        <div className="space-y-5">
          <span className="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-hover">
            Not another recipe blog
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Recipes that talk back.
          </h1>
          <p className="max-w-md text-lg text-muted">
            Curryforward is a living recipe collection: browse it, ask the assistant
            to customize a dish or dream up a new one, and every change is tracked,
            versioned, and nutrition-checked — automatically.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/recipes">
              <Button size="md">Browse recipes</Button>
            </Link>
            <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
              Ask the assistant
            </Button>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-4 -z-10 rounded-3xl bg-accent-soft blur-2xl" aria-hidden />
          <Card className="p-6">
            <div className="mb-3 text-sm font-medium text-muted">Try asking the assistant:</div>
            <ul className="space-y-2 text-sm">
              <li className="rounded-lg bg-surface-muted px-3 py-2">
                &ldquo;Show me something spicy with chicken&rdquo;
              </li>
              <li className="rounded-lg bg-surface-muted px-3 py-2">
                &ldquo;Make this dessert dairy-free&rdquo;
              </li>
              <li className="rounded-lg bg-surface-muted px-3 py-2">
                &ldquo;Create a new Thai green curry recipe&rdquo;
              </li>
            </ul>
          </Card>
        </div>
      </section>

      <section>
        <h2 className="mb-6 text-xl font-bold text-ink">What makes this different</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardBody>
                <div className="mb-1 font-semibold">{f.title}</div>
                <p className="text-sm text-muted">{f.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      {!loading && latest.length > 0 && (
        <section>
          <div className="mb-6 flex items-end justify-between">
            <h2 className="text-xl font-bold text-ink">What&apos;s new</h2>
            <Link href="/recipes" className="text-sm text-brand-hover hover:underline">
              See all recipes →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {latest.map((r) => (
              <RecipeCard key={r.recipe_id} recipe={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
