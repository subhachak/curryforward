import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { RecipeDetail } from "@/lib/types";

export function VersionHistory({ versions }: { versions: RecipeDetail[] }) {
  if (versions.length === 0) return null;

  return (
    <Card>
      <CardBody>
        <div className="mb-2 font-semibold">Version History</div>
        <div className="space-y-1.5 text-sm">
          {versions.map((v) => (
            <div key={v.version_id} className="flex flex-wrap items-center gap-2">
              <span className="text-muted">
                {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
              </span>
              <Badge tone="neutral">{v.lineage}</Badge>
              <span className="text-muted">{v.source}</span>
              {v.is_current_head && <Badge tone="brand">current</Badge>}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
