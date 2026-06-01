"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Menu, Bell } from "lucide-react";
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

type TopbarProps = {
  onOpenMenu: () => void;
};

export function Topbar({ onOpenMenu }: TopbarProps) {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const [unreadCount, setUnreadCount] = useState(0);

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

  // Initial fetch on mount / user change (deferred to avoid React Compiler cascading render warning)
  useEffect(() => {
    if (user?.id) {
      const timer = setTimeout(() => {
        void fetchNotifications();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [user, fetchNotifications]);

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
