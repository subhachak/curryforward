import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { RecipeDetail } from "@/lib/types";
import { isSeed, lineageLabel } from "@/lib/lineage";

export function VersionHistory({ versions }: { versions: RecipeDetail[] }) {
  const shown = versions.filter((v) => !isSeed(v.lineage) || v.is_current_head);
  if (shown.length === 0) return null;

  return (
    <Card>
      <CardBody>
        <div className="mb-2 font-semibold">Version History</div>
        <div className="space-y-1.5 text-sm">
          {shown.map((v) => {
            const label = lineageLabel(v.lineage);
            return (
              <div key={v.version_id} className="flex flex-wrap items-center gap-2">
                <span className="text-muted">
                  {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
                </span>
                {label && <Badge tone="neutral">{label}</Badge>}
                {!isSeed(v.source) && <span className="text-muted">{v.source}</span>}
                {v.is_current_head && <Badge tone="brand">current</Badge>}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
