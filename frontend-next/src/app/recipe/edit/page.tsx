"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageSpinner } from "@/components/ui/Spinner";

function RecipeEditRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get("id");

  useEffect(() => {
    const target = recipeId
      ? `/recipe/research?id=${encodeURIComponent(recipeId)}`
      : "/admin";
    router.replace(target);
  }, [recipeId, router]);

  return <PageSpinner label="Opening agentic editor..." />;
}

export default function RecipeEditPage() {
  return (
    <Suspense fallback={<PageSpinner label="Opening agentic editor..." />}>
      <RecipeEditRedirect />
    </Suspense>
  );
}
