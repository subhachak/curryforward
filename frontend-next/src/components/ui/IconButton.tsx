import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary: "bg-brand text-ink hover:bg-brand-hover disabled:bg-brand/50",
  accent: "bg-accent text-white hover:bg-accent-hover disabled:bg-accent/50",
  secondary: "bg-surface text-foreground border border-border hover:bg-surface-muted disabled:opacity-50",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted disabled:opacity-50",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:bg-danger/50",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function IconButton({
  label,
  icon,
  variant = "secondary",
  size = "sm",
  loading,
  disabled,
  className = "",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <span className="h-4 w-4">{icon}</span>
      )}
    </button>
  );
}
