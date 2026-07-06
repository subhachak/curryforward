import { Badge } from "@/components/ui/Badge";
import type { RecipeDetail } from "@/lib/types";

// FDA reference daily values for a 2000-calorie diet, used only to show an
// approximate "% Daily Value" column like a real nutrition label - these are
// not personalized and the whole panel is already a heuristic estimate
// (see backend/app/nutrition.py). Protein, trans fat, and total sugars have
// no established %DV on a real label, so they're left out of this map.
const DAILY_VALUES = {
  fat_g: 78,
  saturated_fat_g: 20,
  cholesterol_mg: 300,
  sodium_mg: 2300,
  carbs_g: 275,
  fiber_g: 28,
  added_sugars_g: 50,
  vitamin_d_mcg: 20,
  calcium_mg: 1300,
  iron_mg: 18,
  potassium_mg: 4700,
} as const;

function percentDV(value: number, key: keyof typeof DAILY_VALUES) {
  return Math.round((value / DAILY_VALUES[key]) * 100);
}

function singularize(unit: string): string {
  return unit.endsWith("s") && unit.length > 1 ? unit.slice(0, -1) : unit;
}

function servingSizeLabel(recipe: RecipeDetail): string {
  const { serving_size, base_servings } = recipe;
  if (serving_size.amount && serving_size.unit) {
    return `${serving_size.amount} ${serving_size.unit}`;
  }
  if (serving_size.unit) {
    return serving_size.unit;
  }
  return `1 ${singularize(base_servings.unit || "serving")}`;
}

