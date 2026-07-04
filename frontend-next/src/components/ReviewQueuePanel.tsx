"use client";

import { useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { ReviewQueueItem } from "@/lib/types";

interface ReviewQueuePanelProps {
  items: ReviewQueueItem[];
  onDecided: () => void;
}

export function ReviewQueuePanel({ items, onDecided }: ReviewQueuePanelProps) {
  const { push } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function decide(itemId: string, approved: boolean) {
    setPendingId(itemId);
    try {
      await api.decideReview(itemId, approved);
      push(approved ? "Approved and committed" : "Rejected", "success");
      onDecided();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Decision failed", "error");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card className="border-warning/40 bg-warning-soft/40">
      <CardBody>
        <div className="mb-3 font-semibold">
          Review Queue ({items.length}) — needs your approval
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.item_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-3"
            >
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-xs text-muted">
                  {item.review_reason || "Needs review"}{" "}
                  <Badge tone="neutral" className="ml-1">
                    confidence {item.extraction_confidence}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="!bg-success-soft !text-success border-success/30"
                  loading={pendingId === item.item_id}
                  onClick={() => decide(item.item_id, true)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="!bg-danger-soft !text-danger border-danger/30"
                  loading={pendingId === item.item_id}
                  onClick={() => decide(item.item_id, false)}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
