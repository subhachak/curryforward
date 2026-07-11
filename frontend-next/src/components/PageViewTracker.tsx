"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const VISITOR_KEY = "curryforward-visitor-id";

function visitorId() {
  const existing = localStorage.getItem(VISITOR_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(VISITOR_KEY, created);
  return created;
}

export function PageViewTracker() {
  const pathname = usePathname();
  const { isAdmin, loading } = useAuth();

  useEffect(() => {
    if (loading || isAdmin || pathname.startsWith("/admin") || pathname === "/login") return;
    fetch("/api/analytics/page-view", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor_id: visitorId(), path: pathname, referrer: document.referrer || null }),
    }).catch(() => undefined);
  }, [pathname, isAdmin, loading]);

  return null;
}