export function NutritionCard({ recipe }: { recipe: RecipeDetail }) {
  const { nutrition, base_servings, components } = recipe;

  if (!nutrition || Object.keys(nutrition).length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
        No nutrition data yet
      </div>
    );
  }

  const servings = base_servings.amount && base_servings.amount > 0 ? base_servings.amount : 1;
  const perServing = (total?: number) => Math.round(((total ?? 0) / servings) * 10) / 10;

  const calories = perServing(nutrition.calories);
  const protein = perServing(nutrition.protein_g);
  const fat = perServing(nutrition.fat_g);
  const carbs = perServing(nutrition.carbs_g);
  const saturatedFat = perServing(nutrition.saturated_fat_g);
  const transFat = perServing(nutrition.trans_fat_g);
  const cholesterol = perServing(nutrition.cholesterol_mg);
  const sodium = perServing(nutrition.sodium_mg);
  const fiber = perServing(nutrition.fiber_g);
  const sugars = perServing(nutrition.sugars_g);
  const addedSugars = perServing(nutrition.added_sugars_g);
  const vitaminD = perServing(nutrition.vitamin_d_mcg);
  const calcium = perServing(nutrition.calcium_mg);
  const iron = perServing(nutrition.iron_mg);
  const potassium = perServing(nutrition.potassium_mg);
  const incomplete = nutrition.data_completeness === "partial";

  const ingredientList = components
    .flatMap((c) => c.ingredients.map((i) => i.name))
    .filter(Boolean)
    .join(", ");

  return (
    <div className="rounded-md border-2 border-[#2E1B14] bg-white p-4 font-sans shadow-sm">
      <div className="mb-2 h-2 rounded-full bg-[#FF6B00]" />
      <h3 className="text-3xl font-black leading-none text-[#2E1B14]">Nutrition Facts</h3>
      <div className="mt-1 text-sm text-[#5A4038]">
        {base_servings.amount ? `${base_servings.amount} ${base_servings.unit} per recipe` : "1 recipe"}
      </div>
      <div className="border-b-8 border-[#2E1B14] pb-1 text-base font-bold text-[#2E1B14]">
        Serving size {servingSizeLabel(recipe)}
      </div>

      <div className="border-b-4 border-[#2E1B14] pt-1 text-xs text-[#5A4038]">Amount Per Serving</div>
      <div className="flex items-baseline justify-between border-b-4 border-[#2E1B14] py-1">
        <span className="text-xl font-bold text-[#2E1B14]">Calories</span>
        <span className="text-4xl font-black text-[#2E1B14]">{calories || "-"}</span>
      </div>

      <div className="border-b border-[#2E1B14]/20 py-1 text-right text-xs font-bold text-[#5A4038]">
        % Daily Value*
      </div>

      <NutrientRow label="Total Fat" value={fat} unit="g" percent={percentDV(fat, "fat_g")} bold />
      <NutrientRow
        label="Saturated Fat"
        value={saturatedFat}
        unit="g"
        percent={percentDV(saturatedFat, "saturated_fat_g")}
        indent
      />
      <NutrientRow label="Trans Fat" value={transFat} unit="g" indent />
      <NutrientRow
        label="Cholesterol"
        value={cholesterol}
        unit="mg"
        percent={percentDV(cholesterol, "cholesterol_mg")}
        bold
      />
      <NutrientRow label="Sodium" value={sodium} unit="mg" percent={percentDV(sodium, "sodium_mg")} bold />
      <NutrientRow
        label="Total Carbohydrate"
        value={carbs}
        unit="g"
        percent={percentDV(carbs, "carbs_g")}
        bold
      />
      <NutrientRow label="Dietary Fiber" value={fiber} unit="g" percent={percentDV(fiber, "fiber_g")} indent />
      <NutrientRow label="Total Sugars" value={sugars} unit="g" indent />
      <NutrientRow
        label={`Includes ${addedSugars}g Added Sugars`}
        value={null}
        unit=""
        percent={percentDV(addedSugars, "added_sugars_g")}
        indent
        doubleIndent
      />
      <NutrientRow label="Protein" value={protein} unit="g" bold last />

      <NutrientRow
        label="Vitamin D"
        value={vitaminD}
        unit="mcg"
        percent={percentDV(vitaminD, "vitamin_d_mcg")}
        section
      />
      <NutrientRow label="Calcium" value={calcium} unit="mg" percent={percentDV(calcium, "calcium_mg")} />
      <NutrientRow label="Iron" value={iron} unit="mg" percent={percentDV(iron, "iron_mg")} />
      <NutrientRow
        label="Potassium"
        value={potassium}
        unit="mg"
        percent={percentDV(potassium, "potassium_mg")}
        last
      />

      <p className="mt-2 text-[11px] leading-snug text-[#5A4038]">
        *The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a
        daily diet. 2,000 calories a day is used for general nutrition advice. Estimated from
        ingredient data - not lab-verified.
      </p>

      {incomplete && (
        <div className="mt-2 flex items-center gap-2">
          <Badge tone="warning">Partial data</Badge>
          <span className="text-[11px] text-[#5A4038]">
            Unmatched: {nutrition.unmatched_ingredients?.join(", ")}
          </span>
        </div>
      )}

      {ingredientList && (
        <div className="mt-3 border-t border-[#2E1B14]/20 pt-2 text-[11px] leading-snug text-[#5A4038]">
          <span className="font-bold uppercase text-[#2E1B14]">Ingredients: </span>
          {ingredientList}.
        </div>
      )}
    </div>
  );
}

function NutrientRow({
  label,
  value,
  unit,
  percent,
  bold = false,
  indent = false,
  doubleIndent = false,
  section = false,
  last = false,
}: {
  label: string;
  value: number | null;
  unit: string;
  percent?: number;
  bold?: boolean;
  indent?: boolean;
  doubleIndent?: boolean;
  section?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between py-1 text-sm ${
        section ? "border-t-4 border-[#2E1B14]" : ""
      } ${last ? "" : "border-b border-[#2E1B14]/20"}`}
    >
      <span className={doubleIndent ? "pl-8" : indent ? "pl-4" : ""}>
        <span className={bold ? "font-bold text-[#2E1B14]" : indent ? "text-[#2E1B14]" : "font-semibold text-[#2E1B14]"}>
          {label}
        </span>
        {value !== null && (
          <span className="text-[#5A4038]">
            {" "}
            {value}
            {unit}
          </span>
        )}
      </span>
      {percent !== undefined && <span className="font-semibold text-[#2E1B14]">{percent}%</span>}
    </div>
  );
}
