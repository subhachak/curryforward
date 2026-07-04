"use client";

import { FormEvent, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeDetail } from "@/lib/types";

interface ChatPanelProps {
  recipeId: string;
  onPersisted: () => void;
  onPreview: (recipe: RecipeDetail) => void;
}

export function ChatPanel({ recipeId, onPersisted, onPreview }: ChatPanelProps) {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    try {
      const result = await api.chat(recipeId, message.trim());
      setMessage("");
      if (result.persisted) {
        push(`Saved: ${result.change_summary}`, "success");
        onPersisted();
      } else {
        onPreview(result.new_version);
        push(result.note || result.change_summary, "info");
      }
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Chat customization failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-2 font-semibold">Customize via chat</div>
        {!isAdmin && (
          <p className="mb-2 text-xs text-warning">
            Guest mode: changes preview for this session only — not saved, not forkable.
          </p>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            placeholder="e.g. make it spicier, halve the sugar…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button type="submit" loading={loading} disabled={!message.trim()}>
            Send
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
