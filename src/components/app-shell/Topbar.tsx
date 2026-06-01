"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Menu, Bell, CheckSquare } from "lucide-react";
import { CompanySwitcher } from "@/components/app-shell/CompanySwitcher";
import { GlobalSearch } from "@/components/app-shell/GlobalSearch";
import { ThemeToggle } from "@/components/app-shell/ThemeToggle";
import { UserMenu } from "@/components/app-shell/UserMenu";
import { useAuth } from "@/features/auth/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAppToast } from "@/components/common/AppToast";
import { NotificationsPopover } from "@/components/app-shell/NotificationsPopover";
import {
  listPropostaChatMentionsForUser,
  type PropostaChatMentionJoined
} from "@/features/orcamentos/services/orcamentos.service";
import {
  getActiveUserPendenciasCount,
  type PropostaPendencia
} from "@/features/orcamentos/services/propostas-pendencias.service";

type TopbarProps = {
  onOpenMenu: () => void;
};

export function Topbar({ onOpenMenu }: TopbarProps) {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const [unreadCount, setUnreadCount] = useState(0);
  const [activePendenciasCount, setActivePendenciasCount] = useState(0);

  // Notification popover states
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [notifications, setNotifications] = useState<PropostaChatMentionJoined[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  const bellButtonRef = useRef<HTMLButtonElement>(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user.id)) return;

    // Set loading state asynchronously to avoid React Compiler cascading render warning in useEffect
    Promise.resolve().then(() => {
      setLoadingNotifications(true);
    });
    setNotificationsError(null);
    try {
      const data = await listPropostaChatMentionsForUser(user.id);
      setNotifications(data);
      // Sync unread count from results
      const unread = data.filter((n) => !n.read_at).length;
      setUnreadCount(unread);
    } catch (err) {
      console.error("[Topbar] Erro ao buscar lista de menções:", err);
      setNotificationsError(String(err));
    } finally {
      setLoadingNotifications(false);
    }
  }, [user]);

  // Fetch active user pendencies count
  const fetchPendenciasCount = useCallback(async () => {
    if (!user?.id) return;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user.id)) return;

    try {
      const res = await getActiveUserPendenciasCount(user.id);
      if (res.success) {
        setActivePendenciasCount(res.count);
      }
    } catch (err) {
      console.error("[Topbar] Erro ao buscar contagem de pendências:", err);
    }
  }, [user]);

  // Initial fetch on mount / user change (deferred to avoid React Compiler cascading render warning)
  useEffect(() => {
    if (user?.id) {
      const timer = setTimeout(() => {
        void fetchNotifications();
        void fetchPendenciasCount();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [user, fetchNotifications, fetchPendenciasCount]);

  // Fetch user name on demand for realtime toasts
  const fetchUserNameOnDemand = useCallback(async (userId: string): Promise<string> => {
    const supabase = getSupabaseClient();
    if (!supabase) return "um operador";
    try {
      const { data, error } = await supabase
        .from("usuarios")
        .select("nome_usuario")
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) return "um operador";
      return data.nome_usuario;
    } catch {
      return "um operador";
    }
  }, []);

  // Listen to custom updates from page
  useEffect(() => {
    window.addEventListener("pendencias-updated", fetchPendenciasCount);
    return () => {
      window.removeEventListener("pendencias-updated", fetchPendenciasCount);
    };
  }, [fetchPendenciasCount]);

  // Subscribe to real-time pendencias
  useEffect(() => {
    if (!user?.id) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user.id)) return;

    console.log(`[Topbar] Subscrevendo a pendências realtime para usuário: ${user.id}`);
    
    const channel = supabase
      .channel(`global_pendencias_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to INSERT, UPDATE
          schema: "public",
          table: "propostas_pendencias"
        },
        (payload) => {
          console.log("[Topbar] Evento realtime de pendência recebido:", payload);
          
          // 1. Refresh local topbar count
          void fetchPendenciasCount();

          // 2. Propagate to other listening components (page.tsx, PropostaPendenciasPanel.tsx)
          window.dispatchEvent(new CustomEvent("propostas-pendencias-realtime", { detail: payload }));

          const newRec = payload.new as Partial<PropostaPendencia>;
          if (!newRec) return;

          if (payload.eventType === "INSERT") {
            // Nova pendência atribuída ao usuário logado por outra pessoa
            if (newRec.responsavel_user_id === user.id && newRec.criado_por_user_id !== user.id) {
              showToast({
                type: "info",
                title: "Nova pendência atribuída",
                description: `A pendência "${newRec.titulo}" foi atribuída a você por ${newRec.criado_por_nome || "outro operador"}.`,
                onClick: () => {
                  window.location.href = "/pendencias";
                }
              });
            }
          } else if (payload.eventType === "UPDATE") {
            // Se o status mudou
            if (newRec.status === "EM_ANDAMENTO") {
              // Outro operador assumiu a pendência que eu criei
              if (newRec.criado_por_user_id === user.id && newRec.responsavel_user_id !== user.id) {
                if (newRec.responsavel_user_id) {
                  void fetchUserNameOnDemand(newRec.responsavel_user_id).then((name) => {
                    showToast({
                      type: "info",
                      title: "Pendência assumida",
                      description: `A pendência "${newRec.titulo}" foi assumida por ${name}.`
                    });
                  });
                } else {
                  showToast({
                    type: "info",
                    title: "Pendência assumida",
                    description: `A pendência "${newRec.titulo}" foi assumida.`
                  });
                }
              }
            } else if (newRec.status === "CONCLUIDA") {
              // Outro operador concluiu a pendência (eu sou o criador ou o responsável)
              if (newRec.concluido_por_user_id !== user.id) {
                if (newRec.criado_por_user_id === user.id || newRec.responsavel_user_id === user.id) {
                  showToast({
                    type: "success",
                    title: "Pendência concluída",
                    description: `A pendência "${newRec.titulo}" foi concluída por ${newRec.concluido_por_nome || "outro operador"}.`
                  });
                }
              }
            } else if (newRec.status === "CANCELADA") {
              // Outro operador cancelou a pendência (eu sou o criador ou o responsável)
              if (newRec.cancelado_por_user_id !== user.id) {
                if (newRec.criado_por_user_id === user.id || newRec.responsavel_user_id === user.id) {
                  showToast({
                    type: "info",
                    title: "Pendência cancelada",
                    description: `A pendência "${newRec.titulo}" foi cancelada por ${newRec.cancelado_por_nome || "outro operador"}.`
                  });
                }
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      console.log(`[Topbar] Removendo canal realtime global de pendências para usuário: ${user.id}`);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, showToast, fetchPendenciasCount, fetchUserNameOnDemand]);

  // Subscribe to real-time mentions (reused single subscription channel)
  useEffect(() => {
    if (!user?.id) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user.id)) return;

    console.log(`[Topbar] Subscrevendo a menções realtime para usuário: ${user.id}`);
    const channel = supabase
      .channel(`global_mentions_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "propostas_chat_mentions",
          filter: `mentioned_user_id=eq.${user.id}`
        },
        (payload) => {
          const newMention = payload.new as {
            id_int: number;
            mentioned_by_name: string | null;
          };
          console.log("[Topbar] Nova menção recebida em tempo real:", newMention);

          // Toast notification
          showToast({
            type: "info",
            title: "Você foi mencionado!",
            description: `${newMention.mentioned_by_name || "Alguém"} mencionou você no chat da Proposta #${newMention.id_int}. Clique para abrir.`,
            onClick: () => {
              window.location.href = `/orcamentos/${newMention.id_int}?chat=open`;
            }
          });

          // Refetch to pull the fully joined message data
          void fetchNotifications();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "propostas_chat_mentions",
          filter: `mentioned_user_id=eq.${user.id}`
        },
        () => {
          // Refetch fully joined data on update
          void fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      console.log(`[Topbar] Removendo canal realtime global de menções para usuário: ${user.id}`);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, showToast, fetchNotifications]);

  return (
    <header
      className="sticky top-0 z-40 px-4 py-3 backdrop-blur lg:px-6"
      style={{
        background: "color-mix(in srgb, var(--card) 92%, transparent)",
        borderBottom: "1px solid var(--border)"
      }}
    >
      <div className="flex items-center gap-3">
        {/* Botão menu mobile */}
        <button
          type="button"
          onClick={onOpenMenu}
          className="rounded-xl p-2.5 shadow-sm transition lg:hidden"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--primary)"
          }}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Busca global */}
        <GlobalSearch />

        {/* Ações à direita */}
        <div className="ml-auto flex items-center gap-2">
          <CompanySwitcher />

          {/* Badge de Pendências */}
          {user && (
            <Link
              href="/pendencias"
              className="rounded-xl p-2.5 shadow-sm transition relative block"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--primary)"
              }}
              title={activePendenciasCount > 0 ? `Você tem ${activePendenciasCount} pendência(s) ativa(s)` : "Sem pendências ativas"}
            >
              <CheckSquare className="h-5 w-5" />
              {activePendenciasCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-600 text-[10px] font-bold text-white animate-pulse">
                  {activePendenciasCount}
                </span>
              )}
            </Link>
          )}

          {/* Badge de Menções */}
          {user && (
            <div className="relative">
              <button
                ref={bellButtonRef}
                type="button"
                className="rounded-xl p-2.5 shadow-sm transition relative"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  color: "var(--primary)"
                }}
                onClick={() => {
                  setIsPopoverOpen((prev) => !prev);
                }}
                title={unreadCount > 0 ? `Você tem ${unreadCount} menção(ões) não lida(s)` : "Sem menções pendentes"}
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white animate-pulse">
                    {unreadCount}
                  </span>
                )}
              </button>
              {isPopoverOpen && (
                <NotificationsPopover
                  notifications={notifications}
                  loading={loadingNotifications}
                  error={notificationsError}
                  onClose={() => setIsPopoverOpen(false)}
                  triggerRef={bellButtonRef}
                />
              )}
            </div>
          )}

          <ThemeToggle />
          <div className="lg:hidden">
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
