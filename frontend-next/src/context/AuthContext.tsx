"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Role } from "@/lib/types";

interface AuthContextValue {
  role: Role;
  isAdmin: boolean;
  loading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>("guest");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => setRole(res.role))
      .catch(() => setRole("guest"))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (password: string) => {
    try {
      const res = await api.login(password);
      setRole(res.role);
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError("Login failed");
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setRole("guest");
  }, []);

  const value = useMemo(
    () => ({ role, isAdmin: role === "admin", loading, login, logout }),
    [role, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
