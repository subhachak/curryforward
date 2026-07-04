import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { RecipeSummary } from "@/lib/types";

const lineageTone: Record<string, "brand" | "success" | "warning" | "neutral"> = {
  seed: "neutral",
  edit: "brand",
  fork: "warning",
  generated: "success",
  user_customized: "brand",
};

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  return (
    <Link href={`/recipe?id=${encodeURIComponent(recipe.recipe_id)}`}>
      <Card className="h-full p-4 transition hover:-translate-y-0.5 hover:shadow-md">
        <div className="font-semibold">{recipe.name}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {recipe.category && <Badge tone="neutral">{recipe.category}</Badge>}
          <Badge tone={lineageTone[recipe.lineage] ?? "neutral"}>{recipe.lineage}</Badge>
        </div>
      </Card>
    </Link>
  );
}
