"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ModelOption } from "@/lib/types";

interface ModelPickerProps {
  value: string | null;
  onChange: (modelId: string) => void;
  className?: string;
}

export function ModelPicker({ value, onChange, className = "" }: ModelPickerProps) {
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    api
      .listModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  // Nothing configured (or still loading) — don't show an empty/broken picker.
  if (models.length === 0) return null;

  return (
    <select
      className={`rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand ${className}`}
      value={value ?? models[0].id}
      onChange={(e) => onChange(e.target.value)}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
