"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Role } from "@/lib/types";

interface AuthContextValue {
  role: Role;
  isAdmin: boolean;
  displayName: string | null;
  loading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>("guest");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setRole(res.role);
        setDisplayName(res.display_name || null);
      })
      .catch(() => {
        setRole("guest");
        setDisplayName(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (password: string) => {
    try {
      const res = await api.login(password);
      setRole(res.role);
      setDisplayName(res.display_name || null);
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError("Login failed");
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setRole("guest");
    setDisplayName(null);
  }, []);

  const value = useMemo(
    () => ({ role, isAdmin: role === "admin", displayName, loading, login, logout }),
    [role, displayName, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
