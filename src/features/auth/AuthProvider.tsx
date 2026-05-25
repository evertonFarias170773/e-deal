"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { mockCurrentUser, mockSellerUser } from "@/lib/mocks/usuarios.mock";
import type { MockUser } from "@/lib/types";

function resolveMockUser(email: string): MockUser {
  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail === mockSellerUser.email.toLowerCase()) {
    return mockSellerUser;
  }

  return mockCurrentUser;
}

type AuthContextValue = {
  user: MockUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = "erp_ideal_mock_session";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MockUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const sessionEmail = window.localStorage.getItem(SESSION_KEY);
    setUser(sessionEmail ? resolveMockUser(sessionEmail) : null);
    setIsLoading(false);
  }, []);

  async function login(email: string, password: string) {
    if (!email || !password) {
      throw new Error("Informe e-mail e senha para entrar.");
    }

    window.localStorage.setItem(SESSION_KEY, email.trim().toLowerCase());
    setUser(resolveMockUser(email));
    setIsLoading(false);
  }

  function logout() {
    window.localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setIsLoading(false);
  }

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      logout
    }),
    [isLoading, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  }

  return context;
}
