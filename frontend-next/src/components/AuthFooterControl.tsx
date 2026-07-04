"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

// Deliberately subtle: earlier this was a prominent nav badge + button.
// Now it's just an icon near the footer — admin access is there if you know
// to look, but it doesn't compete with the assistant/search for attention.
export function AuthFooterControl() {
  const { isAdmin, loading, logout } = useAuth();
  const { push } = useToast();
  const router = useRouter();

  if (loading) return null;

  async function handleClick() {
    if (isAdmin) {
      await logout();
      push("Logged out", "info");
    } else {
      router.push("/login");
    }
  }

  return (
    <button
      onClick={handleClick}
      title={isAdmin ? "Admin — click to log out" : "Admin log in"}
      aria-label={isAdmin ? "Log out of admin" : "Admin log in"}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
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
