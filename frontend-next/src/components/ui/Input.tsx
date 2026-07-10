import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...rest }, ref) => (
    <input
      ref={ref}
      className={`min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/25 ${className}`}
      {...rest}
    />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = "", ...rest }, ref) => (
    <textarea
      ref={ref}
      className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/25 ${className}`}
      {...rest}
    />
  )
);
Textarea.displayName = "Textarea";
