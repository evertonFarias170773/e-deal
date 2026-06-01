"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, BellOff } from "lucide-react";
import { formatDateTime } from "@/lib/formatters/date";
import type { PropostaChatMentionJoined } from "@/features/orcamentos/services/orcamentos.service";

interface NotificationsPopoverProps {
  notifications: PropostaChatMentionJoined[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

export function NotificationsPopover({
  notifications,
  loading,
  error,
  onClose,
  triggerRef
}: NotificationsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Handle click outside to close the popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current && 
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose, triggerRef]);

  // Handle ESC key to close the popover
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  function handleNotificationClick(idInt: number) {
    onClose();
    // Redirect and open the chat drawer on mount using Next.js router
    router.push(`/orcamentos/${idInt}?chat=open`);
  }

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full z-50 mt-2 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl shadow-2xl transition-all duration-200 ease-out border"
      style={{
        background: "var(--card)",
        borderColor: "var(--border)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)"
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          Notificações
        </h3>
        {notifications.length > 0 && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              background: "color-mix(in srgb, var(--secondary) 15%, transparent)",
              color: "var(--secondary)"
            }}
          >
            {notifications.length} recentes
          </span>
        )}
      </div>

      {/* Body */}
      <div className="max-h-[360px] overflow-y-auto p-1.5 space-y-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-xs gap-2" style={{ color: "var(--muted)" }}>
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            Carregando notificações...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-xs gap-2 px-4" style={{ color: "var(--muted)" }}>
            <AlertCircle className="h-5 w-5 text-red-500" />
            <p>Ocorreu um erro ao carregar as notificações.</p>
            <p className="text-[10px] text-red-400 font-mono mt-0.5">{error}</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-xs gap-2.5 px-4" style={{ color: "var(--muted)" }}>
            <BellOff className="h-6 w-6 opacity-40" />
            <div>
              <p className="font-semibold text-slate-700 dark:text-slate-300">Nenhuma notificação por aqui</p>
              <p className="text-[10px] opacity-75 mt-0.5">Você receberá um aviso sempre que for mencionado no chat.</p>
            </div>
          </div>
        ) : (
          notifications.map((item) => {
            const isUnread = !item.read_at;
            const initials = item.mentioned_by_name
              ? item.mentioned_by_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
              : "SI";

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNotificationClick(item.id_int)}
                className={`flex w-full gap-3 rounded-xl p-3 text-left transition select-none ${
                  isUnread ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
                }`}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isUnread 
                    ? "color-mix(in srgb, var(--card-hover) 85%, var(--primary) 15%)"
                    : "var(--card-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isUnread 
                    ? "var(--blue-light-bg, color-mix(in srgb, var(--card) 95%, var(--primary) 5%))"
                    : "transparent";
                }}
                style={{
                  background: isUnread 
                    ? "color-mix(in srgb, var(--card) 95%, var(--primary) 5%)"
                    : "transparent"
                }}
              >
                {/* Avatar Icon */}
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm"
                  style={{
                    background: "color-mix(in srgb, var(--secondary) 15%, transparent)",
                    color: "var(--secondary)"
                  }}
                >
                  {initials}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 leading-tight space-y-0.5">
                  <div className="flex items-start justify-between gap-1.5">
                    <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>
                      {item.mentioned_by_name || "Sistema"}
                    </p>
                    <span className="text-[9px] shrink-0 font-medium" style={{ color: "var(--muted)" }}>
                      {formatDateTime(item.created_at)}
                    </span>
                  </div>

                  <p className="text-[10px] uppercase font-bold tracking-wider text-blue-600 dark:text-blue-400">
                    Menção na Proposta #{item.id_int}
                  </p>

                  <p className="text-xs line-clamp-2 mt-0.5 break-words" style={{ color: "var(--muted)" }}>
                    {item.propostas_chat?.mensagem || "Visualizar chat..."}
                  </p>
                </div>

                {/* Unread Indicator Dot */}
                {isUnread && (
                  <div className="flex items-center shrink-0">
                    <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
