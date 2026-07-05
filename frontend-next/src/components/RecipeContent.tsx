import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { RecipeDetail } from "@/lib/types";

/**
 * The recipe body — everything between the page header and the sidebar.
 * Shared between the real public recipe page and the research workspace's
 * "Preview" mode, so what an admin sees while researching is exactly what
 * guests will see once published (same component, not just similar markup).
 * Every new-schema field is rendered conditionally so recipes without it
 * (anything created before this feature) still render unchanged.
 */
export function RecipeContent({ recipe }: { recipe: RecipeDetail }) {
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
                  <li key={ing.ingredient_id ?? idx}>
                    {ing.amount ?? "?"} {ing.unit} — {ing.name}
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
