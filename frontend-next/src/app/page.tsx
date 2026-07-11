"use client";

import Link from "next/link";
import { FormEvent, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { useAssistant } from "@/context/AssistantContext";
import { useRecipes } from "@/context/RecipesContext";
import { publicRecipeHref } from "@/lib/recipeLinks";
import type { RecipeSummary } from "@/lib/types";

const COLLECTIONS = [
  { title: "Bengali Classics", query: "Bengali", icon: "/brand/cf/icons/brand/bengali-classics.svg", copy: "Home-style dishes with regional context." },
  { title: "Bengali Sweets", query: "Sweets", icon: "/brand/cf/icons/brand/sweets.svg", copy: "Mishti, pitha, payesh, and jaggery favorites." },
  { title: "Everyday Curries", query: "Curry", icon: "/brand/cf/icons/brand/regional.svg", copy: "Comforting recipes for the weekly table." },
  { title: "Festive Cooking", query: "Festive", icon: "/brand/cf/icons/brand/festive.svg", copy: "Celebration dishes made manageable." },
  { title: "Global Favorites", query: "Global", icon: "/brand/cf/icons/brand/collections.svg", copy: "Familiar dishes adapted for home cooks." },
];

const NEEDS = ["Weeknight dinner", "Chicken", "Vegetarian", "Festive", "Under 45 minutes", "Bengali", "Sweets", "Pantry-friendly"];

export default function HomePage() {
  const { setOpen } = useAssistant();
  const { recipes } = useRecipes();
  const published = useMemo(() => recipes.filter((recipe) => recipe.status !== "draft"), [recipes]);
  const featured = published.find((recipe) => recipe.hero_image_url) || published[0] || null;
  const popular = published.slice(0, 4);

  function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <div className="-mx-4 -my-6 overflow-x-hidden bg-background text-foreground sm:-mx-6">
      <section className="mx-auto grid max-w-[1280px] gap-10 px-4 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(420px,.9fr)] lg:items-center lg:py-20">
        <div className="max-w-2xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[.18em] text-brand">Recipes with roots</p>
          <h1 className="text-[clamp(2.75rem,5vw,5.5rem)] leading-[1.01] tracking-[-.04em]">
            Recipes with roots.<br />Made for today&apos;s kitchen.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted">Cook the original. Make it yours. Keep every version.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/recipes?published=1"><Button>Explore recipes</Button></Link>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/cf/icons/ui/ask.svg" alt="" className="h-5 w-5" />
              Ask CurryForward
            </Button>
          </div>
        </div>
        <div className="relative">
          <FoodImage recipe={featured} className="aspect-[4/4.6] w-full rounded-[1.5rem] shadow-[0_24px_60px_rgb(58_42_35/.14)]" priority />
          {featured && (
            <Link href={publicRecipeHref(featured)} className="absolute inset-x-5 bottom-5 rounded-[14px] border border-white/50 bg-surface/95 p-4 shadow-lg backdrop-blur-sm transition hover:-translate-y-0.5">
              <div className="text-xs font-semibold uppercase tracking-[.14em] text-brand">Under the cloche this week</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{featured.name}</div>
            </Link>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-4 py-12 sm:px-8">
        <SectionHeading eyebrow="Explore" title="Find your way into the kitchen." action="View all recipes" href="/recipes?published=1" />
        <div className="mt-7 flex snap-x gap-4 overflow-x-auto pb-3 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-5">
          {COLLECTIONS.map((collection, index) => (
            <Link key={collection.title} href={`/recipes?published=1&q=${encodeURIComponent(collection.query)}`} className="group min-w-[78%] snap-start overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm sm:min-w-0">
              <FoodImage recipe={published[index]} className="aspect-[4/3] w-full transition duration-200 group-hover:scale-[1.025]" />
              <div className="p-4">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={collection.icon} alt="" className="h-5 w-5" />
                  <h3 className="text-lg font-semibold">{collection.title}</h3>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">{collection.copy}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section id="bengali-sweets" className="mx-auto max-w-[1280px] px-4 py-14 sm:px-8">
        <div className="grid overflow-hidden rounded-[1.5rem] bg-surface-muted lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <FoodImage recipe={published.find((recipe) => recipe.name.toLowerCase().includes("bengali")) || published[1]} className="aspect-[4/3] h-full w-full" />
          <div className="p-7 sm:p-10 lg:p-14">
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-success">Bengali kitchen</p>
            <h2 className="mt-3 text-[clamp(1.9rem,3vw,2.75rem)] leading-tight">Traditional Bengali recipes, clearly preserved.</h2>
            <p className="mt-5 max-w-xl leading-7 text-muted">Discover classics, sweets, techniques, and regional dishes with the context that helps you cook them confidently.</p>
            <div className="mt-7 flex flex-col items-start gap-3 text-sm font-semibold">
              <Link href="/recipes?published=1&q=Bengali" className="inline-flex min-h-11 items-center text-brand hover:underline">Explore Bengali classics →</Link>
              <Link href="/recipes?published=1&q=Sweets" className="inline-flex min-h-11 items-center text-brand hover:underline">Discover Bengali sweets →</Link>
              <Link href="/recipes?published=1&q=Techniques" className="inline-flex min-h-11 items-center text-brand hover:underline">Learn regional techniques →</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-16 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-accent-hover">Recipe adaptation</p>
            <h2 className="mt-3 text-[clamp(1.9rem,3vw,2.75rem)] leading-tight">Cook the original. Make it yours.</h2>
            <p className="mt-5 max-w-lg leading-7 text-muted">Adjust sweetness, spice, serving size, ingredients, or dietary needs without losing the original recipe.</p>
            <Button className="mt-7" onClick={() => setOpen(true)}>Adapt a recipe</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center">
            {['Original recipe', 'Less sweet', 'Dairy-free', 'Party batch'].map((step, index) => (
              <div key={step} className="contents">
                <div className={`rounded-[14px] border p-4 ${index === 0 ? 'border-brand bg-brand-soft' : 'border-border bg-surface-muted'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={index === 0 ? "/brand/cf/icons/ui/version.svg" : "/brand/cf/icons/ui/adapt.svg"} alt="" className="mb-3 h-5 w-5" />
                  <div className="text-sm font-semibold text-foreground">{step}</div>
                </div>
                {index < 3 && <span className="hidden text-center text-xl text-muted sm:block" aria-hidden>→</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {featured && (
        <section className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
            <FoodImage recipe={featured} className="aspect-[16/10] w-full rounded-[1.25rem]" />
            <div className="lg:-ml-20 lg:rounded-[1.25rem] lg:border lg:border-border lg:bg-surface lg:p-10 lg:shadow-lg">
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-brand">Under the cloche this week</p>
              <h2 className="mt-3 text-[clamp(2rem,3vw,3rem)] leading-tight">{featured.name}</h2>
              {featured.intro && <p className="mt-4 line-clamp-3 leading-7 text-muted">{featured.intro}</p>}
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
                <span>{featured.category || "Recipe"}</span>
                {featured.cuisine_tags[0] && <span>{featured.cuisine_tags[0]}</span>}
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href={publicRecipeHref(featured)}><Button>View recipe</Button></Link>
                <Button variant="secondary" onClick={() => setOpen(true)}>Adapt this recipe</Button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-[1280px] px-4 py-12 sm:px-8">
        <SectionHeading eyebrow="Browse by need" title="Start with what matters today." action="View all" href="/recipes?published=1" />
        <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
          {NEEDS.map((need) => <Link key={need} href={`/recipes?published=1&q=${encodeURIComponent(need)}`} className="min-h-11 shrink-0 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-brand hover:text-brand">{need}</Link>)}
        </div>
      </section>

      {popular.length > 0 && (
        <section className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8">
          <SectionHeading eyebrow="Popular recipes" title="Worth cooking next." action="Explore all" href="/recipes?published=1" />
          <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {popular.map((recipe) => <RecipeTile key={recipe.recipe_id} recipe={recipe} />)}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8">
        <div className="grid gap-7 rounded-[1.25rem] bg-surface-muted p-7 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl">Keep a little more flavor in your week.</h2>
            <p className="mt-3 max-w-2xl text-muted">Seasonal recipes, Bengali classics, and thoughtful adaptations, delivered occasionally.</p>
          </div>
          <form onSubmit={subscribe} className="w-full max-w-md">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="newsletter-email" className="sr-only">Email address</label>
              <input id="newsletter-email" type="email" required placeholder="Email address" className="min-h-11 flex-1 rounded-lg border border-border bg-surface px-4 text-foreground placeholder:text-muted" />
              <Button type="submit">Subscribe</Button>
            </div>
            <p className="mt-2 text-xs text-muted">Occasional notes only. Unsubscribe whenever you like.</p>
          </form>
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ eyebrow, title, action, href }: { eyebrow: string; title: string; action: string; href: string }) {
  return <div className="flex items-end justify-between gap-6"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-brand">{eyebrow}</p><h2 className="mt-2 text-[clamp(1.75rem,3vw,2.75rem)] leading-tight">{title}</h2></div><Link href={href} className="hidden min-h-11 shrink-0 items-center text-sm font-semibold text-brand hover:underline sm:inline-flex">{action} →</Link></div>;
}

function FoodImage({ recipe, className, priority = false }: { recipe?: RecipeSummary | null; className: string; priority?: boolean }) {
  if (recipe?.hero_image_url) return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={recipe.hero_image_url} alt={recipe.name} fetchPriority={priority ? "high" : "auto"} className={`bg-surface-muted object-cover ${className}`} />
  );
  return (
    <div className={`flex items-center justify-center bg-surface-muted ${className}`} aria-label="Recipe image unavailable">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/cf/logos/symbol-light.svg" alt="" className="theme-asset h-20 w-auto opacity-70" />
    </div>
  );
}

function RecipeTile({ recipe }: { recipe: RecipeSummary }) {
  return <Link href={publicRecipeHref(recipe)} className="group overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm"><FoodImage recipe={recipe} className="aspect-[4/3] w-full transition duration-200 group-hover:scale-[1.025]" /><div className="p-4"><h3 className="text-xl font-semibold leading-snug">{recipe.name}</h3><p className="mt-2 text-sm text-muted">{recipe.cuisine_tags[0] || recipe.category || "Recipe"}</p></div></Link>;
}
