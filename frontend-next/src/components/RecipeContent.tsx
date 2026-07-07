"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { Ingredient, IngredientUnitOption, RecipeDetail } from "@/lib/types";
import { estimatedRecipeYieldGrams, ingredientGrams } from "@/lib/recipeNutrition";
import { smartUnitChoices } from "@/lib/ingredientUnits";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

/**
 * The recipe body - everything between the page header and the sidebar.
 * Shared between the real public recipe page and the research workspace's
 * "Preview" mode, so what an admin sees while researching is exactly what
 * guests will see once published (same component, not just similar markup).
 * Every new-schema field is rendered conditionally so recipes without it
 * (anything created before this feature) still render unchanged.
 */
export function RecipeContent({ recipe }: { recipe: RecipeDetail }) {
  const [multiplier, setMultiplier] = useState(1);
  const [selectedUnits, setSelectedUnits] = useState<Record<string, number>>({});
  const [cookModeActive, setCookModeActive] = useState(false);
  const [cookModeError, setCookModeError] = useState<string | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wantsCookModeRef = useRef(false);
  const suggestedUtensils = recipe.suggested_utensils || [];
  const panConversions = recipe.pan_conversions || [];
  const [selectedPanIndex, setSelectedPanIndex] = useState(0);
  const selectedPan = panConversions[selectedPanIndex];
  const estimatedYieldGrams = estimatedRecipeYieldGrams(recipe);
  const singleDefaultIngredientSection =
    recipe.components.length === 1 && recipe.components[0]?.component_name?.trim().toLowerCase() === "main";
  const multiplierLabel = useMemo(() => {
    if (!estimatedYieldGrams || multiplier === 1) return null;
    const scaled = roundAmount(estimatedYieldGrams * multiplier);
    return `${scaled} g`;
  }, [estimatedYieldGrams, multiplier]);

  const handleWakeLockRelease = useCallback(() => {
    wakeLockRef.current = null;
    setCookModeActive(false);
  }, []);

  const requestWakeLock = useCallback(async () => {
    setCookModeError(null);

    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      wantsCookModeRef.current = false;
      setCookModeActive(false);
      setCookModeError("Cook mode needs a browser that supports screen wake lock.");
      return;
    }

    try {
      const sentinel = await (navigator as WakeLockNavigator).wakeLock?.request("screen");
      if (!sentinel) throw new Error("Screen wake lock is unavailable.");

      wakeLockRef.current?.removeEventListener("release", handleWakeLockRelease);
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", handleWakeLockRelease);
      setCookModeActive(true);
    } catch (error) {
      wantsCookModeRef.current = false;
      wakeLockRef.current = null;
      setCookModeActive(false);
      setCookModeError(
        error instanceof Error
          ? error.message
          : "Cook mode could not keep this screen awake.",
      );
    }
  }, [handleWakeLockRelease]);

  const releaseWakeLock = useCallback(async () => {
    wantsCookModeRef.current = false;
    setCookModeError(null);

    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    setCookModeActive(false);

    if (!sentinel) return;
    sentinel.removeEventListener("release", handleWakeLockRelease);
    if (!sentinel.released) {
      await sentinel.release().catch(() => undefined);
    }
  }, [handleWakeLockRelease]);

  const toggleCookMode = useCallback(async () => {
    if (cookModeActive) {
      await releaseWakeLock();
      return;
    }

    wantsCookModeRef.current = true;
    await requestWakeLock();
  }, [cookModeActive, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        wantsCookModeRef.current &&
        !wakeLockRef.current
      ) {
        void requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [requestWakeLock]);

  useEffect(() => {
    return () => {
      wantsCookModeRef.current = false;
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      if (sentinel && !sentinel.released) {
        void sentinel.release();
      }
    };
  }, []);

  return (
    <div className="space-y-6">
      {(recipe.prep_time_minutes ||
        recipe.cook_time_minutes ||
        recipe.serving_size.amount) && (
        <div className="flex flex-wrap gap-2">
          {recipe.prep_time_minutes != null && (
            <Badge tone="neutral">Prep: {formatDuration(recipe.prep_time_minutes)}</Badge>
          )}
          {recipe.cook_time_minutes != null && (
            <Badge tone="neutral">Cook: {formatDuration(recipe.cook_time_minutes)}</Badge>
          )}
          {recipe.serving_size.amount && (
            <Badge tone="neutral">
              Serving size: {recipe.serving_size.amount} g
            </Badge>
          )}
        </div>
      )}

      {recipe.history && (
        <Card className="border-[#FFD2AE] bg-white">
          <CardBody>
            <div className="mb-2 font-semibold text-[#2E1B14]">Overview</div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-[#5A4038]">{recipe.history}</p>
          </CardBody>
        </Card>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-[#2E1B14]">Ingredients</h2>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#FFD2AE] bg-[#FFF8F1] px-3 py-2">
            <div className="text-xs text-[#5A4038]">
              <span className="font-semibold text-[#2E1B14]">Scale</span>
              {estimatedYieldGrams ? ` · ${estimatedYieldGrams} g yield` : " · yield unknown"}
              {multiplierLabel ? ` · ${multiplierLabel}` : ""}
            </div>
            <label htmlFor="recipe-multiplier" className="sr-only">
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
              className="h-8 w-20 rounded-md border border-[#FFD2AE] bg-white px-2 text-sm focus:border-[#FF6B00] focus:outline-none focus:ring-2 focus:ring-[#FF6B00]/30"
              aria-label="Recipe multiplier"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {recipe.components.map((c, componentIdx) => (
            <Card key={`${c.component_name || "ingredients"}-${componentIdx}`} className="border-[#BDE8CB] bg-white">
              <CardBody>
                {!singleDefaultIngredientSection && (
                  <div className="mb-3 flex items-center gap-1.5 font-semibold text-[#145C32]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/brand/icon-ingredients-leaf.svg" alt="" aria-hidden className="h-4 w-4" />
                    {c.component_name}
                  </div>
                )}
                <ul className="space-y-1 text-sm">
                  {c.ingredients.map((ing, idx) => (
                    <li key={ing.ingredient_id ?? idx} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 hover:bg-[#DFF3E6]/45">
                      <label className="flex min-w-0 items-center gap-2">
                        <input type="checkbox" className="h-4 w-4 rounded border-[#BDE8CB] accent-[#2E9B57]" />
                        <span className="min-w-0">
                          <IngredientAmount
                            ingredient={ing}
                            selectedIndex={selectedUnits[`${componentIdx}-${idx}`] ?? defaultUnitIndex(ing)}
                            multiplier={multiplier}
                          />{" "}
                          <span className="text-[#5A4038]">{ing.name}</span>
                        </span>
                      </label>
                      {unitChoices(ing).length > 1 && (
                        <select
                          aria-label={`Unit for ${ing.name}`}
                          value={selectedUnits[`${componentIdx}-${idx}`] ?? defaultUnitIndex(ing)}
                          onChange={(e) =>
                            setSelectedUnits((prev) => ({
                              ...prev,
                              [`${componentIdx}-${idx}`]: Number(e.target.value),
                            }))
                          }
                          className="h-8 max-w-28 rounded-md border border-[#BDE8CB] bg-white px-2 text-xs"
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
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-[#2E1B14]">Instructions</h2>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              aria-pressed={cookModeActive}
              onClick={() => void toggleCookMode()}
              className={`rounded-md px-3 py-2 text-sm font-semibold text-white transition ${
                cookModeActive ? "bg-[#2E9B57] hover:bg-[#257C47]" : "bg-[#FF6B00] hover:bg-[#E6462D]"
              }`}
            >
              {cookModeActive ? "End cook mode" : "Start cook mode"}
            </button>
            {cookModeActive && (
              <span className="text-right text-xs font-medium text-[#2E9B57]">
                Screen stays awake while this tab is open.
              </span>
            )}
            {cookModeError && (
              <span className="max-w-xs text-right text-xs font-medium text-[#A6321B]">
                {cookModeError}
              </span>
            )}
          </div>
        </div>
        <ol className="space-y-3 text-sm">
          {recipe.steps.map((s, idx) => (
            <li key={idx} className="rounded-md border border-[#FFD2AE] bg-white p-4">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FF6B00] text-sm font-bold text-white">
                  {idx + 1}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[#2E1B14]">Step {idx + 1}</div>
                  <p className="mt-1 leading-6 text-[#5A4038]">{s.instruction}</p>
                  {s.component_ref && (
                    <span className="mt-2 inline-flex rounded-full bg-[#FFF0C1] px-2 py-0.5 text-xs font-semibold text-[#7A5200]">
                      {s.component_ref}
                    </span>
                  )}
                </div>
              </div>
              {s.image_url && (
                // Static-export app, no next/image optimization pipeline available.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.image_url}
                  alt=""
                  className="mt-3 max-h-64 rounded-lg border border-[#FFD2AE] object-cover"
                />
              )}
            </li>
          ))}
        </ol>
      </section>

      {suggestedUtensils.length > 0 && (
        <Card className="border-[#FFD2AE] bg-white">
          <CardBody>
            <div className="mb-2 font-semibold text-[#2E1B14]">Suggested utensils</div>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {suggestedUtensils.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {panConversions.length > 0 && (
        <Card className="border-[#FFD2AE] bg-white">
          <CardBody>
            <div className="mb-2 font-semibold text-[#2E1B14]">Baking pan conversion</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select
                value={selectedPanIndex}
                onChange={(e) => setSelectedPanIndex(Number(e.target.value))}
                className="h-9 rounded-md border border-[#FFD2AE] bg-white px-2 text-sm"
              >
                {panConversions.map((conversion, idx) => (
                  <option key={idx} value={idx}>
                    {formatPanSide(conversion.from_count, conversion.from_size)} to{" "}
                    {formatPanSide(conversion.to_count, conversion.to_size)}
                  </option>
                ))}
              </select>
              {selectedPan && (
                <span className="text-[#2E1B14]">
                  Use {formatPanSide(selectedPan.to_count, selectedPan.to_size)}
                  {selectedPan.note ? ` - ${selectedPan.note}` : ""}
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {recipe.tips.length > 0 && (
        <Card className="border-[#FFDD85] bg-[#FFF8F1]">
          <CardBody>
            <div className="mb-2 font-semibold text-[#7A5200]">Tips &amp; tricks</div>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {recipe.tips.map((tip, idx) => (
                <li key={idx}>{tip}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {recipe.watch_outs.length > 0 && (
        <Card className="border-[#F2B7AD] bg-[#FFE0DA]">
          <CardBody>
            <div className="mb-2 font-semibold text-[#E6462D]">Things to watch out for</div>
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

function IngredientAmount({
  ingredient,
  selectedIndex,
  multiplier,
}: {
  ingredient: Ingredient;
  selectedIndex: number;
  multiplier: number;
}) {
  const grams = gramAmount(ingredient);
  if (grams == null) {
    return <span className="text-sm font-medium text-[#A36A00]">Add grams</span>;
  }

  const option = unitChoices(ingredient)[selectedIndex] || unitChoices(ingredient)[0];
  const amount = roundAmount((option.amount ?? grams) * multiplier);
  const primary = `${amount} ${option.unit || "g"}`.trim();
  const gramText = `${roundAmount(grams * multiplier)} g`;

  return (
    <>
      <span className="font-semibold text-[#2E1B14]">{primary}</span>
      {option.unit !== "g" && gramText && (
        <span className="ml-1 text-xs text-[#8A766C]">({gramText})</span>
      )}
    </>
  );
}

function unitChoices(ingredient: Ingredient): IngredientUnitOption[] {
  return smartUnitChoices(ingredient);
}

function defaultUnitIndex(ingredient: Ingredient): number {
  const displayUnit = (ingredient.display_unit || "").trim().toLowerCase();
  if (!displayUnit || displayUnit === "g") return 0;
  const index = unitChoices(ingredient).findIndex((option) => option.unit.toLowerCase() === displayUnit);
  return index >= 0 ? index : 0;
}

function gramAmount(ingredient: Ingredient): number | null {
  return ingredientGrams(ingredient);
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

function formatPanSide(count: number | null, size: string): string {
  return `${count ?? "?"} x ${size}`.trim();
}
