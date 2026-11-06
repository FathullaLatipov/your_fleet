"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { ApiError, api, setToken } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {
    throw new Error("Auth not ready");
  },
  logout: () => {},
  refresh: async () => {},
});

/* The last /api/auth/me result, so a page can render immediately on load
   instead of waiting a full round trip; it's revalidated in the background. */
const USER_KEY = "yf_user";

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<User>("/api/auth/me");
      // Keep the same object when nothing changed, so pages keyed on `user`
      // don't refetch their data a second time after the background check.
      setUser((prev) => (prev && JSON.stringify(prev) === JSON.stringify(me) ? prev : me));
      writeCachedUser(me);
    } catch (e) {
      // Only a rejected token signs you out; a network blip keeps the session.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setUser(null);
        setToken(null);
        writeCachedUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let hasToken = false;
    try {
      hasToken = !!localStorage.getItem("yf_token");
    } catch {
      /* ignore */
    }
    if (!hasToken) {
      writeCachedUser(null);
      setLoading(false);
      return;
    }
    const cached = readCachedUser();
    if (cached) {
      setUser(cached);
      setLoading(false);
    }
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ access_token: string }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setToken(res.access_token);
    const me = await api<User>("/api/auth/me");
    setUser(me);
    writeCachedUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    writeCachedUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
