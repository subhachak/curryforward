"use client";

import Link from "next/link";
import { FormEvent, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAssistant } from "@/context/AssistantContext";
import { useRecipes } from "@/context/RecipesContext";
import { HeartIcon } from "@/components/ui/icons";
import { publicRecipeHref } from "@/lib/recipeLinks";

const SWEETS = [
  "Nolen Gur Rosogolla",
  "Patishapta",
  "Sandesh",
  "Langcha",
  "Pantua",
  "Chomchom",
  "Kheer Kadam",
  "Mihidana",
];

const PILLARS = [
  {
    title: "Indian Classics",
    body: "Regional curries, dals, rice dishes, snacks, and festive meals.",
    icon: "/brand/icon-curry-bowl.svg",
    accent: "#FF6B00",
    bg: "#FFE7D1",
  },
  {
    title: "Bengali Kitchen",
    body: "Fish curries, bhajas, shukto, panch phoron flavors, and home-style comfort food.",
    icon: "/brand/icon-menu-cloche.svg",
    accent: "#2E9B57",
    bg: "#DFF3E6",
  },
  {
    title: "Traditional Sweets",
    body: "Mishti, pitha, payesh, sandesh, jaggery sweets, and festive desserts.",
    icon: "/brand/icon-spice-chili.svg",
    accent: "#D94F70",
    bg: "#FFE2EA",
  },
  {
    title: "Global Recipes",
    body: "Everyday dishes from around the world, adapted for home cooks.",
    icon: "/brand/icon-recipes-book.svg",
    accent: "#5A2145",
    bg: "#F7DDED",
  },
];

const CAPABILITIES = [
  {
    title: "Customize recipes",
    body: "Make it less spicy, eggless, dairy-free, lower sugar, or scaled for guests.",
    accent: "#FF6B00",
  },
  {
    title: "Preserve versions",
    body: "Keep the original recipe and save every adaptation as a new version.",
    accent: "#5A2145",
  },
  {
    title: "Understand nutrition",
    body: "See nutrition estimates change when ingredients or servings change.",
    accent: "#2E9B57",
  },
  {
    title: "Cook with context",
    body: "Learn why ingredients matter, what substitutions work, and where the dish comes from.",
    accent: "#FFB000",
  },
];

const DISCOVERY = [
  { label: "Bengali", color: "#2E9B57", bg: "#DFF3E6" },
  { label: "Sweets", color: "#D94F70", bg: "#FFE2EA" },
  { label: "Festive", color: "#FF6B00", bg: "#FFE7D1" },
  { label: "Vegetarian", color: "#2E9B57", bg: "#DFF3E6" },
  { label: "Fish", color: "#5A2145", bg: "#F7DDED" },
  { label: "Chicken", color: "#E6392E", bg: "#FFE0DA" },
  { label: "Quick Dinner", color: "#7A3E1D", bg: "#FFE9D8" },
  { label: "Jaggery", color: "#7A3E1D", bg: "#FFF0C1" },
  { label: "Pitha", color: "#D94F70", bg: "#FFE2EA" },
  { label: "No oven", color: "#5A2145", bg: "#F7DDED" },
  { label: "Kid-friendly", color: "#FFB000", bg: "#FFF0C1" },
  { label: "Low sugar", color: "#E6392E", bg: "#FFE0DA" },
];

const HARD_TO_FIND = [
  "Joynagarer Moa",
  "Narkel Naru",
  "Patishapta",
  "Malpoa",
  "Labra",
  "Shukto",
  "Mochar Ghonto",
  "Dhokar Dalna",
];

const HERO_CHIPS = [
  { label: "Make it less sweet", color: "#D94F70", bg: "#FFE2EA" },
  { label: "Scale for 12 people", color: "#FF6B00", bg: "#FFE7D1" },
  { label: "Use pantry ingredients", color: "#2E9B57", bg: "#DFF3E6" },
  { label: "Make it festive", color: "#FFB000", bg: "#FFF0C1" },
  { label: "Make it eggless", color: "#5A2145", bg: "#F7DDED" },
];

const FALLBACK_RECIPES = [
  {
    name: "Nolen Gur Payesh",
    region: "Bengali sweet",
    time: "45 min",
    occasion: "Winter",
    href: "/recipes",
  },
  {
    name: "Kolkata Chicken Rezala",
    region: "Bengali",
    time: "45 min",
    occasion: "Dinner",
    href: "/recipes",
  },
  {
    name: "Patishapta",
    region: "Pitha",
    time: "50 min",
    occasion: "Festive",
    href: "/recipes",
  },
];

