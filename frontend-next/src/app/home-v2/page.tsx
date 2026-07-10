"use client";

import Link from "next/link";
import { FormEvent, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useRecipes } from "@/context/RecipesContext";
import { HeartIcon } from "@/components/ui/icons";
import { publicRecipeHref } from "@/lib/recipeLinks";

const CATEGORY_CARDS = [
  {
    title: "Weeknight Curries",
    body: "Comforting curries that fit the after-work clock.",
    icon: "/brand/icon-curry-bowl.svg",
    cta: "Explore",
    accent: "#FF6B00",
    bg: "#FFE7D1",
  },
  {
    title: "Bengali Classics",
    body: "Mustard oil, slow aromatics, river fish, and old-city comfort.",
    icon: "/brand/icon-menu-cloche.svg",
    cta: "Explore",
    accent: "#5A2145",
    bg: "#F7DDED",
  },
  {
    title: "Vegetarian",
    body: "Paneer, dal, greens, and vegetable-forward cooking.",
    icon: "/brand/icon-ingredients-leaf.svg",
    cta: "Explore",
    accent: "#2E9B57",
    bg: "#DFF3E6",
  },
  {
    title: "Spice Guides",
    body: "Learn the why behind cumin, kasuri methi, chili, and more.",
    icon: "/brand/icon-spice-chili.svg",
    cta: "Learn",
    accent: "#E6462D",
    bg: "#FFE0DA",
  },
  {
    title: "Meal Planning",
    body: "Build a week of menus around one smart grocery run.",
    icon: "/brand/icon-reservation-calendar.svg",
    cta: "Plan",
    accent: "#FFB000",
    bg: "#FFF0C1",
  },
  {
    title: "Pantry Basics",
    body: "Stock the jars, oils, and pastes that make dinner easier.",
    icon: "/brand/icon-ingredients-leaf.svg",
    cta: "Build",
    accent: "#B84600",
    bg: "#FFE9D8",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Pick a craving",
    body: "Choose by ingredient, region, spice level, or cooking time.",
    icon: "/brand/icon-search.svg",
  },
  {
    title: "Open the cloche",
    body: "Get clear steps, substitutions, prep notes, and nutrition context.",
    icon: "/brand/icon-menu-cloche.svg",
  },
  {
    title: "Cook forward",
    body: "Save favorites, build menus, and discover what to make next.",
    icon: "/brand/icon-recipes-book.svg",
  },
];

const BENEFITS = [
  {
    title: "Regional depth",
    body: "Not just curry. Real context, real flavors, and recipe lineage.",
  },
  {
    title: "Practical recipes",
    body: "Clear steps, realistic timing, and smart substitutions.",
  },
  {
    title: "Modern planning",
    body: "Search, organize, customize, and cook with confidence.",
  },
];

const FALLBACK_RECIPES = [
  {
    name: "Chicken Rezala",
    region: "Bengali",
    time: "45 min",
    spice: "Mild",
    href: "/recipes",
  },
  {
    name: "Paneer Butter Masala",
    region: "North Indian",
    time: "35 min",
    spice: "Medium",
    href: "/recipes",
  },
  {
    name: "Chingri Malai Curry",
    region: "Bengali",
    time: "30 min",
    spice: "Mild",
    href: "/recipes",
  },
];

const SPICES = [
  { name: "Cumin", color: "#FF6B00", bg: "#FFE7D1" },
  { name: "Coriander", color: "#2E9B57", bg: "#DFF3E6" },
  { name: "Kasuri methi", color: "#5A2145", bg: "#F7DDED" },
  { name: "Mustard oil", color: "#FFB000", bg: "#FFF0C1" },
  { name: "Garam masala", color: "#B84600", bg: "#FFE9D8" },
  { name: "Kashmiri chili", color: "#E6462D", bg: "#FFE0DA" },
  { name: "Panch phoron", color: "#2E9B57", bg: "#DFF3E6" },
];

