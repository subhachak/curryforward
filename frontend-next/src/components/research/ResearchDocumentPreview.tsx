"use client";

import { ChangeEvent, useRef, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { NutritionCard } from "@/components/NutritionCard";
import { RecipeContent } from "@/components/RecipeContent";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeResearchDetail, ResearchPatchPayload } from "@/lib/types";

interface RefineBoxProps {
  section: string;
  label: string;
  onRefine: (section: string, instruction: string) => Promise<void>;
}

/** A small "Refine with AI" affordance shared by each section card — one-shot
 * instruction in, that section's fields regenerate via the same schema the
 * auto-research crew uses (see backend crew_research.py's refine_section). */
function RefineBox({ section, label, onRefine }: RefineBoxProps) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-brand-hover hover:underline"
      >
        ✨ Refine {label} with AI
      </button>
    );
  }

  async function handleSend() {
    const text = instruction.trim();
    if (!text) return;
    setLoading(true);
    try {
      await onRefine(section, text);
      setInstruction("");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted p-2">
      <Input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={`e.g. "make it shorter", "assume beginners"…`}
        className="text-sm"
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" loading={loading} disabled={!instruction.trim()} onClick={handleSend}>
          Refine
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

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
  image_url: string | null;
}

function emptyIngredient(): IngredientRow {
  return { name: "", amount: "", unit: "g" };
}
function emptyComponent(): ComponentRow {
  return { component_name: "main", ingredients: [emptyIngredient()] };
}
function emptyStep(): StepRow {
  return { instruction: "", component_ref: "", image_url: null };
}

function toComponentRows(recipe: RecipeResearchDetail): ComponentRow[] {
  return recipe.components.length
    ? recipe.components.map((c) => ({
        component_name: c.component_name,
        ingredients: c.ingredients.length
          ? c.ingredients.map((i) => ({
              name: i.name,
              amount: i.amount != null ? String(i.amount) : "",
              unit: i.unit ?? "g",
            }))
          : [emptyIngredient()],
      }))
    : [emptyComponent()];
}

function toStepRows(recipe: RecipeResearchDetail): StepRow[] {
  return recipe.steps.length
    ? recipe.steps.map((s) => ({
        instruction: s.instruction,
        component_ref: s.component_ref ?? "",
        image_url: s.image_url ?? null,
      }))
    : [emptyStep()];
}

function buildComponentsPatch(rows: ComponentRow[]) {
  return rows
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
    }));
}

function buildStepsPatch(rows: StepRow[]) {
  return rows
    .filter((s) => s.instruction.trim())
    .map((s) => ({
      instruction: s.instruction.trim(),
      component_ref: s.component_ref.trim() || null,
      image_url: s.image_url || null,
    }));
}

interface ResearchDocumentPreviewProps {
  recipe: RecipeResearchDetail;
  previewMode: boolean;
  onCommit: (patch: ResearchPatchPayload) => void;
  onRefine: (section: string, instruction: string) => Promise<void>;
}

