"use client";

import { useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, SendIcon, SparklesIcon, XIcon } from "@/components/ui/icons";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/context/ToastContext";
import { api, ApiError } from "@/lib/api";

interface CopyAssistFieldProps {
  recipeId?: string;
  fieldLabel: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onApply?: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  inputClassName?: string;
  context?: string;
  disabled?: boolean;
}

export function CopyAssistField({
  recipeId,
  fieldLabel,
  label,
  value,
  onChange,
  onBlur,
  onApply,
  placeholder,
  multiline,
  rows = 2,
  className = "",
  inputClassName = "",
  context,
  disabled,
}: CopyAssistFieldProps) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState("");
  const [loading, setLoading] = useState(false);

  async function generate() {
    const source = (proposal || value).trim();
    if (!source) return;
    setLoading(true);
    try {
      const payload = {
        field_label: fieldLabel,
        text: source,
        instruction: instruction.trim() || undefined,
        recipe_context: context,
      };
      const result = recipeId ? await api.rewriteCopy(recipeId, payload) : await api.rewriteAdminCopy(payload);
      setProposal(result.text);
      setInstruction("");
    } catch (e) {
      push(e instanceof ApiError ? e.message : "Rewrite failed", "error");
    } finally {
      setLoading(false);
    }
  }

  function applyProposal() {
    const next = proposal.trim();
    if (!next) return;
    onChange(next);
    onApply?.(next);
    setOpen(false);
    setProposal("");
    setInstruction("");
  }

  const field = multiline ? (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      className={`pr-11 ${inputClassName}`}
    />
  ) : (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      className={`pr-11 ${inputClassName}`}
    />
  );

  return (
    <div className={`relative ${className}`}>
      {label && <label className="mb-1 block text-sm font-medium">{label}</label>}
      <div className="relative">
        {field}
        <div className="absolute right-1.5 top-1.5">
          <IconButton
            label={`Rewrite ${fieldLabel} with AI`}
            icon={<SparklesIcon />}
            variant="ghost"
            disabled={disabled || !value.trim()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((v) => !v)}
          />
        </div>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-3rem))] space-y-2 rounded-md border border-border bg-surface p-3 shadow-lg">
          <Input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="shorter, warmer, more premium..."
            className="text-sm"
          />
          {proposal && (
            <Textarea
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              rows={Math.max(3, Math.min(7, proposal.split("\n").length + 1))}
              className="text-sm"
            />
          )}
          <div className="flex justify-end gap-1.5">
            <IconButton
              label={proposal ? "Fine-tune rewrite" : "Generate rewrite"}
              icon={<SendIcon />}
              loading={loading}
              disabled={!value.trim() && !proposal.trim()}
              onClick={generate}
            />
            {proposal && <IconButton label="Apply rewrite" icon={<CheckIcon />} onClick={applyProposal} />}
            <IconButton
              label="Close rewrite assistant"
              icon={<XIcon />}
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setProposal("");
                setInstruction("");
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
