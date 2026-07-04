"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function GenerateRecipePanel() {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const router = useRouter();
  const [dishName, setDishName] = useState("");
  const [cuisineStyle, setCuisineStyle] = useState("");
  const [dietary, setDietary] = useState("");
  const [flavorProfile, setFlavorProfile] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dishName.trim()) return;
    setLoading(true);
    try {
      const result = await api.generateRecipe({
        dish_name: dishName.trim(),
        cuisine_style: cuisineStyle.trim() || undefined,
        dietary: splitTags(dietary),
        flavor_profile: splitTags(flavorProfile),
      });
      if (result.persisted) {
        router.push(`/recipe?id=${encodeURIComponent(result.recipe_id)}`);
      } else {
        push(result.note || "Generated a preview — not saved (guest mode).", "info");
        sessionStorage.setItem("guest_generated_preview", JSON.stringify(result));
        router.push(`/recipe?preview=1`);
      }
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Recipe generation failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-3">
          <div className="font-semibold">Don&apos;t see what you want?</div>
          <p className="text-sm text-muted">
            Generate a new base recipe with web-search-informed AI.
            {!isAdmin && " Guest previews aren't saved — log in as admin to persist them."}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Dish name, e.g. Thai Green Curry"
            value={dishName}
            onChange={(e) => setDishName(e.target.value)}
            className="sm:col-span-2"
            required
          />
          <Input
            placeholder="Cuisine style (optional)"
            value={cuisineStyle}
            onChange={(e) => setCuisineStyle(e.target.value)}
          />
          <Input
            placeholder="Dietary needs, comma separated (optional)"
            value={dietary}
            onChange={(e) => setDietary(e.target.value)}
          />
          <Input
            placeholder="Flavor profile, comma separated (optional)"
            value={flavorProfile}
            onChange={(e) => setFlavorProfile(e.target.value)}
            className="sm:col-span-2"
          />
          <Button type="submit" loading={loading} disabled={!dishName.trim()} className="sm:col-span-2">
            Generate
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
