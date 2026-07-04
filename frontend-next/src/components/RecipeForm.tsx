"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";
import { useRecipes } from "@/context/RecipesContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeDetail, RecipeUpsertRequest } from "@/lib/types";

interface IngredientRow {
  name: string;
  amount: string;
  unit: string;
}

interface ComponentRow {
  component_name: string;
  ingredients: IngredientRow[];
}

interface StepRow {
  instruction: string;
  component_ref: string;
}

function emptyIngredient(): IngredientRow {
  return { name: "", amount: "", unit: "" };
}

function emptyComponent(): ComponentRow {
  return { component_name: "main", ingredients: [emptyIngredient()] };
}

function emptyStep(): StepRow {
  return { instruction: "", component_ref: "" };
}

function toFormState(recipe: RecipeDetail | null) {
  if (!recipe) {
    return {
      name: "",
      category: "",
      cuisineTags: "",
      servingsAmount: "",
      servingsUnit: "servings",
      components: [emptyComponent()],
      steps: [emptyStep()],
    };
  }
  return {
    name: recipe.name,
    category: recipe.category ?? "",
    cuisineTags: recipe.cuisine_tags.join(", "),
    servingsAmount: recipe.base_servings.amount != null ? String(recipe.base_servings.amount) : "",
    servingsUnit: recipe.base_servings.unit || "servings",
    components: recipe.components.length
      ? recipe.components.map((c) => ({
          component_name: c.component_name,
          ingredients: c.ingredients.length
            ? c.ingredients.map((i) => ({
                name: i.name,
                amount: i.amount != null ? String(i.amount) : "",
                unit: i.unit ?? "",
              }))
            : [emptyIngredient()],
        }))
      : [emptyComponent()],
    steps: recipe.steps.length
      ? recipe.steps.map((s) => ({ instruction: s.instruction, component_ref: s.component_ref ?? "" }))
      : [emptyStep()],
  };
}

