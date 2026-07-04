"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RecipeForm } from "@/components/RecipeForm";
import { Card, CardBody } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeDetail } from "@/lib/types";

function RecipeEditInner() {
  const { isAdmin, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get("id");

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(recipeId));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!recipeId) return;
    setLoading(true);
    try {
      setRecipe(await api.getRecipe(recipeId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load recipe");
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (authLoading) return <PageSpinner />;

  if (!isAdmin) {
    return (
      <Card>
        <CardBody className="text-center text-muted">
          Admin access required.{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
          .
        </CardBody>
      </Card>
    );
  }

  if (recipeId && loading) return <PageSpinner label="Loading recipe…" />;

  if (recipeId && (error || !recipe)) {
    return (
      <Card>
        <CardBody className="text-center text-muted">{error || "Recipe not found"}</CardBody>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href={recipeId ? `/recipe?id=${encodeURIComponent(recipeId)}` : "/recipes"} className="text-sm text-muted hover:underline">
          &larr; Back
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">
          {recipeId ? `Edit ${recipe?.name}` : "New recipe"}
        </h1>
        <p className="text-sm text-muted">
          {recipeId
            ? "Saving creates a new version — the recipe's history is kept."
            : "Manually entered, no AI involved."}
        </p>
      </div>
      <RecipeForm recipeId={recipeId} initial={recipe} />
    </div>
  );
}

export default function RecipeEditPage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <RecipeEditInner />
    </Suspense>
  );
}
