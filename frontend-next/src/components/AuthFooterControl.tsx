"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

// Deliberately subtle: earlier this was a prominent nav badge + button.
// Now it's just an icon near the footer, and it never announces role in
// its own label — it's just a doorway to /login or /admin. Logging out
// lives inside the /admin section, not on this icon.
export function AuthFooterControl() {
  const { isAdmin, loading } = useAuth();
  const router = useRouter();

  if (loading) return null;

  return (
    <button
      onClick={() => router.push(isAdmin ? "/admin" : "/login")}
      title={isAdmin ? "Admin" : "Log in"}
      aria-label={isAdmin ? "Admin" : "Log in"}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
        isAdmin ? "text-brand-hover hover:text-accent" : "text-muted/60 hover:text-muted"
      }`}
    >
      <svg viewBox="0 0 24 24" fill={isAdmin ? "currentColor" : "none"} stroke="currentColor" className="h-4 w-4">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.75}
          d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0"
        />
      </svg>
    </button>
  );
}
