import type { Ingredient, IngredientUnitOption } from "@/lib/types";
import { ingredientGrams } from "@/lib/recipeNutrition";

interface ConversionRule {
  keywords: string[];
  units: { unit: string; gramsPerUnit: number; label?: string }[];
}

const WEIGHT_UNITS = [
  { unit: "g", gramsPerUnit: 1, label: "g" },
  { unit: "oz", gramsPerUnit: 28.3495, label: "oz" },
  { unit: "lb", gramsPerUnit: 453.592, label: "lb" },
];

const VOLUME_RULES: ConversionRule[] = [
  rule(["water", "stock", "broth"], cup(240)),
  rule(["milk", "buttermilk"], cup(245)),
  rule(["cream", "heavy cream", "double cream", "yogurt", "curd"], cup(240)),
  rule(["oil", "olive oil", "vegetable oil", "mustard oil", "ghee"], cup(218), tbsp(13.6), tsp(4.5)),
  rule(["butter"], cup(227), tbsp(14.2), tsp(4.7)),
  rule(["flour", "maida", "atta", "all-purpose flour"], cup(120), tbsp(7.5)),
  rule(["bread flour"], cup(127), tbsp(8)),
  rule(["almond flour"], cup(96), tbsp(6)),
  rule(["sugar", "granulated sugar", "caster sugar"], cup(200), tbsp(12.5), tsp(4.2)),
  rule(["brown sugar"], cup(213), tbsp(13.3)),
  rule(["powdered sugar", "icing sugar"], cup(120), tbsp(7.5)),
  rule(["rice"], cup(185)),
  rule(["oats"], cup(90)),
  rule(["lentil", "dal", "beans", "chickpea"], cup(190)),
  rule(["breadcrumbs", "bread crumbs"], cup(108), tbsp(6.8)),
  rule(["grated parmesan", "parmesan"], cup(100), tbsp(6.3)),
  rule(["cream cheese"], cup(225), tbsp(14)),
  rule(["honey"], cup(340), tbsp(21), tsp(7)),
  rule(["maple syrup", "syrup"], cup(320), tbsp(20), tsp(6.7)),
  rule(["cocoa"], cup(85), tbsp(5.3)),
  rule(["cornstarch", "corn flour"], cup(128), tbsp(8)),
  rule(["salt"], tbsp(18), tsp(6), pinch(0.35)),
  rule(["baking powder"], tbsp(12), tsp(4)),
  rule(["baking soda"], tbsp(13.8), tsp(4.6)),
  rule(["yeast"], tbsp(9.3), tsp(3.1)),
  rule(["pepper", "chili powder", "cumin", "coriander", "turmeric", "garam masala", "cardamom", "cinnamon"], tbsp(6), tsp(2)),
  rule(["nut", "almond", "cashew", "pistachio", "walnut"], cup(140), tbsp(8.8)),
];

const COUNT_RULES: ConversionRule[] = [
  rule(["egg"], count("large egg", 50)),
  rule(["garlic"], count("clove", 3)),
  rule(["onion"], count("medium onion", 150)),
  rule(["tomato"], count("medium tomato", 120)),
  rule(["potato"], count("medium potato", 170)),
  rule(["carrot"], count("medium carrot", 60)),
  rule(["lemon", "lime"], count("piece", 60)),
  rule(["green chili", "chilli", "chile"], count("piece", 10)),
  rule(["banana"], count("medium banana", 120)),
  rule(["apple"], count("medium apple", 180)),
  rule(["mushroom"], count("piece", 18)),
];

export function smartUnitChoices(ingredient: Ingredient): IngredientUnitOption[] {
  const grams = ingredientGrams(ingredient);
  if (grams == null || grams <= 0) return [];

  const choices: IngredientUnitOption[] = [
    { amount: grams, unit: "g", label: "g" },
    ...WEIGHT_UNITS.filter((item) => item.unit !== "g")
      .filter((item) => item.unit !== "lb" || grams >= 225)
      .map((item) => toOption(grams, item)),
  ];

  for (const item of contextualConversions(ingredient.name)) {
    const option = toOption(grams, item);
    if (isUsefulAmount(option.amount)) choices.push(option);
  }

  for (const option of ingredient.unit_options || []) {
    if (option.amount == null || !option.unit || option.unit.toLowerCase() === "g") continue;
    choices.push({
      amount: option.amount,
      unit: option.unit,
      label: option.label || displayLabel(option.amount, option.unit),
    });
  }

  return dedupeOptions(choices);
}

export function smartUnitLabelsForIngredient(name: string, grams: number | null): string[] {
  if (grams == null || grams <= 0) return ["g"];
  return smartUnitChoices({
    name,
    amount: grams,
    unit: "g",
    gram_equivalent: grams,
    gram_amount: grams,
  }).map((option) => option.unit);
}

function contextualConversions(name: string) {
  const normalized = normalize(name);
  const matches = [...VOLUME_RULES, ...COUNT_RULES].filter((item) =>
    item.keywords.some((keyword) => normalized.includes(keyword))
  );
  return matches.flatMap((item) => item.units);
}

function rule(keywords: string[], ...units: ConversionRule["units"]): ConversionRule {
  return { keywords: keywords.map(normalize), units };
}

function cup(gramsPerUnit: number) {
  return { unit: "cup", gramsPerUnit, label: "cup" };
}

function tbsp(gramsPerUnit: number) {
  return { unit: "tbsp", gramsPerUnit, label: "tbsp" };
}

function tsp(gramsPerUnit: number) {
  return { unit: "tsp", gramsPerUnit, label: "tsp" };
}

function pinch(gramsPerUnit: number) {
  return { unit: "pinch", gramsPerUnit, label: "pinch" };
}

function count(unit: string, gramsPerUnit: number) {
  return { unit, gramsPerUnit, label: unit };
}

function toOption(grams: number, item: { unit: string; gramsPerUnit: number; label?: string }): IngredientUnitOption {
  const amount = roundAmount(grams / item.gramsPerUnit);
  return {
    amount,
    unit: item.unit,
    label: item.label || item.unit,
  };
}

function isUsefulAmount(amount: number | null): boolean {
  if (amount == null || !Number.isFinite(amount)) return false;
  return amount >= 0.125 && amount <= 48;
}

function dedupeOptions(options: IngredientUnitOption[]) {
  const result: IngredientUnitOption[] = [];
  for (const option of options) {
    const key = normalize(option.unit);
    if (!key) continue;
    const existingIndex = result.findIndex((item) => normalize(item.unit) === key);
    if (existingIndex >= 0) {
      result[existingIndex] = option;
      continue;
    }
    result.push(option);
  }
  return result;
}

function displayLabel(amount: number, unit: string) {
  return `${roundAmount(amount)} ${unit}`.trim();
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function roundAmount(value: number): number {
  if (value >= 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}
