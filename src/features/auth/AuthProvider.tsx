"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { MockUser } from "@/lib/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { fetchUsuarioEnriquecido } from "@/features/auth/usuarios.service";
import { usePathname } from "next/navigation";

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

  const suggestedName = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  const name = metadataName || (suggestedName ? suggestedName.replace(/\b\w/g, (char) => char.toUpperCase()) : "Usuário");

  return {
    id: session.user.id,
    email: email,
    name: name,
    sector: "ADMIN",
    companyId: 1,
    isAdmin: false,
    isSuperAdmin: false,
    isSeller: false,
    isGerente: false,
    perfilSlug: "",
    permissoes: [],
  };
}

/**
 * Enriquece o usuário base (mapeado da sessão) com dados reais de
 * public.usuarios + public.perfis.
 *
 * Retorna null se o usuário não for encontrado ou se falhar,
 * indicando que a conta está bloqueada ou sem perfil configurado.
 */
async function enrichUserWithSupabaseData(baseUser: MockUser): Promise<MockUser | null> {
  try {
    const enriched = await fetchUsuarioEnriquecido(baseUser.id, baseUser.email, baseUser.name);
    if (!enriched) return null;

    return {
      ...baseUser,
      ...enriched,
      id: baseUser.id
    };
  } catch (err) {
    console.warn("[AuthProvider] Falha ao enriquecer usuário com dados do banco:", err);
    return null;
  }
}

type AuthContextValue = {
  user: MockUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isBlocked: boolean;
  /** Resolve com o usuario JA enriquecido (perfil + permissoes), ou null se o enriquecimento falhar. */
  login: (email: string, password: string) => Promise<MockUser | null>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [authState, setAuthState] = useState<{ user: MockUser | null; isLoading: boolean; isBlocked: boolean }>(() => ({
    user: null,
    isLoading: Boolean(getSupabaseClient()),
    isBlocked: false,
  }));

  /**
   * Id do usuário cujo enriquecimento já foi concluído (com sucesso ou com bloqueio).
   *
   * O Supabase reemite SIGNED_IN/TOKEN_REFRESHED sempre que a aba volta a ficar
   * visível. Sem esta marcação, cada retorno à janela republicava o usuário base
   * (sem permissões) antes do enriquecimento, o que fazia o PermissionGuard negar
   * o acesso por alguns instantes e desmontar a página — apagando filtros e
   * disparando novos carregamentos. Para eventos redundantes do mesmo usuário,
   * mantemos o usuário atual e só publicamos o resultado já enriquecido.
   */
  const usuarioResolvidoIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Se a rota atual for a de redefinição de senha, evitamos inicializar a sessão concorrentemente
    if (pathname === "/atualizar-senha") {
      setAuthState({ user: null, isLoading: false, isBlocked: false });
      return;
    }

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
        // Usuário novo (primeiro acesso ou troca de conta): libera a UI de imediato.
        // Usuário já resolvido: preserva o estado atual e enriquece em silêncio.
        if (usuarioResolvidoIdRef.current !== baseUser.id) {
          setAuthState({ user: baseUser, isLoading: false, isBlocked: false });
        }

        // Enriquecer com dados reais do banco de forma assíncrona
        const enrichedUser = await enrichUserWithSupabaseData(baseUser);
        usuarioResolvidoIdRef.current = baseUser.id;
        if (isMounted) {
          if (enrichedUser) {
            setAuthState({ user: enrichedUser, isLoading: false, isBlocked: false });
          } else {
            setAuthState({ user: baseUser, isLoading: false, isBlocked: true });
          }
        }
      } else {
        usuarioResolvidoIdRef.current = null;
        setAuthState({ user: null, isLoading: false, isBlocked: false });
      }
    });

    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      const baseUser = mapSessionToUser(session);

      if (baseUser) {
        // Evento redundante do mesmo usuário (ex.: SIGNED_IN ao refocar a janela):
        // não republica o usuário base sem permissões — apenas reenriquece.
        if (usuarioResolvidoIdRef.current !== baseUser.id) {
          // Setar imediatamente (sem esperar enriquecimento) para não bloquear
          setAuthState({ user: baseUser, isLoading: false, isBlocked: false });
        }

        // Enriquecer assincronamente
        void enrichUserWithSupabaseData(baseUser).then((enrichedUser) => {
          usuarioResolvidoIdRef.current = baseUser.id;
          if (isMounted) {
            if (enrichedUser) {
              setAuthState({ user: enrichedUser, isLoading: false, isBlocked: false });
            } else {
              setAuthState({ user: baseUser, isLoading: false, isBlocked: true });
            }
          }
        });
      } else {
        usuarioResolvidoIdRef.current = null;
        setAuthState({ user: null, isLoading: false, isBlocked: false });
      }
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [pathname]);

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
    setAuthState({ user: mappedUser, isLoading: false, isBlocked: false });

    // O enriquecimento continua sendo o que traz perfil e permissoes, e continua
    // publicando o estado assim que chega. O que mudou em 21/08/2026: ele passou
    // a ser AGUARDADO e devolvido.
    //
    // Motivo: a pagina inicial por perfil (`destinoPorPerfil`) precisa de
    // `perfilSlug`/`permissoes` para decidir. Sem esperar, quem chamasse
    // `login()` leria o usuario BASE — sem permissao nenhuma — e a regra cairia
    // sempre no destino padrao, para todo mundo. A UI nao espera: o usuario base
    // ja foi publicado na linha acima; quem espera e so a decisao de rota.
    const enrichedUser = await enrichUserWithSupabaseData(mappedUser);
    usuarioResolvidoIdRef.current = mappedUser.id;
    if (enrichedUser) {
      setAuthState({ user: enrichedUser, isLoading: false, isBlocked: false });
    } else {
      setAuthState({ user: mappedUser, isLoading: false, isBlocked: true });
    }

    return enrichedUser;
  }, []);

  const logout = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) {
      usuarioResolvidoIdRef.current = null;
      setAuthState({ user: null, isLoading: false, isBlocked: false });
      return;
    }

    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(error.message || "Nao foi possivel encerrar sessao.");
    }

    usuarioResolvidoIdRef.current = null;
    setAuthState({ user: null, isLoading: false, isBlocked: false });
  }, []);

  const value = useMemo(
    () => ({
      user: authState.user,
      isAuthenticated: Boolean(authState.user),
      isLoading: authState.isLoading,
      isBlocked: authState.isBlocked,
      login,
      logout
    }),
    [authState.isLoading, authState.isBlocked, authState.user, login, logout]
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
