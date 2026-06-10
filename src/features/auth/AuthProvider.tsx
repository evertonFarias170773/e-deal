"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { mockCurrentUser, mockSellerUser } from "@/lib/mocks/usuarios.mock";
import type { MockUser } from "@/lib/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { fetchUsuarioEnriquecido } from "@/features/auth/usuarios.service";

function resolveMockUser(email: string): MockUser {
  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail === mockSellerUser.email.toLowerCase()) {
    return mockSellerUser;
  }

  if (normalizedEmail === mockCurrentUser.email.toLowerCase()) {
    return mockCurrentUser;
  }

  // Se for qualquer outro e-mail, retornar um usuário básico limitado (operador/guest)
  return {
    id: "guest-user",
    name: "Usuário",
    email: normalizedEmail,
    sector: "COMERCIAL",
    companyId: 1,
    isAdmin: false,
    isSuperAdmin: false,
    isSeller: false
  };
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
  return {
    ...fallbackUser,
    id: session.user.id, // Always use the real Supabase Auth session UUID
    name: metadataName || fallbackUser.name
  };
}

/**
 * Enriquece o usuário base (mapeado da sessão) com dados reais de
 * public.usuarios + public.perfis.
 *
 * - Nunca lança exceção — retorna o baseUser inalterado se falhar.
 * - Chamado de forma assíncrona após o login, sem bloquear a UI.
 */
async function enrichUserWithSupabaseData(baseUser: MockUser): Promise<MockUser> {
  try {
    const enriched = await fetchUsuarioEnriquecido(baseUser.id, baseUser.email, baseUser.name);
    if (!enriched) return baseUser;

    return {
      ...baseUser,
      ...enriched,
      // Sempre manter o id da sessão auth — nunca sobrescrever
      id: baseUser.id
    };
  } catch (err) {
    console.warn("[AuthProvider] Falha ao enriquecer usuário com dados do banco:", err);
    return baseUser;
  }
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

    void client.auth.getSession().then(async ({ data, error }) => {
      if (!isMounted) return;

      if (error) {
        console.error("[AuthProvider] Falha ao restaurar sessao:", error.message);
      }

      const baseUser = mapSessionToUser(data.session);

      if (baseUser) {
        // Setar imediatamente com dados de sessão para não bloquear a UI
        setAuthState({ user: baseUser, isLoading: false });

        // Enriquecer com dados reais do banco de forma assíncrona
        const enrichedUser = await enrichUserWithSupabaseData(baseUser);
        if (isMounted) {
          setAuthState({ user: enrichedUser, isLoading: false });
        }
      } else {
        setAuthState({ user: null, isLoading: false });
      }
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;

      const baseUser = mapSessionToUser(session);

      if (baseUser) {
        // Setar imediatamente (sem esperar enriquecimento) para não bloquear
        setAuthState({ user: baseUser, isLoading: false });

        // Enriquecer assincronamente
        void enrichUserWithSupabaseData(baseUser).then((enrichedUser) => {
          if (isMounted) {
            setAuthState({ user: enrichedUser, isLoading: false });
          }
        });
      } else {
        setAuthState({ user: null, isLoading: false });
      }
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

    // Setar usuário base imediatamente para liberar a UI
    setAuthState({ user: mappedUser, isLoading: false });

    // Enriquecimento assíncrono pós-login (não bloqueia o redirecionamento)
    void enrichUserWithSupabaseData(mappedUser).then((enrichedUser) => {
      setAuthState({ user: enrichedUser, isLoading: false });
    });
  }, []);

  const logout = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) {
      setAuthState({ user: null, isLoading: false });
      return;
    }

    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(error.message || "Nao foi possivel encerrar sessao.");
    }

    setAuthState({ user: null, isLoading: false });
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