const PROMPT_CHIPS = [
  { label: "Make it dairy-free", color: "#2E9B57", bg: "#DFF3E6" },
  { label: "Spicier", color: "#E6462D", bg: "#FFE0DA" },
  { label: "High protein", color: "#FFB000", bg: "#FFF0C1" },
  { label: "Low sugar", color: "#5A2145", bg: "#F7DDED" },
];

function ClocheMark({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/cf/logos/symbol-light.svg" alt="" aria-hidden className={`theme-asset ${className}`} />
  );
}

export default function HomeV2Page() {
  const { recipes } = useRecipes();

  const featured = useMemo(() => {
    return recipes.find((recipe) => recipe.name.toLowerCase().includes("rezala")) ?? recipes[0] ?? null;
  }, [recipes]);

  const popular = useMemo(() => {
    if (recipes.length === 0) return FALLBACK_RECIPES;
    return recipes.slice(0, 3).map((recipe, index) => ({
      name: recipe.name,
      region: recipe.cuisine_tags[0] ?? recipe.category ?? "Indian",
      time: ["45 min", "35 min", "30 min"][index] ?? "40 min",
      spice: ["Mild", "Medium", "Mild"][index] ?? "Medium",
      href: publicRecipeHref(recipe),
      hero_image_url: recipe.hero_image_url,
    }));
  }, [recipes]);

  function handleSubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <div className="-mx-4 -my-6 bg-[#FFF8F1] text-[#2E1B14] sm:-mx-6">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <section className="grid min-h-[560px] gap-8 overflow-hidden rounded-md border border-[#FFD2AE] bg-[#FFF1E6] p-5 sm:p-8 lg:grid-cols-[1fr_440px] lg:items-center">
          <div className="max-w-2xl space-y-6">
            <span className="inline-flex rounded-full bg-[#FF6B00] px-3 py-1 text-xs font-semibold text-white">
              Modern Indian cooking
            </span>
            <h1 className="max-w-xl text-5xl font-bold leading-tight text-[#2E1B14] sm:text-6xl">
              Indian flavors, served forward.
            </h1>
            <p className="max-w-xl text-lg text-[#5A4038]">
              Discover modern Indian recipes, regional classics, and weeknight curry ideas built for today&apos;s kitchen.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/recipes">
                <Button className="bg-[#FF6B00] text-white shadow-[0_8px_18px_rgba(255,107,0,0.25)] hover:bg-[#E6462D]">
                  Explore Recipes
                </Button>
              </Link>
              <a href="#today">
                <Button className="border border-[#2E9B57] bg-[#DFF3E6] text-[#145C32] hover:bg-[#CBEBD7]">
                  See Today&apos;s Pick
                </Button>
              </a>
            </div>
            <div className="flex flex-wrap gap-2">
              {PROMPT_CHIPS.map((chip) => (
                <span
                  key={chip.label}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={{ backgroundColor: chip.bg, color: chip.color }}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-md border border-[#FFD2AE] bg-[#FFF8F1]">
            <div className="absolute left-6 top-8 h-24 w-24 rounded-full border-8 border-[#FFB000]" aria-hidden />
            <div className="absolute bottom-8 right-8 h-20 w-20 rounded-full border-8 border-[#2E9B57]" aria-hidden />
            <div className="absolute right-16 top-12 h-14 w-14 rounded-full bg-[#FFE0DA]" aria-hidden />
            <div className="absolute bottom-16 left-16 h-10 w-10 rounded-full bg-[#F7DDED]" aria-hidden />
            <div className="absolute inset-x-12 top-12 h-16 rounded-full bg-[#FFE7D1]" aria-hidden />
            <ClocheMark className="relative z-10 h-56 w-auto text-[#FF6B00] drop-shadow-sm sm:h-64" />
          </div>
        </section>

        <section id="today" className="grid gap-6 py-14 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <div className="mb-2 text-sm font-semibold uppercase text-[#FF6B00]">Today under the cloche</div>
            <h2 className="text-3xl font-bold text-[#2E1B14]">A featured recipe to start from.</h2>
            <p className="mt-3 max-w-md text-[#5A4038]">
              Keep the homepage tied to one dish, one mood, and one clear next action.
            </p>
          </div>

          <div className="rounded-md border border-[#FFD2AE] bg-[#FFF1E6] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="rounded-full bg-[#FFB000] px-3 py-1 text-xs font-bold text-[#2E1B14]">Featured</span>
              <ClocheMark className="h-9 w-auto" />
            </div>
            <h3 className="text-2xl font-bold text-[#2E1B14]">
              {featured?.name ?? "Kolkata Chicken Rezala"}
            </h3>
            <p className="mt-2 text-[#5A4038]">
              {featured?.intro ??
                "A fragrant, creamy Mughlai-style curry with yogurt, cashew, and warm spices."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-[#FFF8F1] px-3 py-1 text-[#5A4038]">35 min</span>
              <span className="badge-pink rounded-full bg-[#FFE0DA] px-3 py-1 font-semibold text-[#E6462D]">Medium spice</span>
              <span className="badge-lavender rounded-full bg-[#F7DDED] px-3 py-1 font-semibold text-[#5A2145]">
                {featured?.cuisine_tags[0] ?? "Bengali"}
              </span>
            </div>
            <Link href={featured ? publicRecipeHref(featured) : "/recipes"}>
              <Button className="mt-5 bg-[#FF6B00] text-white hover:bg-[#E6462D]">View Recipe</Button>
            </Link>
          </div>
        </section>

        <section id="categories" className="py-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-3xl font-bold text-[#2E1B14]">Explore by mood</h2>
              <p className="mt-1 text-[#5A4038]">Curated entry points for everyday cooking and deeper learning.</p>
            </div>
            <Link href="/recipes" className="text-sm font-semibold text-[#FF6B00] hover:underline">
              Browse all recipes
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORY_CARDS.map((category) => (
              <Link
                key={category.title}
                href="/recipes"
                className="rounded-md border border-[#FFD2AE] bg-[#FFF1E6] p-5 transition hover:-translate-y-0.5 hover:shadow-sm"
                style={{ borderTop: `5px solid ${category.accent}` }}
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md" style={{ backgroundColor: category.bg }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={category.icon} alt="" aria-hidden className="h-8 w-8" />
                </div>
                <div className="text-lg font-bold text-[#2E1B14]">{category.title}</div>
                <p className="mt-1 min-h-10 text-sm text-[#5A4038]">{category.body}</p>
                <div className="mt-4 text-sm font-semibold" style={{ color: category.accent }}>
                  {category.cta} -&gt;
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section id="about" className="py-14">
          <div className="grid gap-4 lg:grid-cols-3">
            {HOW_IT_WORKS.map((step, index) => (
              <div key={step.title} className="rounded-md border border-[#FFD2AE] bg-[#FFF8F1] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[#FFE7D1]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={step.icon} alt="" aria-hidden className="h-8 w-8" />
                  </div>
                  <span className="rounded-full bg-[#FF6B00] px-2.5 py-1 text-sm font-bold text-white">{index + 1}</span>
                </div>
                <div className="text-xl font-bold text-[#2E1B14]">{step.title}</div>
                <p className="mt-2 text-sm text-[#5A4038]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md bg-[#2E1B14] px-5 py-10 text-[#FFF8F1] sm:px-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <h2 className="text-3xl font-bold leading-tight">
              Built for people who love Indian food but need modern kitchen clarity.
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {BENEFITS.map((benefit) => (
                <div key={benefit.title} className="border-l-4 border-[#FFB000] pl-4">
                  <div className="font-bold text-[#FFB000]">{benefit.title}</div>
                  <p className="mt-2 text-sm text-[#FFF1E6]">{benefit.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14">
          <div className="mb-5">
            <h2 className="text-3xl font-bold text-[#2E1B14]">Popular recipes</h2>
            <p className="mt-1 text-[#5A4038]">Soft landings for familiar dishes and regional favorites.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {popular.map((recipe, index) => {
              const imageUrl =
                "hero_image_url" in recipe && typeof recipe.hero_image_url === "string"
                  ? recipe.hero_image_url
                  : null;
              const recipeAccent = ["#FF6B00", "#2E9B57", "#5A2145"][index] ?? "#FF6B00";
              const spiceTone =
                recipe.spice === "Medium"
                  ? { bg: "#FFE0DA", color: "#E6462D" }
                  : { bg: "#DFF3E6", color: "#2E9B57" };
              return (
                <Link
                  key={recipe.name}
                  href={recipe.href}
                  className="recipe-card overflow-hidden rounded-md border border-[#FFD2AE] bg-[#FFF1E6] shadow-sm transition hover:-translate-y-0.5"
                  style={{ borderTop: `5px solid ${recipeAccent}` }}
                >
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="" className="food-image h-36 w-full object-cover" />
                  ) : (
                    <div className="flex h-36 items-center justify-center bg-[#FFF8F1]">
                      <ClocheMark className="h-20 w-auto" />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="recipe-card-title font-bold text-[#2E1B14]">{recipe.name}</div>
                      <HeartIcon className="h-5 w-5" style={{ color: recipeAccent }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="badge-lavender rounded-full bg-[#F7DDED] px-2 py-1 font-medium text-[#5A2145]">{recipe.region}</span>
                      <span className="recipe-card-duration py-1 font-semibold text-[#B84600]">{recipe.time}</span>
                      <span className={`rounded-full px-2 py-1 font-medium ${recipe.spice === "Medium" ? "badge-pink" : "badge-mint"}`} style={spiceTone}>
                        {recipe.spice}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section id="ingredients" className="grid gap-6 rounded-md border border-[#BDE8CB] bg-[#DFF3E6] p-5 sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <h2 className="text-3xl font-bold text-[#145C32]">Understand the spices behind the flavor</h2>
            <p className="mt-3 text-[#245B3B]">
              CurryForward can become more than a recipe list: a practical map of ingredients, substitutions, and
              regional technique.
            </p>
            <Link href="/recipes">
              <Button className="mt-5 bg-[#2E9B57] text-white hover:bg-[#247F46]">Explore Ingredients</Button>
            </Link>
          </div>
          <div className="flex flex-wrap gap-3">
            {SPICES.map((spice) => (
              <span
                key={spice.name}
                className="rounded-full border px-4 py-2 text-sm font-semibold"
                style={{ backgroundColor: spice.bg, borderColor: spice.color, color: spice.color }}
              >
                {spice.name}
              </span>
            ))}
          </div>
        </section>

        <section className="py-14">
          <div className="rounded-md border border-[#FFD2AE] bg-[#FFF8F1] p-5 shadow-sm sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1fr_420px] lg:items-center">
              <div className="flex gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#FFE7D1]">
                  <ClocheMark className="h-10 w-auto" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-[#2E1B14]">Get one curry idea every week</h2>
                  <p className="mt-2 text-[#5A4038]">
                    Seasonal recipes, spice notes, and practical cooking tips straight to your inbox.
                  </p>
                </div>
              </div>
              <form onSubmit={handleSubscribe} className="flex flex-col gap-3 sm:flex-row">
                <Input
                  type="email"
                  required
                  placeholder="Email address"
                  className="border-[#FFD2AE] bg-[#FFF1E6]"
                  aria-label="Email address"
                />
                <Button type="submit" className="bg-[#FF6B00] text-white hover:bg-[#E6462D]">
                  Subscribe
                </Button>
              </form>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 rounded-t-md bg-[#5A2145] px-5 py-6 text-sm text-[#FFF8F1]">
          <div className="flex items-center gap-2">
            <ClocheMark className="h-8 w-auto" />
            <span className="font-bold text-white">CurryForward</span>
            <span className="text-[#FFF1E6]">Food. Forward.</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/recipes" className="hover:text-[#FFB000]">
              Recipes
            </Link>
            <a href="#ingredients" className="hover:text-[#FFB000]">
              Ingredients
            </a>
            <a href="#about" className="hover:text-[#FFB000]">
              About
            </a>
            <a href="mailto:hello@curryforward.com" className="hover:text-[#FFB000]">
              Contact
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
