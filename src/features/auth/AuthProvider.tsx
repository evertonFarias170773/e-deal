"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { mockCurrentUser, mockSellerUser } from "@/lib/mocks/usuarios.mock";
import type { MockUser } from "@/lib/types";
import { getSupabaseClient } from "@/lib/supabase/client";

function resolveMockUser(email: string): MockUser {
  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail === mockSellerUser.email.toLowerCase()) {
    return mockSellerUser;
  }

  return mockCurrentUser;
}

function buildFallbackUser(email: string): MockUser {
  const normalizedEmail = email.trim().toLowerCase();
  const baseUser = resolveMockUser(normalizedEmail);
  const suggestedName = normalizedEmail.split("@")[0]?.replace(/[._-]+/g, " ").trim();

  return {
    ...baseUser,
    id: `supabase_${baseUser.id}`,
    email: normalizedEmail,
    name: suggestedName ? suggestedName.replace(/\b\w/g, (char) => char.toUpperCase()) : baseUser.name
  };
}

function mapSessionToUser(session: Session | null): MockUser | null {
  const email = session?.user?.email;
  if (!email) {
    return null;
  }

  const metadataName =
    typeof session.user.user_metadata?.full_name === "string"
      ? session.user.user_metadata.full_name
      : typeof session.user.user_metadata?.name === "string"
        ? session.user.user_metadata.name
        : null;

  const fallbackUser = buildFallbackUser(email);
  return metadataName ? { ...fallbackUser, name: metadataName } : fallbackUser;
}

type AuthContextValue = {
  user: MockUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<{ user: MockUser | null; isLoading: boolean }>(() => ({
    user: null,
    isLoading: Boolean(getSupabaseClient())
  }));

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      return;
    }

    let isMounted = true;
    void client.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        console.error("[AuthProvider] Falha ao restaurar sessao:", error.message);
      }

      setAuthState({
        user: mapSessionToUser(data.session),
        isLoading: false
      });
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return;
      }

      setAuthState({
        user: mapSessionToUser(session),
        isLoading: false
      });
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (!email || !password) {
      throw new Error("Informe e-mail e senha para entrar.");
    }

    const client = getSupabaseClient();
    if (!client) {
      throw new Error("Supabase nao configurado. Verifique NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (error) {
      throw new Error(error.message || "Nao foi possivel autenticar no Supabase.");
    }

    const mappedUser = mapSessionToUser(data.session);
    if (!mappedUser) {
      throw new Error("Nao foi possivel recuperar sessao autenticada.");
    }

    setAuthState({
      user: mappedUser,
      isLoading: false
    });
  }, []);

  const logout = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) {
      setAuthState({
        user: null,
        isLoading: false
      });
      return;
    }

    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(error.message || "Nao foi possivel encerrar sessao.");
    }

    setAuthState({
      user: null,
      isLoading: false
    });
  }, []);

  const value = useMemo(
    () => ({
      user: authState.user,
      isAuthenticated: Boolean(authState.user),
      isLoading: authState.isLoading,
      login,
      logout
    }),
    [authState.isLoading, authState.user, login, logout]
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
