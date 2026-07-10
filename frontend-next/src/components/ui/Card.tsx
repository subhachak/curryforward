import { HTMLAttributes } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[14px] border border-border bg-surface-elevated shadow-[0_8px_24px_rgba(58,42,35,0.08)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.28)] ${className}`}
      {...rest}
    />
  );
}

export function CardHeader({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-4 pt-4 ${className}`} {...rest} />;
}

export function CardBody({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-4 ${className}`} {...rest} />;
}
