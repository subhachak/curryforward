import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { Nutrition } from "@/lib/types";

export function NutritionCard({ nutrition }: { nutrition: Nutrition | null | undefined }) {
  if (!nutrition || Object.keys(nutrition).length === 0) {
    return (
      <Card>
        <CardBody className="text-sm text-muted">No nutrition data yet</CardBody>
      </Card>
    );
  }

  const incomplete = nutrition.data_completeness === "partial";

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold">Nutrition Facts</span>
          <Badge tone={incomplete ? "warning" : "success"}>
            {incomplete ? "partial data" : "complete"}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Calories" value={nutrition.calories} />
          <Stat label="Protein" value={nutrition.protein_g} suffix="g" />
          <Stat label="Fat" value={nutrition.fat_g} suffix="g" />
          <Stat label="Carbs" value={nutrition.carbs_g} suffix="g" />
        </div>
        {incomplete && nutrition.unmatched_ingredients && nutrition.unmatched_ingredients.length > 0 && (
          <div className="mt-3 text-xs text-muted">
            Unmatched: {nutrition.unmatched_ingredients.join(", ")}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, suffix = "" }: { label: string; value?: number; suffix?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium">
        {value ?? "—"}
        {value != null ? suffix : ""}
      </div>
    </div>
  );
}
