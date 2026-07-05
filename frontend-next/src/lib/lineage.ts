// "seed" just means "came from the original import", and "researched" just
// means "built via the admin research workflow" — neither is meaningful to a
// reader, so lineage/source badges and labels are hidden for both everywhere.
export function isSeed(value: string | null | undefined): boolean {
  return value === "seed" || value === "researched";
}

const LINEAGE_LABELS: Record<string, string> = {
  fork: "Copied",
  generated: "AI-generated",
  user_customized: "Customized",
  edit: "Edited",
  manual: "Custom",
};

export function lineageLabel(lineage: string): string | null {
  if (isSeed(lineage)) return null;
  return LINEAGE_LABELS[lineage] ?? null;
}
