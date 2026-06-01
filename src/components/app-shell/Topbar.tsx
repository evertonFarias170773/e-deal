"use client";

import { useState, useEffect } from "react";
import { Menu, Bell } from "lucide-react";
import { CompanySwitcher } from "@/components/app-shell/CompanySwitcher";
import { GlobalSearch } from "@/components/app-shell/GlobalSearch";
import { ThemeToggle } from "@/components/app-shell/ThemeToggle";
import { UserMenu } from "@/components/app-shell/UserMenu";
import { useAuth } from "@/features/auth/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAppToast } from "@/components/common/AppToast";

type TopbarProps = {
  onOpenMenu: () => void;
};

export function Topbar({ onOpenMenu }: TopbarProps) {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch initial unread count
  useEffect(() => {
    if (!user?.id) return;
    
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user.id)) return;

    let active = true;
    void (async () => {
      const { count, error } = await supabase
        .from("propostas_chat_mentions")
        .select("*", { count: "exact", head: true })
        .eq("mentioned_user_id", user.id)
        .is("read_at", null);

      if (error) {
        console.error("[Topbar] Erro ao buscar contagem de menções:", error);
        return;
      }
      if (!active) return;
      setUnreadCount(count || 0);
    })();

    return () => {
      active = false;
    };
  }, [user?.id]);

  // Subscribe to real-time mentions
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
          setUnreadCount((prev) => prev + 1);

          showToast({
            type: "info",
            title: "Você foi mencionado!",
            description: `${newMention.mentioned_by_name || "Alguém"} mencionou você no chat da Proposta #${newMention.id_int}. Clique para abrir.`,
            onClick: () => {
              window.location.href = `/orcamentos/${newMention.id_int}?chat=open`;
            }
          });
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
          // Refetch count on update to be 100% accurate
          void supabase
            .from("propostas_chat_mentions")
            .select("*", { count: "exact", head: true })
            .eq("mentioned_user_id", user.id)
            .is("read_at", null)
            .then(({ count }) => {
              setUnreadCount(count || 0);
            });
        }
      )
      .subscribe();

    return () => {
      console.log(`[Topbar] Removendo canal realtime global de menções para usuário: ${user.id}`);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, showToast]);

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
                type="button"
                className="rounded-xl p-2.5 shadow-sm transition relative"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  color: "var(--primary)"
                }}
                onClick={() => {
                  window.location.href = "/orcamentos";
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
