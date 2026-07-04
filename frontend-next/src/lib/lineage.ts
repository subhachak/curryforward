// "seed" just means "came from the original import" — not meaningful to a
// reader, so lineage/source badges and labels are hidden for it everywhere.
export function isSeed(value: string | null | undefined): boolean {
  return value === "seed";
}

const LINEAGE_LABELS: Record<string, string> = {
  fork: "Forked",
  generated: "AI-generated",
  user_customized: "Customized",
  edit: "Edited",
  manual: "Custom",
};

export function lineageLabel(lineage: string): string | null {
  if (isSeed(lineage)) return null;
  return LINEAGE_LABELS[lineage] ?? lineage;
}
