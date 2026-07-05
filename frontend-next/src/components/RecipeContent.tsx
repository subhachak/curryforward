"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { Ingredient, IngredientUnitOption, RecipeDetail } from "@/lib/types";

/**
 * The recipe body — everything between the page header and the sidebar.
 * Shared between the real public recipe page and the research workspace's
 * "Preview" mode, so what an admin sees while researching is exactly what
 * guests will see once published (same component, not just similar markup).
 * Every new-schema field is rendered conditionally so recipes without it
 * (anything created before this feature) still render unchanged.
 */
export function RecipeContent({ recipe }: { recipe: RecipeDetail }) {
  const [multiplier, setMultiplier] = useState(1);
  const [selectedUnits, setSelectedUnits] = useState<Record<string, number>>({});
  const suggestedUtensils = recipe.suggested_utensils || [];
  const panConversions = recipe.pan_conversions || [];
  const [selectedPanIndex, setSelectedPanIndex] = useState(0);
  const selectedPan = panConversions[selectedPanIndex];
  const multiplierLabel = useMemo(() => {
    const base = recipe.base_servings.amount;
    if (!base || multiplier === 1) return null;
    const scaled = roundAmount(base * multiplier);
    return `${scaled} ${recipe.base_servings.unit}`;
  }, [recipe.base_servings.amount, recipe.base_servings.unit, multiplier]);

  return (
    <div className="space-y-6">
      {recipe.hero_image_url ? (
        // Static-export app, no next/image optimization pipeline available.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={recipe.hero_image_url}
          alt=""
          className="h-64 w-full rounded-lg border border-border object-cover sm:h-80"
        />
      ) : (
        <div
          className="flex h-40 w-full items-center justify-center rounded-lg border border-border bg-gradient-to-br from-brand-soft to-accent-soft text-5xl"
          aria-hidden
        >
          🍛
        </div>
      )}

      {recipe.intro && (
        <p className="text-lg text-muted">{recipe.intro}</p>
      )}

      {(recipe.prep_time_minutes ||
        recipe.cook_time_minutes ||
        recipe.serving_size.amount ||
        recipe.serving_size.unit) && (
        <div className="flex flex-wrap gap-2">
          {recipe.prep_time_minutes != null && (
            <Badge tone="neutral">Prep: {recipe.prep_time_minutes} min</Badge>
          )}
          {recipe.cook_time_minutes != null && (
            <Badge tone="neutral">Cook: {recipe.cook_time_minutes} min</Badge>
          )}
          {(recipe.serving_size.amount || recipe.serving_size.unit) && (
            <Badge tone="neutral">
              Serving size: {[recipe.serving_size.amount, recipe.serving_size.unit].filter(Boolean).join(" ")}
            </Badge>
          )}
        </div>
      )}

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Recipe scale</div>
              <div className="text-xs text-muted">
                {recipe.base_servings.amount
                  ? `Original yield: ${recipe.base_servings.amount} ${recipe.base_servings.unit}`
                  : "Original yield not specified"}
                {multiplierLabel ? ` · scaled to ${multiplierLabel}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="recipe-multiplier" className="text-xs font-medium text-muted">
                Multiplier
              </label>
              <input
                id="recipe-multiplier"
                type="number"
                min="0.25"
                max="8"
                step="0.25"
                value={multiplier}
                onChange={(e) => setMultiplier(Number(e.target.value) || 1)}
                className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {recipe.history && (
        <Card>
          <CardBody>
            <div className="mb-2 font-semibold">History &amp; facts</div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{recipe.history}</p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {recipe.components.map((c) => (
          <Card key={c.component_name}>
            <CardBody>
              <div className="mb-2 font-semibold">{c.component_name}</div>
              <ul className="space-y-1 text-sm">
                {c.ingredients.map((ing, idx) => (
                  <li key={ing.ingredient_id ?? idx} className="flex items-center justify-between gap-2">
                    <span>{formatIngredient(ing, selectedUnits[`${c.component_name}-${idx}`] ?? 0, multiplier)} — {ing.name}</span>
                    {unitChoices(ing).length > 1 && (
                      <select
                        aria-label={`Unit for ${ing.name}`}
                        value={selectedUnits[`${c.component_name}-${idx}`] ?? 0}
                        onChange={(e) =>
                          setSelectedUnits((prev) => ({
                            ...prev,
                            [`${c.component_name}-${idx}`]: Number(e.target.value),
                          }))
                        }
                        className="h-8 max-w-28 rounded-md border border-border bg-surface px-2 text-xs"
                      >
                        {unitChoices(ing).map((option, optionIdx) => (
                          <option key={`${option.unit}-${optionIdx}`} value={optionIdx}>
                            {option.label || option.unit || "base"}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody>
          <div className="mb-2 font-semibold">Steps</div>
          <ol className="list-inside list-decimal space-y-3 text-sm">
            {recipe.steps.map((s, idx) => (
              <li key={idx}>
                {s.instruction}
                {s.component_ref && <span className="ml-1 text-xs text-muted">({s.component_ref})</span>}
                {s.image_url && (
                  // Static-export app, no next/image optimization pipeline available.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.image_url}
                    alt=""
                    className="mt-2 max-h-64 rounded-lg border border-border object-cover"
                  />
                )}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      {suggestedUtensils.length > 0 && (
        <Card>
          <CardBody>
            <div className="mb-2 font-semibold">Suggested utensils</div>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {suggestedUtensils.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {panConversions.length > 0 && (
        <Card>
          <CardBody>
            <div className="mb-2 font-semibold">Baking pan conversion</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select
                value={selectedPanIndex}
                onChange={(e) => setSelectedPanIndex(Number(e.target.value))}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              >
                {panConversions.map((conversion, idx) => (
                  <option key={idx} value={idx}>
                    {formatPanSide(conversion.from_count, conversion.from_size)} to{" "}
                    {formatPanSide(conversion.to_count, conversion.to_size)}
                  </option>
                ))}
              </select>
              {selectedPan && (
                <span className="text-foreground">
                  Use {formatPanSide(selectedPan.to_count, selectedPan.to_size)}
                  {selectedPan.note ? ` · ${selectedPan.note}` : ""}
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {recipe.tips.length > 0 && (
        <Card>
          <CardBody>
            <div className="mb-2 font-semibold">Tips &amp; tricks</div>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {recipe.tips.map((tip, idx) => (
                <li key={idx}>{tip}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {recipe.watch_outs.length > 0 && (
        <Card className="border-warning/40 bg-warning-soft/40">
          <CardBody>
            <div className="mb-2 font-semibold">Things to watch out for</div>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {recipe.watch_outs.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function unitChoices(ingredient: Ingredient): IngredientUnitOption[] {
  return [
    { amount: ingredient.amount, unit: ingredient.unit, label: ingredient.unit || "base" },
    ...(ingredient.unit_options || []),
  ];
}

function formatIngredient(ingredient: Ingredient, selectedIndex: number, multiplier: number): string {
  const option = unitChoices(ingredient)[selectedIndex] || unitChoices(ingredient)[0];
  const amount = option.amount == null ? "?" : roundAmount(option.amount * multiplier);
  return `${amount} ${option.unit || ingredient.unit || ""}`.trim();
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatPanSide(count: number | null, size: string): string {
  return `${count ?? "?"} x ${size}`.trim();
}
