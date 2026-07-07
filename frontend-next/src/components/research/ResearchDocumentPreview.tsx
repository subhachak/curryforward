"use client";

import { useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, PlusIcon, RefreshIcon, SparklesIcon, XIcon } from "@/components/ui/icons";
import { NutritionCard } from "@/components/NutritionCard";
import { RecipeContent } from "@/components/RecipeContent";
import { CopyAssistField } from "@/components/research/CopyAssistField";
import { useRecipes } from "@/context/RecipesContext";
import { smartUnitChoices } from "@/lib/ingredientUnits";
import { estimatedYieldGramsFromComponents } from "@/lib/recipeNutrition";
import type { Ingredient, PanConversion, RecipeResearchDetail, ResearchPatchPayload } from "@/lib/types";

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

function DragHandle({
  label,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      aria-label={label}
      title={label}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="inline-flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md border border-border bg-surface text-sm font-bold leading-none text-muted transition-colors hover:bg-surface-muted hover:text-foreground active:cursor-grabbing"
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>
  );
}

function normalizeIssueName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function nutritionIssueLabel(reason: string) {
  if (reason === "missing_grams") return "Needs grams";
  if (reason === "no_nutrition_profile") return "No profile match";
  return "Needs review";
}

function IngredientNutritionIssue({
  issue,
}: {
  issue?: { ingredient: string; reason: string; suggestion: string };
}) {
  if (!issue) return null;

  return (
    <div className="rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-warning">{nutritionIssueLabel(issue.reason)}</span>
        <span className="text-muted">Not included in the current nutrition calculation.</span>
      </div>
      <div className="mt-1 text-muted">{issue.suggestion}</div>
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
type DragState =
  | { type: "component"; from: number }
  | { type: "ingredient"; componentIndex: number; from: number }
  | { type: "step"; from: number }
  | null;

function emptyIngredient(): IngredientRow {
  return { name: "", amount: "", displayUnit: "g", unitOptionsText: "" };
}
function emptyComponent(): ComponentRow {
  return { component_name: "main", ingredients: [emptyIngredient()] };
}
function emptyStep(): StepRow {
  return { instruction: "", component_ref: "", image_url: null };
}

function reorderRows<T>(rows: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) {
    return rows;
  }
  const next = [...rows];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
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

function estimateYieldGramsFromRows(rows: ComponentRow[]) {
  let total = 0;
  let hasValue = false;
  for (const component of rows) {
    for (const ingredient of component.ingredients) {
      const amount = Number(ingredient.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      total += amount;
      hasValue = true;
    }
  }
  return hasValue ? Math.round(total * 10) / 10 : null;
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
    .filter((c) => c.component_name.trim() || c.ingredients.some((ingredient) => ingredient.name.trim()))
    .map((c) => ({
      component_name: c.component_name.trim() || "main",
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

function displayUnitChoices(row: IngredientRow) {
  const grams = Number(row.amount);
  const syntheticIngredient: Ingredient = {
    name: row.name,
    amount: Number.isFinite(grams) && grams > 0 ? grams : null,
    unit: "g",
    gram_amount: Number.isFinite(grams) && grams > 0 ? grams : null,
    gram_equivalent: Number.isFinite(grams) && grams > 0 ? grams : null,
    display_unit: row.displayUnit,
    unit_options: parseUnitOptions(row.unitOptionsText),
  };
  const units = smartUnitChoices(syntheticIngredient).map((option) => option.unit);
  if (row.displayUnit && !units.some((unit) => unit.toLowerCase() === row.displayUnit.toLowerCase())) {
    units.push(row.displayUnit);
  }
  return units;
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
  const { categories } = useRecipes();
  const highlightSet = new Set(highlightedFields);
  const isHighlighted = (fields: string[]) => fields.some((field) => highlightSet.has(field));
  const highlightClass = (fields: string[]) => (isHighlighted(fields) ? "border-brand/60 bg-brand-soft/25" : "");
  const reviewBadge = (fields: string[]) =>
    isHighlighted(fields) ? <span className="text-xs font-medium text-accent-hover">Updated by AI</span> : null;

  const [name, setName] = useState(recipe.name);
  const [category, setCategory] = useState(recipe.category ?? "");
  const [cuisineTags, setCuisineTags] = useState(recipe.cuisine_tags.join(", "));
  const [servingSizeAmount, setServingSizeAmount] = useState(
    recipe.serving_size.amount != null ? String(recipe.serving_size.amount) : ""
  );
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
  const [dragging, setDragging] = useState<DragState>(null);
  const [heroImageUrl, setHeroImageUrl] = useState(recipe.hero_image_url);
  const nutritionIssues = recipe.nutrition?.nutrition_issues || [];
  const nutritionIssueForIngredient = (ingredientName: string) =>
    nutritionIssues.find((issue) => normalizeIssueName(issue.ingredient) === normalizeIssueName(ingredientName));
  const estimatedYieldGrams =
    recipe.nutrition?.estimated_total_yield_g ??
    estimateYieldGramsFromRows(components) ??
    estimatedYieldGramsFromComponents(recipe.components);

  if (previewMode) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          <Card className="border-[#FFD2AE] bg-[#FFF8F1]">
            <CardBody>
              <h1 className="text-3xl font-bold leading-tight text-[#2E1B14]">{recipe.name}</h1>
              {recipe.intro && <p className="mt-3 max-w-2xl text-lg text-[#5A4038]">{recipe.intro}</p>}
            </CardBody>
          </Card>
          <RecipeContent recipe={recipe} />
        </div>
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

  function startDrag(event: DragEvent<HTMLButtonElement>, state: NonNullable<DragState>) {
    setDragging(state);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${state.type}:${"from" in state ? state.from : ""}`);
  }
  function allowDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
  function dropComponent(event: DragEvent<HTMLElement>, toIndex: number) {
    event.preventDefault();
    if (!dragging || dragging.type !== "component") return;
    setComponents((rows) => {
      const next = reorderRows(rows, dragging.from, toIndex);
      commitComponents(next);
      return next;
    });
    setDragging(null);
  }
  function dropIngredient(event: DragEvent<HTMLElement>, componentIndex: number, toIndex: number) {
    event.preventDefault();
    if (!dragging || dragging.type !== "ingredient" || dragging.componentIndex !== componentIndex) return;
    setComponents((rows) => {
      const next = rows.map((component, idx) =>
        idx === componentIndex
          ? { ...component, ingredients: reorderRows(component.ingredients, dragging.from, toIndex) }
          : component
      );
      commitComponents(next);
      return next;
    });
    setDragging(null);
  }
  function dropStep(event: DragEvent<HTMLElement>, toIndex: number) {
    event.preventDefault();
    if (!dragging || dragging.type !== "step") return;
    setSteps((rows) => {
      const next = reorderRows(rows, dragging.from, toIndex);
      commitSteps(next);
      return next;
    });
    setDragging(null);
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
    onCommit({
      components: buildComponentsPatch(rows),
      base_servings_amount: estimateYieldGramsFromRows(rows),
      base_servings_unit: "g",
      serving_size_unit: "g",
    });
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
  function handleHeroImageRemove() {
    setHeroImageUrl(null);
    onCommit({ hero_image_url: null });
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
              {heroImageUrl && (
                <IconButton label="Remove hero image" icon={<XIcon />} variant="ghost" onClick={handleHeroImageRemove} />
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
              <div className="text-sm font-medium">Estimated recipe yield</div>
              <div className="mt-1 text-sm text-muted">
                {estimatedYieldGrams ? `Approx. ${estimatedYieldGrams} g from ingredient grams` : "Add ingredient grams to calculate yield"}
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Nutrition serving grams</label>
              <Input
                type="number"
                value={servingSizeAmount}
                onChange={(e) => setServingSizeAmount(e.target.value)}
                onBlur={() =>
                  onCommit({
                    serving_size_amount: servingSizeAmount.trim() ? Number(servingSizeAmount) : null,
                    serving_size_unit: "g",
                    base_servings_amount: estimateYieldGramsFromRows(components),
                    base_servings_unit: "g",
                  })
                }
                placeholder="100"
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
          <SectionHeader title="Components & ingredients">
            {nutritionIssues.length > 0 && (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
                {nutritionIssues.length} nutrition review
              </span>
            )}
            {onRefreshNutrition && (
              <IconButton
                label="Refresh nutrition facts"
                icon={<RefreshIcon />}
                loading={refreshingNutrition}
                onClick={() => void onRefreshNutrition()}
              />
            )}
            {reviewBadge(["components"])}
          </SectionHeader>
          {components.map((component, ci) => (
            <div
              key={ci}
              onDragOver={allowDrop}
              onDrop={(event) => dropComponent(event, ci)}
              className={`space-y-3 rounded-lg border p-3 transition-colors ${
                dragging?.type === "component" && dragging.from !== ci
                  ? "border-brand/50 bg-brand-soft/20"
                  : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <DragHandle
                  label="Drag component to reorder"
                  onDragStart={(event) => startDrag(event, { type: "component", from: ci })}
                  onDragEnd={() => setDragging(null)}
                />
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
                  <div
                    key={ii}
                    onDragOver={allowDrop}
                    onDrop={(event) => dropIngredient(event, ci, ii)}
                    className={`space-y-2 rounded-md p-2 transition-colors ${
                      dragging?.type === "ingredient" && dragging.componentIndex === ci && dragging.from !== ii
                        ? "bg-brand-soft/40 ring-1 ring-brand/50"
                        : "bg-surface-muted"
                    }`}
                  >
                    <div className="flex gap-2">
                      <DragHandle
                        label="Drag ingredient to reorder"
                        onDragStart={(event) => startDrag(event, { type: "ingredient", componentIndex: ci, from: ii })}
                        onDragEnd={() => setDragging(null)}
                      />
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
                        <select
                          value={ing.displayUnit}
                          onChange={(e) => {
                            updateIngredient(ci, ii, { displayUnit: e.target.value });
                            commitComponents(
                              components.map((componentRow, componentIndex) =>
                                componentIndex === ci
                                  ? {
                                      ...componentRow,
                                      ingredients: componentRow.ingredients.map((ingredientRow, ingredientIndex) =>
                                        ingredientIndex === ii ? { ...ingredientRow, displayUnit: e.target.value } : ingredientRow
                                      ),
                                    }
                                  : componentRow
                              )
                            );
                          }}
                          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                          aria-label={`Display unit for ${ing.name || "ingredient"}`}
                        >
                          {displayUnitChoices(ing).map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
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
                      placeholder="Optional custom conversions, e.g. 1 cup; 2 cloves. Grams remain canonical."
                      className="text-xs"
                    />
                    <IngredientNutritionIssue issue={nutritionIssueForIngredient(ing.name)} />
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
            <div
              key={si}
              onDragOver={allowDrop}
              onDrop={(event) => dropStep(event, si)}
              className={`space-y-2 rounded-lg border p-3 transition-colors ${
                dragging?.type === "step" && dragging.from !== si ? "border-brand/50 bg-brand-soft/20" : "border-border"
              }`}
            >
              <div className="flex gap-2">
                <span className="mt-2 text-sm text-muted">{si + 1}.</span>
                <DragHandle
                  label="Drag step to reorder"
                  onDragStart={(event) => startDrag(event, { type: "step", from: si })}
                  onDragEnd={() => setDragging(null)}
                />
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
