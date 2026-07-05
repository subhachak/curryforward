import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { RecipeSummary } from "@/lib/types";
import { lineageLabel } from "@/lib/lineage";

const lineageTone: Record<string, "brand" | "success" | "warning"> = {
  edit: "brand",
  fork: "warning",
  generated: "success",
  user_customized: "brand",
};

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const lineage = lineageLabel(recipe.lineage);

  return (
    <Link href={`/recipe?id=${encodeURIComponent(recipe.recipe_id)}`}>
      <Card className="h-full overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-md">
        {recipe.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={recipe.hero_image_url} alt="" className="h-32 w-full object-cover" />
        ) : (
          <div
            className="flex h-32 w-full items-center justify-center bg-gradient-to-br from-brand-soft to-accent-soft text-3xl"
            aria-hidden
          >
            🍛
          </div>
        )}
        <div className="p-4">
          <div className="font-semibold">{recipe.name}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {recipe.category && <Badge tone="neutral">{recipe.category}</Badge>}
            {recipe.cuisine_tags.slice(0, 2).map((tag) => (
              <Badge key={tag} tone="accent">
                {tag}
              </Badge>
            ))}
            {lineage && <Badge tone={lineageTone[recipe.lineage] ?? "brand"}>{lineage}</Badge>}
          </div>
        </div>
      </Card>
    </Link>
  );
}