export function ResearchDocumentPreview({ recipe, previewMode, onCommit, onRefine }: ResearchDocumentPreviewProps) {
  const { push } = useToast();

  const [name, setName] = useState(recipe.name);
  const [category, setCategory] = useState(recipe.category ?? "");
  const [cuisineTags, setCuisineTags] = useState(recipe.cuisine_tags.join(", "));
  const [servingsAmount, setServingsAmount] = useState(
    recipe.base_servings.amount != null ? String(recipe.base_servings.amount) : ""
  );
  const [servingsUnit, setServingsUnit] = useState(recipe.base_servings.unit || "servings");
  const [servingSizeAmount, setServingSizeAmount] = useState(
    recipe.serving_size.amount != null ? String(recipe.serving_size.amount) : ""
  );
  const [servingSizeUnit, setServingSizeUnit] = useState(recipe.serving_size.unit ?? "");
  const [intro, setIntro] = useState(recipe.intro ?? "");
  const [history, setHistory] = useState(recipe.history ?? "");
  const [prepTime, setPrepTime] = useState(recipe.prep_time_minutes != null ? String(recipe.prep_time_minutes) : "");
  const [cookTime, setCookTime] = useState(recipe.cook_time_minutes != null ? String(recipe.cook_time_minutes) : "");
  const [tipsText, setTipsText] = useState(recipe.tips.join("\n"));
  const [watchOutsText, setWatchOutsText] = useState(recipe.watch_outs.join("\n"));
  const [components, setComponents] = useState<ComponentRow[]>(() => toComponentRows(recipe));
  const [steps, setSteps] = useState<StepRow[]>(() => toStepRows(recipe));
  const [heroImageUrl, setHeroImageUrl] = useState(recipe.hero_image_url);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadingStep, setUploadingStep] = useState<number | null>(null);
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const heroFileInputRef = useRef<HTMLInputElement | null>(null);

  if (previewMode) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <RecipeContent recipe={recipe} />
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <NutritionCard recipe={recipe} />
        </aside>
      </div>
    );
  }

  function updateComponent(idx: number, patch: Partial<ComponentRow>) {
    setComponents((rows) => rows.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function updateIngredient(ci: number, ii: number, patch: Partial<IngredientRow>) {
    setComponents((rows) =>
      rows.map((c, i) =>
        i === ci ? { ...c, ingredients: c.ingredients.map((ing, j) => (j === ii ? { ...ing, ...patch } : ing)) } : c
      )
    );
  }
  function commitComponents(rows: ComponentRow[]) {
    onCommit({ components: buildComponentsPatch(rows) });
  }
  function addComponent() {
    setComponents((rows) => {
      const next = [...rows, emptyComponent()];
      commitComponents(next);
      return next;
    });
  }
  function removeComponent(idx: number) {
    setComponents((rows) => {
      const next = rows.filter((_, i) => i !== idx);
      commitComponents(next);
      return next;
    });
  }
  function addIngredient(ci: number) {
    setComponents((rows) => {
      const next = rows.map((c, i) => (i === ci ? { ...c, ingredients: [...c.ingredients, emptyIngredient()] } : c));
      commitComponents(next);
      return next;
    });
  }
  function removeIngredient(ci: number, ii: number) {
    setComponents((rows) => {
      const next = rows.map((c, i) =>
        i === ci ? { ...c, ingredients: c.ingredients.filter((_, j) => j !== ii) } : c
      );
      commitComponents(next);
      return next;
    });
  }

  function updateStep(idx: number, patch: Partial<StepRow>) {
    setSteps((rows) => rows.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function commitSteps(rows: StepRow[]) {
    onCommit({ steps: buildStepsPatch(rows) });
  }
  function addStep() {
    setSteps((rows) => {
      const next = [...rows, emptyStep()];
      commitSteps(next);
      return next;
    });
  }
  function removeStep(idx: number) {
    setSteps((rows) => {
      const next = rows.filter((_, i) => i !== idx);
      commitSteps(next);
      return next;
    });
  }

  async function handleHeroImageSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingHero(true);
    try {
      const { url } = await api.uploadImage(file);
      setHeroImageUrl(url);
      onCommit({ hero_image_url: url });
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Image upload failed", "error");
    } finally {
      setUploadingHero(false);
    }
  }

  function handleHeroImageRemove() {
    setHeroImageUrl(null);
    onCommit({ hero_image_url: null });
  }

  async function handleImageSelected(idx: number, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingStep(idx);
    try {
      const { url } = await api.uploadImage(file);
      setSteps((rows) => {
        const next = rows.map((s, i) => (i === idx ? { ...s, image_url: url } : s));
        commitSteps(next);
        return next;
      });
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Image upload failed", "error");
    } finally {
      setUploadingStep(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => onCommit({ name: name.trim() })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Hero image</label>
            <div className="flex items-center gap-3">
              {heroImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroImageUrl}
                  alt=""
                  className="h-20 w-32 rounded-md border border-border object-cover"
                />
              ) : (
                <div className="flex h-20 w-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted">
                  No image
                </div>
              )}
              <input
                ref={heroFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleHeroImageSelected}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={uploadingHero}
                onClick={() => heroFileInputRef.current?.click()}
              >
                {heroImageUrl ? "Replace" : "Upload"}
              </Button>
              {heroImageUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={handleHeroImageRemove}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Category</label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onBlur={() => onCommit({ category: category.trim() || null })}
                placeholder="main, dessert…"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Serves (amount)</label>
              <Input
                type="number"
                value={servingsAmount}
                onChange={(e) => setServingsAmount(e.target.value)}
                onBlur={() =>
                  onCommit({ base_servings_amount: servingsAmount.trim() ? Number(servingsAmount) : null })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Serving unit</label>
              <Input
                value={servingsUnit}
                onChange={(e) => setServingsUnit(e.target.value)}
                onBlur={() => onCommit({ base_servings_unit: servingsUnit.trim() || "servings" })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Serving size amount</label>
              <Input
                type="number"
                value={servingSizeAmount}
                onChange={(e) => setServingSizeAmount(e.target.value)}
                onBlur={() =>
                  onCommit({ serving_size_amount: servingSizeAmount.trim() ? Number(servingSizeAmount) : null })
                }
                placeholder="1"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Serving size unit</label>
              <Input
                value={servingSizeUnit}
                onChange={(e) => setServingSizeUnit(e.target.value)}
                onBlur={() => onCommit({ serving_size_unit: servingSizeUnit.trim() || null })}
                placeholder="bowl, piece, cup, 250 g"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Cuisine tags</label>
            <Input
              value={cuisineTags}
              onChange={(e) => setCuisineTags(e.target.value)}
              onBlur={() =>
                onCommit({
                  cuisine_tags: cuisineTags.split(",").map((t) => t.trim()).filter(Boolean),
                })
              }
              placeholder="thai, spicy, weeknight (comma separated)"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Prep time (minutes)</label>
              <Input
                type="number"
                value={prepTime}
                onChange={(e) => setPrepTime(e.target.value)}
                onBlur={() => onCommit({ prep_time_minutes: prepTime.trim() ? Number(prepTime) : null })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Cook / bake time (minutes)</label>
              <Input
                type="number"
                value={cookTime}
                onChange={(e) => setCookTime(e.target.value)}
                onBlur={() => onCommit({ cook_time_minutes: cookTime.trim() ? Number(cookTime) : null })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Intro</label>
            <Textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              onBlur={() => onCommit({ intro: intro.trim() || null })}
              rows={2}
              placeholder="A short, appetizing description of the dish"
            />
          </div>
          <div className="space-y-2">
            <label className="mb-1 block text-sm font-medium">History &amp; facts</label>
            <Textarea
              value={history}
              onChange={(e) => setHistory(e.target.value)}
              onBlur={() => onCommit({ history: history.trim() || null })}
              rows={4}
              placeholder="Where this dish comes from, traditions, why it matters"
            />
            <RefineBox section="history" label="intro & history" onRefine={onRefine} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Components &amp; ingredients</div>
            <RefineBox section="ingredients" label="ingredients" onRefine={onRefine} />
          </div>
          {components.map((component, ci) => (
            <div key={ci} className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={component.component_name}
                  onChange={(e) => updateComponent(ci, { component_name: e.target.value })}
                  onBlur={() => commitComponents(components)}
                  placeholder="Component name, e.g. main, sauce, garnish"
                  className="flex-1"
                />
                {components.length > 1 && (
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
                      onBlur={() => commitComponents(components)}
                      placeholder="Amt"
                      className="w-20"
                      inputMode="decimal"
                    />
                    <Input
                      value={ing.unit}
                      onChange={(e) => updateIngredient(ci, ii, { unit: e.target.value })}
                      onBlur={() => commitComponents(components)}
                      placeholder="g"
                      className="w-20"
                    />
                    <Input
                      value={ing.name}
                      onChange={(e) => updateIngredient(ci, ii, { name: e.target.value })}
                      onBlur={() => commitComponents(components)}
                      placeholder="Ingredient name"
                      className="flex-1"
                    />
                    {component.ingredients.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeIngredient(ci, ii)}>
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
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Steps</div>
            <RefineBox section="steps" label="steps" onRefine={onRefine} />
          </div>
          {steps.map((step, si) => (
            <div key={si} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <span className="mt-2 text-sm text-muted">{si + 1}.</span>
                <Textarea
                  value={step.instruction}
                  onChange={(e) => updateStep(si, { instruction: e.target.value })}
                  onBlur={() => commitSteps(steps)}
                  placeholder="What to do in this step"
                  rows={2}
                  className="flex-1"
                />
                {steps.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeStep(si)}>
                    ✕
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3 pl-6">
                {step.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={step.image_url} alt="" className="h-16 w-16 rounded-md border border-border object-cover" />
                ) : null}
                <input
                  ref={(el) => {
                    fileInputRefs.current[si] = el;
                  }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => handleImageSelected(si, e)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={uploadingStep === si}
                  onClick={() => fileInputRefs.current[si]?.click()}
                >
                  {step.image_url ? "Replace image" : "+ Image"}
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addStep}>
            + Step
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Tips &amp; tricks (one per line)</label>
            <Textarea
              value={tipsText}
              onChange={(e) => setTipsText(e.target.value)}
              onBlur={() =>
                onCommit({ tips: tipsText.split("\n").map((t) => t.trim()).filter(Boolean) })
              }
              rows={3}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Things to watch out for (one per line)</label>
            <Textarea
              value={watchOutsText}
              onChange={(e) => setWatchOutsText(e.target.value)}
              onBlur={() =>
                onCommit({ watch_outs: watchOutsText.split("\n").map((t) => t.trim()).filter(Boolean) })
              }
              rows={3}
            />
          </div>
          <RefineBox section="tips" label="tips & watch-outs" onRefine={onRefine} />
        </CardBody>
      </Card>
    </div>
  );
}