export function RecipeForm({ recipeId, initial }: { recipeId: string | null; initial: RecipeDetail | null }) {
  const router = useRouter();
  const { push } = useToast();
  const { reload } = useRecipes();
  const [form, setForm] = useState(() => toFormState(initial));
  const [saving, setSaving] = useState(false);
  const isEdit = recipeId !== null;

  function updateComponent(idx: number, patch: Partial<ComponentRow>) {
    setForm((f) => ({
      ...f,
      components: f.components.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  }

  function updateIngredient(componentIdx: number, ingredientIdx: number, patch: Partial<IngredientRow>) {
    setForm((f) => ({
      ...f,
      components: f.components.map((c, i) =>
        i === componentIdx
          ? {
              ...c,
              ingredients: c.ingredients.map((ing, j) => (j === ingredientIdx ? { ...ing, ...patch } : ing)),
            }
          : c
      ),
    }));
  }

  function addComponent() {
    setForm((f) => ({ ...f, components: [...f.components, emptyComponent()] }));
  }
  function removeComponent(idx: number) {
    setForm((f) => ({ ...f, components: f.components.filter((_, i) => i !== idx) }));
  }
  function addIngredient(componentIdx: number) {
    setForm((f) => ({
      ...f,
      components: f.components.map((c, i) =>
        i === componentIdx ? { ...c, ingredients: [...c.ingredients, emptyIngredient()] } : c
      ),
    }));
  }
  function removeIngredient(componentIdx: number, ingredientIdx: number) {
    setForm((f) => ({
      ...f,
      components: f.components.map((c, i) =>
        i === componentIdx ? { ...c, ingredients: c.ingredients.filter((_, j) => j !== ingredientIdx) } : c
      ),
    }));
  }

  function updateStep(idx: number, patch: Partial<StepRow>) {
    setForm((f) => ({ ...f, steps: f.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }));
  }
  function addStep() {
    setForm((f) => ({ ...f, steps: [...f.steps, emptyStep()] }));
  }
  function removeStep(idx: number) {
    setForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== idx) }));
  }

  function buildPayload(): RecipeUpsertRequest {
    return {
      name: form.name.trim(),
      category: form.category.trim() || null,
      cuisine_tags: form.cuisineTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      base_servings_amount: form.servingsAmount.trim() ? Number(form.servingsAmount) : null,
      base_servings_unit: form.servingsUnit.trim() || "servings",
      components: form.components
        .filter((c) => c.component_name.trim())
        .map((c) => ({
          component_name: c.component_name.trim(),
          ingredients: c.ingredients
            .filter((i) => i.name.trim())
            .map((i) => ({
              name: i.name.trim(),
              amount: i.amount.trim() ? Number(i.amount) : null,
              unit: i.unit.trim(),
            })),
        })),
      steps: form.steps
        .filter((s) => s.instruction.trim())
        .map((s) => ({
          instruction: s.instruction.trim(),
          component_ref: s.component_ref.trim() || null,
        })),
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      const result = isEdit ? await api.updateRecipe(recipeId, payload) : await api.createRecipe(payload);
      await reload();
      push(isEdit ? "Recipe updated" : "Recipe created", "success");
      router.push(`/recipe?id=${encodeURIComponent(result.recipe_id)}`);
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardBody className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Weeknight Chicken Curry"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Category</label>
              <Input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="main, dessert…"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Serves (amount)</label>
              <Input
                type="number"
                value={form.servingsAmount}
                onChange={(e) => setForm((f) => ({ ...f, servingsAmount: e.target.value }))}
                placeholder="4"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Serving unit</label>
              <Input
                value={form.servingsUnit}
                onChange={(e) => setForm((f) => ({ ...f, servingsUnit: e.target.value }))}
                placeholder="servings"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Cuisine tags</label>
            <Input
              value={form.cuisineTags}
              onChange={(e) => setForm((f) => ({ ...f, cuisineTags: e.target.value }))}
              placeholder="thai, spicy, weeknight (comma separated)"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div className="font-semibold">Components &amp; ingredients</div>
          {form.components.map((component, ci) => (
            <div key={ci} className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={component.component_name}
                  onChange={(e) => updateComponent(ci, { component_name: e.target.value })}
                  placeholder="Component name, e.g. main, sauce, garnish"
                  className="flex-1"
                />
                {form.components.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeComponent(ci)}>
                    Remove
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {component.ingredients.map((ing, ii) => (
                  <div key={ii} className="flex gap-2">
                    <Input
                      value={ing.amount}
                      onChange={(e) => updateIngredient(ci, ii, { amount: e.target.value })}
                      placeholder="Amt"
                      className="w-20"
                      inputMode="decimal"
                    />
                    <Input
                      value={ing.unit}
                      onChange={(e) => updateIngredient(ci, ii, { unit: e.target.value })}
                      placeholder="Unit"
                      className="w-24"
                    />
                    <Input
                      value={ing.name}
                      onChange={(e) => updateIngredient(ci, ii, { name: e.target.value })}
                      placeholder="Ingredient name"
                      className="flex-1"
                    />
                    {component.ingredients.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeIngredient(ci, ii)}
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="secondary" size="sm" onClick={() => addIngredient(ci)}>
                  + Ingredient
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addComponent}>
            + Component
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <div className="font-semibold">Steps</div>
          {form.steps.map((step, si) => (
            <div key={si} className="flex gap-2">
              <span className="mt-2 text-sm text-muted">{si + 1}.</span>
              <Textarea
                value={step.instruction}
                onChange={(e) => updateStep(si, { instruction: e.target.value })}
                placeholder="What to do in this step"
                rows={2}
                className="flex-1"
              />
              {form.steps.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeStep(si)}>
                  ✕
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addStep}>
            + Step
          </Button>
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" loading={saving} disabled={!form.name.trim()}>
          {isEdit ? "Save changes" : "Create recipe"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
