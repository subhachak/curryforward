import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { HeartIcon } from "@/components/ui/icons";
import type { RecipeSummary } from "@/lib/types";
import { lineageLabel } from "@/lib/lineage";
import { publicRecipeHref } from "@/lib/recipeLinks";

const lineageTone: Record<string, "brand" | "success" | "warning"> = {
  edit: "brand",
  fork: "warning",
  generated: "success",
  user_customized: "brand",
};

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const lineage = lineageLabel(recipe.lineage);

  return (
    <Link href={publicRecipeHref(recipe)}>
      <Card className="h-full overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-md">
        {recipe.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={recipe.hero_image_url} alt="" className="h-32 w-full object-cover" />
        ) : (
          <div
            className="flex h-32 w-full items-center justify-center bg-gradient-to-br from-brand-soft to-accent-soft"
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark-cloche-forward.svg" alt="" className="h-14 w-auto opacity-80" />
          </div>
        )}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold">{recipe.name}</div>
            <div className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <HeartIcon className="h-3.5 w-3.5" fill={recipe.like_count > 0 ? "currentColor" : "none"} />
              <span>{recipe.like_count}</span>
            </div>
          </div>
          {recipe.intro && <p className="mt-1 line-clamp-2 text-sm text-muted">{recipe.intro}</p>}
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
