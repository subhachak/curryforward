import { Badge } from "@/components/ui/Badge";
import type { RecipeDetail } from "@/lib/types";

// Rough reference daily values for a 2000-calorie diet, used only to show an
// approximate "% Daily Value" column like a real nutrition label — these are
// not personalized and the whole panel is already a heuristic estimate
// (see backend/app/nutrition.py).
const DAILY_VALUE = { fat_g: 78, carbs_g: 275, protein_g: 50 };

function percentDV(value: number, key: keyof typeof DAILY_VALUE) {
  return Math.round((value / DAILY_VALUE[key]) * 100);
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
  const incomplete = nutrition.data_completeness === "partial";

  const ingredientList = components
    .flatMap((c) => c.ingredients.map((i) => i.name))
    .filter(Boolean)
    .join(", ");

  return (
    <div className="rounded-lg border-2 border-ink bg-surface p-4 font-sans">
      <h3 className="text-2xl font-black leading-none text-ink">Nutrition Facts</h3>
      <div className="mt-1 border-b-8 border-ink pb-1 text-sm text-muted">
        {base_servings.amount ? (
          <>
            Serving size <span className="font-medium text-foreground">1 of {base_servings.amount} {base_servings.unit}</span>
          </>
        ) : (
          "Serving size 1 (whole recipe)"
        )}
      </div>

      <div className="flex items-baseline justify-between border-b-4 border-ink py-1.5">
        <span className="text-lg font-bold text-ink">Calories</span>
        <span className="text-3xl font-black text-ink">{calories || "—"}</span>
      </div>

      <div className="border-b border-foreground/20 py-1 text-right text-xs font-bold text-muted">
        % Daily Value*
      </div>

      <NutrientRow label="Total Fat" value={fat} unit="g" percent={percentDV(fat, "fat_g")} />
      <NutrientRow
        label="Total Carbohydrate"
        value={carbs}
        unit="g"
        percent={percentDV(carbs, "carbs_g")}
      />
      <NutrientRow
        label="Protein"
        value={protein}
        unit="g"
        percent={percentDV(protein, "protein_g")}
        last
      />

      <p className="mt-2 text-[11px] leading-snug text-muted">
        *% Daily Value based on a 2000 calorie diet. Estimated from ingredient data —
        not lab-verified.
      </p>

      {incomplete && (
        <div className="mt-2 flex items-center gap-2">
          <Badge tone="warning">Partial data</Badge>
          <span className="text-[11px] text-muted">
            Unmatched: {nutrition.unmatched_ingredients?.join(", ")}
          </span>
        </div>
      )}

      {ingredientList && (
        <div className="mt-3 border-t border-foreground/20 pt-2 text-[11px] leading-snug text-muted">
          <span className="font-bold uppercase text-foreground">Ingredients: </span>
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
  last = false,
}: {
  label: string;
  value: number;
  unit: string;
  percent: number;
  last?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between py-1 text-sm ${last ? "" : "border-b border-foreground/20"}`}>
      <span>
        <span className="font-semibold text-foreground">{label}</span>{" "}
        <span className="text-muted">
          {value}
          {unit}
        </span>
      </span>
      <span className="font-semibold text-foreground">{percent}%</span>
    </div>
  );
}
