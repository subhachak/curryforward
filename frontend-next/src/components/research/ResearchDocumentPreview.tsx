"use client";

import { ChangeEvent, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, PlusIcon, RefreshIcon, SparklesIcon, UploadIcon, XIcon } from "@/components/ui/icons";
import { NutritionCard } from "@/components/NutritionCard";
import { RecipeContent } from "@/components/RecipeContent";
import { CopyAssistField } from "@/components/research/CopyAssistField";
import { useRecipes } from "@/context/RecipesContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { PanConversion, RecipeResearchDetail, ResearchPatchPayload } from "@/lib/types";

// Recognized by backend/app/nutrition.py's UNIT_TO_GRAM — picking one of
// these lets the nutrition calculation actually match the ingredient,
// but the field stays a free-text input (with these as datalist suggestions)
// since plenty of real ingredient units fall outside this set (e.g. "pods",
// "pinch", "leaf") and forcing a closed dropdown would block entering them.
const INGREDIENT_UNIT_SUGGESTIONS = ["g", "ml", "cup", "tbsp", "tsp", "oz", "lb", "piece", "drop", "inch"];
const SERVING_UNIT_SUGGESTIONS = ["servings", "people", "portions"];
const SERVING_SIZE_UNIT_SUGGESTIONS = ["bowl", "piece", "cup", "g", "ml"];

interface RefineBoxProps {
  section: string;
  label: string;
  onRefine: (section: string, instruction: string) => Promise<void>;
}

function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2">
      <div className="font-semibold">{title}</div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** A small "Refine with AI" affordance shared by each section card — one-shot
 * instruction in, that section's fields regenerate via the same schema the
 * auto-research crew uses (see backend crew_research.py's refine_section). */
function RefineBox({ section, label, onRefine }: RefineBoxProps) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);

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
    <div className="relative">
      <IconButton label={`Refine ${label} with AI`} icon={<SparklesIcon />} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="absolute right-0 top-10 z-20 w-[min(20rem,calc(100vw-3rem))] space-y-2 rounded-md border border-border bg-surface p-3 shadow-lg">
          <Input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={`e.g. "make it shorter", "assume beginners"...`}
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <IconButton label={`Apply refinement to ${label}`} icon={<CheckIcon />} loading={loading} disabled={!instruction.trim()} onClick={handleSend} />
            <IconButton label="Cancel refinement" icon={<XIcon />} variant="ghost" onClick={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

interface IngredientRow {
  name: string;
  amount: string;
  displayUnit: string;
  unitOptionsText: string;
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
  return { name: "", amount: "", displayUnit: "g", unitOptionsText: "" };
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
              amount: canonicalGramValue(i) != null ? String(canonicalGramValue(i)) : "",
              displayUnit: i.display_unit ?? (i.unit && i.unit.toLowerCase() !== "g" ? i.unit : "g"),
              unitOptionsText: formatUnitOptions(i.unit_options || []),
            }))
          : [emptyIngredient()],
      }))
    : [emptyComponent()];
}

function canonicalGramValue(ingredient: RecipeResearchDetail["components"][number]["ingredients"][number]) {
  if (ingredient.gram_amount != null) return ingredient.gram_amount;
  if (ingredient.gram_equivalent != null) return ingredient.gram_equivalent;
  if ((ingredient.unit || "").toLowerCase() === "g") return ingredient.amount;
  return null;
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
          unit: "g",
          gram_amount: i.amount.trim() ? Number(i.amount) : null,
          gram_equivalent: i.amount.trim() ? Number(i.amount) : null,
          display_unit: i.displayUnit.trim() || "g",
          unit_options: parseUnitOptions(i.unitOptionsText),
        })),
    }));
}

function parseUnitOptions(text: string) {
  return text
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([\d.]+)\s+(.+)$/);
      return {
        amount: match ? Number(match[1]) : null,
        unit: match ? match[2].trim() : item,
        label: item,
      };
    });
}

