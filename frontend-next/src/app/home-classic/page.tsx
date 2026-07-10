"use client";

import Link from "next/link";
import { useMemo } from "react";
import { RecipeCard } from "@/components/RecipeCard";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { useRecipes } from "@/context/RecipesContext";
import { useAssistant } from "@/context/AssistantContext";
import { CopyIcon, FlameIcon, HeartIcon, SearchIcon, SparklesIcon } from "@/components/ui/icons";

const FLOW = [
  {
    title: "Browse",
    body: "Find a dish by craving, cuisine, or ingredient.",
    icon: SearchIcon,
  },
  {
    title: "Customize",
    body: "Ask for it spicier, lighter, vegan, faster, or family-sized.",
    icon: SparklesIcon,
  },
  {
    title: "Version",
    body: "Every change becomes a new draft without losing the original.",
    icon: CopyIcon,
  },
  {
    title: "Check",
    body: "Nutrition updates with the ingredients in that version.",
    icon: HeartIcon,
  },
];

const FEATURES = [
  {
    title: "Versioned recipes",
    body: "Every tweak becomes a new version, so the original stays intact.",
    icon: CopyIcon,
  },
  {
    title: "Nutrition that updates",
    body: "Each version gets its own recalculated Nutrition Facts panel.",
    icon: HeartIcon,
  },
  {
    title: "Ask instead of scrolling",
    body: "Tell the assistant what you want and get a recipe that fits.",
    icon: SparklesIcon,
  },
  {
    title: "Branch, don't overwrite",
    body: "Copy a recipe into a new lineage when you want a different direction.",
    icon: FlameIcon,
  },
];

const PROMPTS = [
  "Show me something spicy with chicken",
  "Make this dairy-free",
  "Less sugar, same texture",
  "Show updated nutrition",
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
    <div className="space-y-12 sm:space-y-16">
      <section className="relative overflow-hidden rounded-md border border-border bg-surface px-4 py-8 shadow-sm sm:px-8 sm:py-12 lg:px-10">
        <div className="absolute right-4 top-4 hidden opacity-10 sm:block" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cf/logos/symbol-light.svg" alt="" className="theme-asset h-56 w-auto" />
        </div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
          <div className="relative z-10 max-w-2xl space-y-5">
            <div className="text-xs font-semibold uppercase text-accent-hover">
              Not another recipe blog
            </div>
            <h1 className="text-4xl font-bold text-ink sm:text-5xl">Recipes that talk back.</h1>
            <p className="max-w-xl text-lg text-muted">
              CurryForward helps you find a recipe, ask for changes, save every version, and get updated nutrition
              automatically.
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

          <div className="relative min-h-[320px]">
            <div className="relative mx-auto flex h-full max-w-sm flex-col justify-center">
              <div className="mx-auto flex h-36 w-36 items-center justify-center rounded-full border border-border bg-background shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/cf/logos/symbol-light.svg" alt="" className="theme-asset h-24 w-auto" />
              </div>
              <div className="mt-5 grid gap-2">
                {PROMPTS.map((prompt, index) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setOpen(true)}
                    className={`rounded-md border border-border bg-surface px-3 py-2 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-brand ${
                      index % 2 === 0 ? "mr-8" : "ml-8"
                    }`}
                  >
                    <span className="mr-2 text-brand-hover">&quot;</span>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="How CurryForward works">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="rounded-md border border-border bg-surface p-4">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-brand-soft text-brand-hover">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="font-semibold text-ink">{item.title}</div>
                <p className="mt-1 text-sm text-muted">{item.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase text-accent-hover">A real loop</div>
          <h2 className="text-2xl font-bold text-ink">Change the recipe, keep the trail.</h2>
          <p className="text-muted">
            CurryForward is built for the way people actually cook: you start with a recipe, ask for what your kitchen
            needs, and keep the new version organized.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardBody>
              <div className="text-xs font-semibold uppercase text-muted">Original</div>
              <div className="mt-2 text-lg font-semibold text-ink">Chicken curry with cream</div>
              <p className="mt-2 text-sm text-muted">A rich weeknight curry with cream, yogurt, and a classic spice base.</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="text-xs font-semibold uppercase text-brand-hover">
                Assistant request
              </div>
              <div className="mt-2 rounded-md bg-brand-soft px-3 py-2 text-sm text-foreground">
                Make this dairy-free and higher protein.
              </div>
              <div className="mt-3 text-lg font-semibold text-ink">Dairy-free chicken curry</div>
              <p className="mt-2 text-sm text-muted">
                Coconut yogurt, adjusted portions, updated steps, and recalculated nutrition.
              </p>
            </CardBody>
          </Card>
        </div>
      </section>

      <section>
        <div className="mb-5">
          <h2 className="text-2xl font-bold text-ink">What makes this different</h2>
          <p className="mt-1 text-sm text-muted">A recipe app that treats changes as part of the recipe.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title}>
                <CardBody>
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-accent-hover">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="font-semibold text-ink">{feature.title}</div>
                  <p className="mt-1 text-sm text-muted">{feature.body}</p>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>

      {!loading && latest.length > 0 && (
        <section>
          <div className="mb-6 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-ink">What&apos;s new</h2>
              <p className="mt-1 text-sm text-muted">Fresh versions and recipes from the CurryForward kitchen.</p>
            </div>
            <Link href="/recipes" className="text-sm font-medium text-brand-hover hover:underline">
              See all recipes
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {latest.map((recipe) => (
              <RecipeCard key={recipe.recipe_id} recipe={recipe} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-md border border-border bg-surface p-5 sm:p-6">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="text-xl font-bold text-ink">Try asking the assistant</h2>
            <p className="mt-1 text-sm text-muted">Start with a craving, a constraint, or a recipe you want to change.</p>
          </div>
          <Button variant="accent" size="md" onClick={() => setOpen(true)}>
            Open assistant
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {PROMPTS.slice(0, 3).map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted transition hover:border-brand hover:text-foreground"
            >
              {prompt}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
