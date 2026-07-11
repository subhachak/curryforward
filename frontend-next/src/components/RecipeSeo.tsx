"use client";

import { useEffect } from "react";
import type { RecipeDetail } from "@/lib/types";

export function RecipeSeo({ recipe }: { recipe: RecipeDetail }) {
  useEffect(() => {
    const description = recipe.intro || `Cook ${recipe.name} with ingredients, step-by-step instructions, and practical tips.`;
    const canonical = `${window.location.origin}/${encodeURIComponent(recipe.public_slug || recipe.recipe_id)}`;
    document.title = `${recipe.name} · Curry Forward`;

    setMeta("description", description);
    setMeta("og:title", recipe.name, "property");
    setMeta("og:description", description, "property");
    setMeta("og:type", "article", "property");
    setMeta("og:url", canonical, "property");
    if (recipe.hero_image_url) setMeta("og:image", new URL(recipe.hero_image_url, window.location.origin).href, "property");

    let canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.rel = "canonical";
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonical;

    const schema = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: recipe.name,
      description,
      image: recipe.hero_image_url ? [new URL(recipe.hero_image_url, window.location.origin).href] : undefined,
      datePublished: recipe.metadata?.first_published_at || recipe.created_at || undefined,
      dateModified: recipe.metadata?.last_updated_at || recipe.updated_at || undefined,
      recipeCategory: recipe.category || undefined,
      recipeCuisine: recipe.cuisine_tags.join(", ") || undefined,
      prepTime: duration(recipe.prep_time_minutes),
      cookTime: duration(recipe.cook_time_minutes),
      totalTime: duration((recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0)),
      recipeYield: recipe.serving_count ? `${recipe.serving_count} servings` : undefined,
      recipeIngredient: recipe.components.flatMap((component) => component.ingredients.map((item) => `${item.amount ?? ""} ${item.unit} ${item.name}`.trim())),
      recipeInstructions: recipe.steps.map((step) => ({ "@type": "HowToStep", text: step.instruction })),
      aggregateRating: recipe.feedback_summary?.rating_count
        ? { "@type": "AggregateRating", ratingValue: recipe.feedback_summary.average_rating, ratingCount: recipe.feedback_summary.rating_count }
        : undefined,
    };
    const script = document.createElement("script");
    script.id = "recipe-structured-data";
    script.type = "application/ld+json";
    script.text = JSON.stringify(schema);
    document.getElementById(script.id)?.remove();
    document.head.appendChild(script);
    return () => script.remove();
  }, [recipe]);

  return null;
}

function setMeta(key: string, content: string, attribute: "name" | "property" = "name") {
  let meta = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attribute, key);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function duration(minutes: number | null | undefined) {
  return minutes && minutes > 0 ? `PT${minutes}M` : undefined;
}
