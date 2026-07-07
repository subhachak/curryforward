"use client";

import { FormEvent, useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { RecipeFeedback, RecipeFeedbackList } from "@/lib/types";

export function RecipeFeedbackPanel({ recipeId }: { recipeId: string }) {
  const { push } = useToast();
  const { isAdmin, displayName } = useAuth();
  const [feedback, setFeedback] = useState<RecipeFeedbackList | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyAuthorName, setReplyAuthorName] = useState("");
  const [replyComment, setReplyComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittingReply, setSubmittingReply] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listRecipeFeedback(recipeId)
      .then((res) => {
        if (!cancelled) setFeedback(res);
      })
      .catch((e) => {
        if (!cancelled) push(e instanceof ApiError ? e.message : "Failed to load feedback", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId, push]);

  useEffect(() => {
    if (!isAdmin || !displayName) return;
    setAuthorName((current) => current || displayName);
    setReplyAuthorName((current) => current || displayName);
  }, [isAdmin, displayName]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = comment.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      const created = await api.createRecipeFeedback(recipeId, {
        author_name: authorName.trim() || undefined,
        rating,
        comment: text,
      });
      const refreshed = await api.listRecipeFeedback(recipeId);
      setFeedback(refreshed);
      setAuthorName(isAdmin && displayName ? displayName : "");
      setRating(null);
      setComment("");
      push(
        created.status === "approved"
          ? "Thanks, your feedback was added"
          : "Thanks, your feedback is queued for review",
        created.status === "approved" ? "success" : "info"
      );
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Could not submit feedback", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(e: FormEvent, parentFeedbackId: string) {
    e.preventDefault();
    const text = replyComment.trim();
    if (!text) return;
    setSubmittingReply(true);
    try {
      const created = await api.createRecipeFeedback(recipeId, {
        author_name: replyAuthorName.trim() || undefined,
        comment: text,
        parent_feedback_id: parentFeedbackId,
      });
      const refreshed = await api.listRecipeFeedback(recipeId);
      setFeedback(refreshed);
      setReplyingTo(null);
      setReplyAuthorName(isAdmin && displayName ? displayName : "");
      setReplyComment("");
      push(
        created.status === "approved"
          ? "Thanks, your reply was added"
          : "Thanks, your reply is queued for review",
        created.status === "approved" ? "success" : "info"
      );
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Could not submit reply", "error");
    } finally {
      setSubmittingReply(false);
    }
  }

  const average = feedback?.average_rating;

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Ratings &amp; comments</div>
            <div className="mt-1 text-sm text-muted">
              {loading
                ? "Loading feedback..."
                : average
                  ? `${average.toFixed(1)} average from ${feedback.rating_count} rating${feedback.rating_count === 1 ? "" : "s"}`
                  : "No ratings yet"}
            </div>
          </div>
          {average && <div className="text-2xl font-bold text-ink">{renderStars(Math.round(average))}</div>}
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Your name (optional)"
              maxLength={80}
            />
            <div className="flex items-center gap-1" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(rating === value ? null : value)}
                  className={`h-9 w-9 rounded-md border text-lg ${
                    rating && value <= rating
                      ? "border-brand bg-brand-soft text-brand-hover"
                      : "border-border bg-surface text-muted hover:text-foreground"
                  }`}
                  title={`${value} star${value === 1 ? "" : "s"}`}
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={rating ? "Write a review..." : "Add a comment..."}
            rows={4}
            maxLength={2000}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={submitting} disabled={!comment.trim()}>
              Submit
            </Button>
          </div>
        </form>

        <div className="space-y-3">
          {feedback?.items.length ? (
            feedback.items.map((item) => (
              <FeedbackThread
                key={item.feedback_id}
                item={item}
                replyingTo={replyingTo}
                replyAuthorName={replyAuthorName}
                replyComment={replyComment}
                submittingReply={submittingReply}
                onReplyStart={(feedbackId) => {
                  setReplyingTo(feedbackId);
                  setReplyAuthorName((current) => current || (isAdmin ? displayName || "" : ""));
                  setReplyComment("");
                }}
                onReplyCancel={() => {
                  setReplyingTo(null);
                  setReplyComment("");
                }}
                onReplyAuthorChange={setReplyAuthorName}
                onReplyCommentChange={setReplyComment}
                onReplySubmit={submitReply}
              />
            ))
          ) : (
            !loading && <div className="text-sm text-muted">Be the first to add a note on this recipe.</div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function FeedbackThread({
  item,
  replyingTo,
  replyAuthorName,
  replyComment,
  submittingReply,
  onReplyStart,
  onReplyCancel,
  onReplyAuthorChange,
  onReplyCommentChange,
  onReplySubmit,
}: {
  item: RecipeFeedback;
  replyingTo: string | null;
  replyAuthorName: string;
  replyComment: string;
  submittingReply: boolean;
  onReplyStart: (feedbackId: string) => void;
  onReplyCancel: () => void;
  onReplyAuthorChange: (value: string) => void;
  onReplyCommentChange: (value: string) => void;
  onReplySubmit: (event: FormEvent, parentFeedbackId: string) => void;
}) {
  return (
    <div className="border-b border-border pb-4 last:border-0 last:pb-0">
      <FeedbackComment item={item} />
      <div className="mt-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => onReplyStart(item.feedback_id)}>
          Reply
        </Button>
      </div>

      {item.replies?.length ? (
        <div className="mt-3 space-y-3 border-l-2 border-border pl-4">
          {item.replies.map((reply) => (
            <FeedbackComment key={reply.feedback_id} item={reply} compact />
          ))}
        </div>
      ) : null}

      {replyingTo === item.feedback_id && (
        <form onSubmit={(event) => onReplySubmit(event, item.feedback_id)} className="mt-3 space-y-2 rounded-md border border-border bg-surface-muted p-3">
          <Input
            value={replyAuthorName}
            onChange={(e) => onReplyAuthorChange(e.target.value)}
            placeholder="Your name (optional)"
            maxLength={80}
          />
          <Textarea
            value={replyComment}
            onChange={(e) => onReplyCommentChange(e.target.value)}
            placeholder="Write a reply..."
            rows={3}
            maxLength={2000}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onReplyCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={submittingReply} disabled={!replyComment.trim()}>
              Submit reply
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function FeedbackComment({ item, compact = false }: { item: RecipeFeedback; compact?: boolean }) {
  return (
    <div className={compact ? "rounded-md bg-surface px-3 py-2" : ""}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-foreground">{item.author_name || "Anonymous"}</span>
        {item.rating && <span className="text-brand-hover">{renderStars(item.rating)}</span>}
        {item.created_at && <span className="text-xs text-muted">{formatDate(item.created_at)}</span>}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.comment}</p>
    </div>
  );
}

function renderStars(count: number) {
  return "★".repeat(count) + "☆".repeat(Math.max(0, 5 - count));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