function formatUnitOptions(options: { amount: number | null; unit: string; label?: string | null }[]) {
  return options
    .map((option) => option.label || [option.amount, option.unit].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
}

function parseLines(text: string) {
  return text.split("\n").map((item) => item.trim()).filter(Boolean);
}

function parsePanConversions(text: string): PanConversion[] {
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((line) => {
      const [conversion, note] = line.split("|").map((part) => part.trim());
      const [from, to] = conversion.split("=").map((part) => part.trim());
      const fromSide = parsePanSide(from);
      const toSide = parsePanSide(to);
      return {
        from_count: fromSide.count,
        from_size: fromSide.size,
        to_count: toSide.count,
        to_size: toSide.size,
        note: note || null,
      };
    });
}

function parsePanSide(text: string | undefined) {
  const match = (text || "").match(/^([\d.]+)\s*x\s*(.+)$/i);
  return {
    count: match ? Number(match[1]) : null,
    size: match ? match[2].trim() : text || "",
  };
}

function formatPanConversions(rows: PanConversion[]) {
  return rows
    .map((row) => {
      const conversion = `${row.from_count ?? ""} x ${row.from_size} = ${row.to_count ?? ""} x ${row.to_size}`;
      return row.note ? `${conversion} | ${row.note}` : conversion;
    })
    .join("\n");
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
  onRefreshNutrition?: () => Promise<void>;
  refreshingNutrition?: boolean;
  highlightedFields?: string[];
  onClearHighlights?: () => void;
}

export function ResearchDocumentPreview({
  recipe,
  previewMode,
  onCommit,
  onRefine,
  onRefreshNutrition,
  refreshingNutrition = false,
  highlightedFields = [],
  onClearHighlights,
}: ResearchDocumentPreviewProps) {
  const { push } = useToast();
  const { categories } = useRecipes();
  const highlightSet = new Set(highlightedFields);
  const isHighlighted = (fields: string[]) => fields.some((field) => highlightSet.has(field));
  const highlightClass = (fields: string[]) => (isHighlighted(fields) ? "border-brand/60 bg-brand-soft/25" : "");
  const reviewBadge = (fields: string[]) =>
    isHighlighted(fields) ? <span className="text-xs font-medium text-accent-hover">Updated by AI</span> : null;

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
  const [utensilsText, setUtensilsText] = useState((recipe.suggested_utensils || []).join("\n"));
  const [panConversionsText, setPanConversionsText] = useState(formatPanConversions(recipe.pan_conversions || []));
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
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-ink">Nutrition</div>
              {onRefreshNutrition && (
                <IconButton
                  label="Refresh nutrition facts"
                  icon={<RefreshIcon />}
                  loading={refreshingNutrition}
                  onClick={() => void onRefreshNutrition()}
                />
              )}
            </div>
            <NutritionCard recipe={recipe} />
          </div>
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
  function applyStepInstruction(idx: number, value: string) {
    setSteps((rows) => {
      const next = rows.map((s, i) => (i === idx ? { ...s, instruction: value } : s));
      commitSteps(next);
      return next;
    });
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
      <Card className={highlightClass([
        "name",
        "category",
        "cuisine_tags",
        "base_servings_amount",
        "base_servings_unit",
        "serving_size_amount",
        "serving_size_unit",
        "intro",
        "history",
        "prep_time_minutes",
        "cook_time_minutes",
      ])}>
        <CardBody className="space-y-4">
          <SectionHeader title="Recipe details">
            {reviewBadge([
              "name",
              "category",
              "cuisine_tags",
              "base_servings_amount",
              "base_servings_unit",
              "serving_size_amount",
              "serving_size_unit",
              "intro",
              "history",
              "prep_time_minutes",
              "cook_time_minutes",
            ])}
            <RefineBox section="history" label="intro & history" onRefine={onRefine} />
          </SectionHeader>
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
              <IconButton
                label={heroImageUrl ? "Replace hero image" : "Upload hero image"}
                icon={<UploadIcon />}
                loading={uploadingHero}
                onClick={() => heroFileInputRef.current?.click()}
              />
              {heroImageUrl && (
                <IconButton label="Remove hero image" icon={<XIcon />} variant="ghost" onClick={handleHeroImageRemove} />
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
                list="category-options"
              />
              <datalist id="category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
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
                list="serving-unit-options"
              />
              <datalist id="serving-unit-options">
                {SERVING_UNIT_SUGGESTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
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
                list="serving-size-unit-options"
              />
              <datalist id="serving-size-unit-options">
                {SERVING_SIZE_UNIT_SUGGESTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
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
            <CopyAssistField
              recipeId={recipe.recipe_id}
              fieldLabel="recipe intro"
              value={intro}
              onChange={setIntro}
              onBlur={() => onCommit({ intro: intro.trim() || null })}
              onApply={(next) => onCommit({ intro: next.trim() || null })}
              rows={2}
              multiline
              placeholder="A short, appetizing description of the dish"
            />
          </div>
          <div className="space-y-2">
            <label className="mb-1 block text-sm font-medium">History &amp; facts</label>
            <CopyAssistField
              recipeId={recipe.recipe_id}
              fieldLabel="history and facts"
              value={history}
              onChange={setHistory}
              onBlur={() => onCommit({ history: history.trim() || null })}
              onApply={(next) => onCommit({ history: next.trim() || null })}
              rows={4}
              multiline
              placeholder="Where this dish comes from, traditions, why it matters"
            />
          </div>
        </CardBody>
      </Card>

      <Card className={highlightClass(["components"])}>
        <CardBody className="space-y-4">
          <SectionHeader title="Components & ingredients">{reviewBadge(["components"])}</SectionHeader>
          <datalist id="ingredient-unit-options">
            {INGREDIENT_UNIT_SUGGESTIONS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          {components.map((component, ci) => (
            <div key={ci} className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    value={component.component_name}
                    onChange={(e) => updateComponent(ci, { component_name: e.target.value })}
                    onBlur={() => commitComponents(components)}
                    placeholder="Component name, e.g. main, sauce, garnish"
                  />
                </div>
                {components.length > 1 && (
                  <IconButton label="Remove component" icon={<XIcon />} variant="ghost" onClick={() => removeComponent(ci)} />
                )}
              </div>
              <div className="space-y-2">
                {component.ingredients.map((ing, ii) => (
                  <div key={ii} className="space-y-2 rounded-md bg-surface-muted p-2">
                    <div className="flex gap-2">
                      <div className="w-24 shrink-0">
                        <Input
                          value={ing.amount}
                          onChange={(e) => updateIngredient(ci, ii, { amount: e.target.value })}
                          onBlur={() => commitComponents(components)}
                          placeholder="Grams"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="w-20 shrink-0">
                        <Input
                          value={ing.displayUnit}
                          onChange={(e) => updateIngredient(ci, ii, { displayUnit: e.target.value })}
                          onBlur={() => commitComponents(components)}
                          placeholder="Display"
                          list="ingredient-unit-options"
                        />
                      </div>
                      <div className="flex-1">
                        <Input
                          value={ing.name}
                          onChange={(e) => updateIngredient(ci, ii, { name: e.target.value })}
                          onBlur={() => commitComponents(components)}
                          placeholder="Ingredient name"
                        />
                      </div>
                      {component.ingredients.length > 1 && (
                        <IconButton label="Remove ingredient" icon={<XIcon />} variant="ghost" onClick={() => removeIngredient(ci, ii)} />
                      )}
                    </div>
                    <Input
                      value={ing.unitOptionsText}
                      onChange={(e) => updateIngredient(ci, ii, { unitOptionsText: e.target.value })}
                      onBlur={() => commitComponents(components)}
                      placeholder="Display conversions, e.g. 1 cup; 240 ml. Grams remain canonical."
                      className="text-xs"
                    />
                  </div>
                ))}
                <IconButton label="Add ingredient" icon={<PlusIcon />} onClick={() => addIngredient(ci)} />
              </div>
            </div>
          ))}
          <IconButton label="Add component" icon={<PlusIcon />} onClick={addComponent} />
        </CardBody>
      </Card>

      <Card className={highlightClass(["steps"])}>
        <CardBody className="space-y-3">
          <SectionHeader title="Steps">
            {reviewBadge(["steps"])}
            <RefineBox section="steps" label="steps" onRefine={onRefine} />
          </SectionHeader>
          {steps.map((step, si) => (
            <div key={si} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <span className="mt-2 text-sm text-muted">{si + 1}.</span>
                <CopyAssistField
                  recipeId={recipe.recipe_id}
                  fieldLabel={`step ${si + 1} instruction`}
                  value={step.instruction}
                  onChange={(value) => updateStep(si, { instruction: value })}
                  onBlur={() => commitSteps(steps)}
                  onApply={(value) => applyStepInstruction(si, value)}
                  placeholder="What to do in this step"
                  rows={2}
                  multiline
                  className="flex-1"
                />
                {steps.length > 1 && (
                  <IconButton label="Remove step" icon={<XIcon />} variant="ghost" onClick={() => removeStep(si)} />
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
                <IconButton
                  label={step.image_url ? "Replace step image" : "Add step image"}
                  icon={<UploadIcon />}
                  loading={uploadingStep === si}
                  onClick={() => fileInputRefs.current[si]?.click()}
                />
              </div>
            </div>
          ))}
          <IconButton label="Add step" icon={<PlusIcon />} onClick={addStep} />
        </CardBody>
      </Card>

      <Card className={highlightClass(["tips", "watch_outs", "suggested_utensils", "pan_conversions"])}>
        <CardBody className="space-y-4">
          <SectionHeader title="Tips & watch-outs">
            {reviewBadge(["tips", "watch_outs", "suggested_utensils", "pan_conversions"])}
            {highlightedFields.length > 0 && onClearHighlights && (
              <IconButton label="Mark AI changes reviewed" icon={<CheckIcon />} onClick={onClearHighlights} />
            )}
            <RefineBox section="tips" label="tips & watch-outs" onRefine={onRefine} />
          </SectionHeader>
          <div>
            <label className="mb-1 block text-sm font-medium">Tips &amp; tricks (one per line)</label>
            <CopyAssistField
              recipeId={recipe.recipe_id}
              fieldLabel="tips and tricks"
              value={tipsText}
              onChange={setTipsText}
              onBlur={() =>
                onCommit({ tips: tipsText.split("\n").map((t) => t.trim()).filter(Boolean) })
              }
              onApply={(next) => onCommit({ tips: next.split("\n").map((t) => t.trim()).filter(Boolean) })}
              rows={3}
              multiline
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Things to watch out for (one per line)</label>
            <CopyAssistField
              recipeId={recipe.recipe_id}
              fieldLabel="things to watch out for"
              value={watchOutsText}
              onChange={setWatchOutsText}
              onBlur={() =>
                onCommit({ watch_outs: watchOutsText.split("\n").map((t) => t.trim()).filter(Boolean) })
              }
              onApply={(next) => onCommit({ watch_outs: next.split("\n").map((t) => t.trim()).filter(Boolean) })}
              rows={3}
              multiline
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Suggested utensils (one per line)</label>
            <CopyAssistField
              recipeId={recipe.recipe_id}
              fieldLabel="suggested cooking utensils"
              value={utensilsText}
              onChange={setUtensilsText}
              onBlur={() => onCommit({ suggested_utensils: parseLines(utensilsText) })}
              onApply={(next) => onCommit({ suggested_utensils: parseLines(next) })}
              rows={3}
              multiline
              placeholder={"Heavy-bottomed pan\nRimmed baking sheet\nInstant-read thermometer"}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Baking pan conversions</label>
            <CopyAssistField
              recipeId={recipe.recipe_id}
              fieldLabel="baking pan conversions"
              value={panConversionsText}
              onChange={setPanConversionsText}
              onBlur={() => onCommit({ pan_conversions: parsePanConversions(panConversionsText) })}
              onApply={(next) => onCommit({ pan_conversions: parsePanConversions(next) })}
              rows={3}
              multiline
              placeholder="1 x 9-inch round = 2 x 6-inch round | reduce bake time slightly"
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