function ClocheMark({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/mark-cloche-forward.svg" alt="" aria-hidden className={className} />
  );
}

export default function HomePage() {
  const { setOpen } = useAssistant();
  const { recipes } = useRecipes();

  const featured = useMemo(() => {
    return (
      recipes.find((recipe) => recipe.name.toLowerCase().includes("payesh")) ??
      recipes.find((recipe) => recipe.name.toLowerCase().includes("rezala")) ??
      recipes[0] ??
      null
    );
  }, [recipes]);

  const popular = useMemo(() => {
    if (recipes.length === 0) return FALLBACK_RECIPES;
    return recipes.slice(0, 3).map((recipe, index) => ({
      name: recipe.name,
      region: recipe.cuisine_tags[0] ?? recipe.category ?? "Recipe",
      time: ["45 min", "35 min", "50 min"][index] ?? "40 min",
      occasion: ["Home", "Dinner", "Festive"][index] ?? "Kitchen",
      href: publicRecipeHref(recipe),
      hero_image_url: recipe.hero_image_url,
    }));
  }, [recipes]);

  function handleSubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <div className="-mx-4 -my-6 bg-[#FFF8F1] text-[#2A160F] sm:-mx-6">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <section className="grid min-h-[560px] gap-8 overflow-hidden rounded-md border border-[#FFD2AE] bg-[#FFF0DD] p-5 sm:p-8 lg:grid-cols-[1fr_440px] lg:items-center">
          <div className="max-w-2xl space-y-6">
            <span className="inline-flex rounded-full bg-[#D94F70] px-3 py-1 text-xs font-semibold text-white">
              Indian and global recipes with Bengali roots
            </span>
            <h1 className="max-w-xl text-5xl font-bold leading-tight text-[#2A160F] sm:text-6xl">
              Recipes with roots. Made for today&apos;s kitchen.
            </h1>
            <p className="max-w-xl text-lg text-[#6B4A3A]">
              Explore Indian favorites, Bengali classics, traditional sweets, and global recipes - then adapt them to
              your taste, diet, and pantry with CurryForward.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/recipes">
                <Button className="bg-[#FF6B00] text-white shadow-[0_8px_18px_rgba(255,107,0,0.25)] hover:bg-[#E6392E]">
                  Explore Recipes
                </Button>
              </Link>
              <a href="#bengali-sweets">
                <Button className="border border-[#D94F70] bg-[#FFE2EA] text-[#8F2645] hover:bg-[#FFD1DE]">
                  Browse Bengali Sweets
                </Button>
              </a>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Ask CurryForward
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {HERO_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setOpen(true)}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={{ backgroundColor: chip.bg, color: chip.color }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-md border border-[#FFD2AE] bg-[#FFF8F1]">
            <div className="absolute left-8 top-8 rounded-md bg-[#FFE2EA] px-3 py-2 text-sm font-semibold text-[#8F2645] shadow-sm">
              Bengali sweets
            </div>
            <div className="absolute bottom-8 left-8 rounded-md bg-[#DFF3E6] px-3 py-2 text-sm font-semibold text-[#2E9B57] shadow-sm">
              Pantry swaps
            </div>
            <div className="absolute bottom-10 right-8 rounded-md bg-[#FFF0C1] px-3 py-2 text-sm font-semibold text-[#7A3E1D] shadow-sm">
              Festive batch
            </div>
            <div className="absolute left-12 top-24 h-24 w-24 rounded-full border-8 border-[#FFB000]" aria-hidden />
            <div className="absolute bottom-20 right-16 h-20 w-20 rounded-full border-8 border-[#2E9B57]" aria-hidden />
            <div className="absolute right-16 top-14 h-14 w-14 rounded-full bg-[#FFE0DA]" aria-hidden />
            <ClocheMark className="relative z-10 h-56 w-auto drop-shadow-sm sm:h-64" />
          </div>
        </section>

        <section id="bengali-sweets" className="py-14">
          <div className="grid gap-6 rounded-md border border-[#F0B8C7] bg-[#FFE2EA] p-5 sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <div className="mb-2 text-sm font-semibold uppercase text-[#D94F70]">Featured pillar</div>
              <h2 className="text-3xl font-bold text-[#2A160F]">Traditional Bengali sweets, brought forward.</h2>
              <p className="mt-3 text-[#6B4A3A]">
                From patishapta and payesh to sandesh and nolen gur classics, discover sweets many of us miss outside
                India - explained for modern kitchens.
              </p>
              <a href="#hard-to-find">
                <Button className="mt-5 bg-[#D94F70] text-white hover:bg-[#B83B59]">Explore sweets</Button>
              </a>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {SWEETS.map((sweet, index) => {
                const accents = ["#D94F70", "#7A3E1D", "#FFB000", "#2E9B57"];
                const accent = accents[index % accents.length];
                return (
                  <Link
                    key={sweet}
                    href={`/recipes?q=${encodeURIComponent(sweet)}`}
                    className="rounded-md border border-white/70 bg-[#FFF8F1] p-4 font-semibold text-[#2A160F] shadow-sm transition hover:-translate-y-0.5"
                    style={{ borderLeft: `5px solid ${accent}` }}
                  >
                    {sweet}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-4">
          <div className="mb-5">
            <h2 className="text-3xl font-bold text-[#2A160F]">Recipe pillars</h2>
            <p className="mt-1 text-[#6B4A3A]">Broad enough for global recipes, rooted enough to feel unmistakable.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((pillar) => (
              <Link
                key={pillar.title}
                href="/recipes"
                className="rounded-md border border-[#FFD2AE] bg-[#FFF0DD] p-5 transition hover:-translate-y-0.5 hover:shadow-sm"
                style={{ borderTop: `5px solid ${pillar.accent}` }}
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md" style={{ backgroundColor: pillar.bg }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pillar.icon} alt="" aria-hidden className="h-8 w-8" />
                </div>
                <div className="text-lg font-bold text-[#2A160F]">{pillar.title}</div>
                <p className="mt-2 text-sm leading-6 text-[#6B4A3A]">{pillar.body}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="py-14">
          <div className="rounded-md bg-[#2A160F] px-5 py-10 text-[#FFF8F1] sm:px-8">
            <div className="mb-6 max-w-2xl">
              <h2 className="text-3xl font-bold">Cook from tradition. Adapt with confidence.</h2>
              <p className="mt-2 text-[#FFF0DD]">
                Change spice, sweetness, servings, ingredients, and dietary needs without losing the original recipe.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map((item) => (
                <div key={item.title} className="rounded-md border border-white/15 bg-white/5 p-4">
                  <div className="mb-3 h-1.5 rounded-full" style={{ backgroundColor: item.accent }} />
                  <div className="font-bold text-white">{item.title}</div>
                  <p className="mt-2 text-sm leading-6 text-[#FFF0DD]">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 py-4 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <div className="mb-2 text-sm font-semibold uppercase text-[#FF6B00]">Under the cloche this week</div>
            <h2 className="text-3xl font-bold text-[#2A160F]">{featured?.name ?? "Nolen Gur Payesh"}</h2>
            <p className="mt-3 max-w-md text-[#6B4A3A]">
              {featured?.intro ??
                "A winter Bengali classic made with date palm jaggery, milk, and fragrant rice."}
            </p>
          </div>

          <div className="rounded-md border border-[#FFD2AE] bg-[#FFF0DD] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="rounded-full bg-[#FFB000] px-3 py-1 text-xs font-bold text-[#2A160F]">Featured</span>
              <ClocheMark className="h-9 w-auto" />
            </div>
            <h3 className="text-2xl font-bold text-[#2A160F]">{featured?.name ?? "Nolen Gur Payesh"}</h3>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-[#FFF8F1] px-3 py-1 text-[#6B4A3A]">45 min</span>
              <span className="rounded-full bg-[#DFF3E6] px-3 py-1 font-semibold text-[#2E9B57]">Comforting</span>
              <span className="rounded-full bg-[#FFE2EA] px-3 py-1 font-semibold text-[#D94F70]">
                {featured?.cuisine_tags[0] ?? "Bengali"}
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={featured ? publicRecipeHref(featured) : "/recipes"}>
                <Button className="bg-[#FF6B00] text-white hover:bg-[#E6392E]">View Recipe</Button>
              </Link>
              <Button className="border border-[#5A2145] bg-[#F7DDED] text-[#5A2145] hover:bg-[#EECBE1]" onClick={() => setOpen(true)}>
                Adapt this recipe
              </Button>
            </div>
          </div>
        </section>

        <section className="py-14">
          <div className="mb-5">
            <h2 className="text-3xl font-bold text-[#2A160F]">Find recipes by craving, occasion, or ingredient</h2>
            <p className="mt-1 text-[#6B4A3A]">Discovery for Indian, Bengali, sweets, and global cooking in one place.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {DISCOVERY.map((chip) => (
              <Link
                key={chip.label}
                href={`/recipes?q=${encodeURIComponent(chip.label)}`}
                className="rounded-full border px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5"
                style={{ backgroundColor: chip.bg, borderColor: chip.color, color: chip.color }}
              >
                {chip.label}
              </Link>
            ))}
          </div>
        </section>

        <section id="hard-to-find" className="grid gap-6 rounded-md border border-[#FFD2AE] bg-[#FFF0DD] p-5 sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <h2 className="text-3xl font-bold text-[#2A160F]">Hard-to-find classics from home</h2>
            <p className="mt-3 text-[#6B4A3A]">
              Some recipes rarely make it into restaurant menus or packaged sweets abroad. CurryForward documents them
              clearly so they can survive in modern kitchens.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {HARD_TO_FIND.map((item, index) => {
              const accent = ["#7A3E1D", "#D94F70", "#2E9B57", "#FF6B00"][index % 4];
              return (
                <Link
                  key={item}
                  href={`/recipes?q=${encodeURIComponent(item)}`}
                  className="rounded-md bg-[#FFF8F1] p-4 font-semibold text-[#2A160F] shadow-sm transition hover:-translate-y-0.5"
                  style={{ borderLeft: `5px solid ${accent}` }}
                >
                  {item}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="py-14">
          <div className="mb-5">
            <h2 className="text-3xl font-bold text-[#2A160F]">Popular starting points</h2>
            <p className="mt-1 text-[#6B4A3A]">Recipes to cook as written, then adapt when your kitchen asks for it.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {popular.map((recipe, index) => {
              const imageUrl =
                "hero_image_url" in recipe && typeof recipe.hero_image_url === "string"
                  ? recipe.hero_image_url
                  : null;
              const recipeAccent = ["#D94F70", "#2E9B57", "#FF6B00"][index] ?? "#FF6B00";
              return (
                <Link
                  key={recipe.name}
                  href={recipe.href}
                  className="overflow-hidden rounded-md border border-[#FFD2AE] bg-[#FFF0DD] shadow-sm transition hover:-translate-y-0.5"
                  style={{ borderTop: `5px solid ${recipeAccent}` }}
                >
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="" className="h-36 w-full object-cover" />
                  ) : (
                    <div className="flex h-36 items-center justify-center bg-[#FFF8F1]">
                      <ClocheMark className="h-20 w-auto" />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-bold text-[#2A160F]">{recipe.name}</div>
                      <HeartIcon className="h-5 w-5" style={{ color: recipeAccent }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-[#F7DDED] px-2 py-1 font-medium text-[#5A2145]">{recipe.region}</span>
                      <span className="rounded-full bg-[#FFF0C1] px-2 py-1 font-medium text-[#7A3E1D]">{recipe.time}</span>
                      <span className="rounded-full bg-[#DFF3E6] px-2 py-1 font-medium text-[#2E9B57]">{recipe.occasion}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="pb-14">
          <div className="rounded-md border border-[#FFD2AE] bg-[#FFF8F1] p-5 shadow-sm sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1fr_420px] lg:items-center">
              <div className="flex gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#FFE2EA]">
                  <ClocheMark className="h-10 w-auto" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-[#2A160F]">Get a recipe from home every week</h2>
                  <p className="mt-2 text-[#6B4A3A]">
                    Bengali sweets, Indian classics, and practical recipe adaptations delivered with clear steps and
                    modern kitchen notes.
                  </p>
                </div>
              </div>
              <form onSubmit={handleSubscribe} className="flex flex-col gap-3 sm:flex-row">
                <Input
                  type="email"
                  required
                  placeholder="Email address"
                  className="border-[#FFD2AE] bg-[#FFF0DD]"
                  aria-label="Email address"
                />
                <Button type="submit" className="bg-[#FF6B00] text-white hover:bg-[#E6392E]">
                  Subscribe
                </Button>
              </form>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 rounded-t-md bg-[#2A160F] px-5 py-6 text-sm text-[#FFF8F1]">
          <div className="flex items-center gap-2">
            <ClocheMark className="h-8 w-auto" />
            <span className="font-bold text-white">CurryForward</span>
            <span className="text-[#FFF0DD]">Recipes with roots, adapted for today.</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/recipes" className="hover:text-[#FFB000]">
              Recipes
            </Link>
            <a href="#bengali-sweets" className="hover:text-[#FFB000]">
              Bengali Sweets
            </a>
            <a href="#hard-to-find" className="hover:text-[#FFB000]">
              Classics
            </a>
            <button type="button" onClick={() => setOpen(true)} className="hover:text-[#FFB000]">
              Ask
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
