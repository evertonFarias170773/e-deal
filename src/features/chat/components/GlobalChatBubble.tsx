"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { MessageSquare, X, Loader2, AlertCircle, MessageCircle } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { formatDateTime } from "@/lib/formatters/date";

interface ResolvedContext {
  idInt: number;
  clienteNome: string | null;
  idCliente: string | number | null;
}

interface RecentChat {
  idInt: number;
  clienteNome: string | null;
  idCliente: string | number | null;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageAuthor: string | null;
}

interface CacheEntry {
  contextProposal: ResolvedContext | null;
  recentChats: RecentChat[];
  timestamp: number;
}

// Module-level cache to persist data across page navigations without redundant DB hits
const cacheMap = new Map<string, CacheEntry>();
const CACHE_TTL = 30000; // 30 seconds Cache TTL

export function GlobalChatBubble() {
  const { user } = useAuth();
  const pathname = usePathname();
  const { openChat } = useGlobalChat();

  const [isOpen, setIsOpen] = useState(false);
  
  // Context states
  const [activeContext, setActiveContext] = useState<ResolvedContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  
  // Recent chats states
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  
  // Contextual unread mentions count
  const [unreadCount, setUnreadCount] = useState(0);

  const bubbleRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const loadingRef = useRef(false);

  // Parse path to extract proposal, customer, or product ID
  const parsedPath = useMemo(() => {
    if (!pathname) return null;
    
    const orcamentoMatch = pathname.match(/^\/orcamentos\/(\d+)/);
    if (orcamentoMatch) {
      return { type: "proposta", id: Number(orcamentoMatch[1]) };
    }
    
    const cadastroMatch = pathname.match(/^\/cadastros\/(\d+)/);
    if (cadastroMatch) {
      return { type: "cadastro", id: Number(cadastroMatch[1]) };
    }

    return null;
  }, [pathname]);

  // Check for contextual unread mentions (only if there's a resolved idInt)
  const resolvedIdInt = activeContext?.idInt || (parsedPath?.type === "proposta" ? parsedPath.id : null);
  
  useEffect(() => {
    if (!user?.id || !resolvedIdInt) {
      Promise.resolve().then(() => {
        setUnreadCount(0);
      });
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user.id)) return;

    let active = true;
    void (async () => {
      try {
        const { count, error } = await supabase
          .from("propostas_chat_mentions")
          .select("*", { count: "exact", head: true })
          .eq("id_int", resolvedIdInt)
          .eq("mentioned_user_id", user.id)
          .is("read_at", null);

        if (error) {
          console.warn("[GlobalChatBubble] Erro ao buscar menções contextuais:", error);
          return;
        }
        if (active) {
          setUnreadCount(count || 0);
        }
      } catch (err) {
        console.error("[GlobalChatBubble] Exceção ao buscar menções contextuais:", err);
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.id, resolvedIdInt]);

  // Load data (context and recent chats) only when bubble opens
  const loadData = useCallback(async () => {
    if (!user?.id || loadingRef.current) return;
    
    loadingRef.current = true;
    const cacheKey = pathname || "default";
    const now = Date.now();
    const cached = cacheMap.get(cacheKey);

    if (cached && now - cached.timestamp < CACHE_TTL) {
      setActiveContext(cached.contextProposal);
      setRecentChats(cached.recentChats);
      loadingRef.current = false;
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      loadingRef.current = false;
      return;
    }

    setLoadingContext(true);
    setLoadingRecent(true);
    setContextError(null);
    setRecentError(null);

    try {
      // 1. Resolve active page context (e.g. lookup customer's latest proposal)
      let resolvedCtx: ResolvedContext | null = null;
      if (parsedPath) {
        if (parsedPath.type === "proposta") {
          const { data, error } = await supabase
            .from("propostas")
            .select("id_int, cliente, id_cliente")
            .eq("id_int", parsedPath.id)
            .maybeSingle();

          if (!error && data) {
            resolvedCtx = {
              idInt: data.id_int,
              clienteNome: data.cliente,
              idCliente: data.id_cliente
            };
          }
        } else if (parsedPath.type === "cadastro") {
          const { data, error } = await supabase
            .from("propostas")
            .select("id_int, cliente, id_cliente")
            .eq("id_cliente", parsedPath.id)
            .order("id_int", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            setContextError("Erro ao buscar orçamentos do cliente.");
          } else if (data) {
            resolvedCtx = {
              idInt: data.id_int,
              clienteNome: data.cliente,
              idCliente: data.id_cliente
            };
          } else {
            setContextError("Nenhum orçamento associado a este cliente.");
          }
        }
      }
      setActiveContext(resolvedCtx);

      // 2. Fetch recent chats (respecting RLS)
      const { data: messages, error: msgError } = await supabase
        .from("propostas_chat")
        .select("id_int, mensagem, created_at, autor_nome")
        .order("created_at", { ascending: false })
        .limit(50);

      if (msgError) {
        setRecentError("Erro ao buscar conversas recentes.");
      } else {
        const uniqueIds = Array.from(new Set((messages || []).map((m) => m.id_int)));
        if (uniqueIds.length === 0) {
          setRecentChats([]);
        } else {
          // Fetch proposal metadata (RLS will automatically filter out rows the user cannot access!)
          const { data: propostas, error: propError } = await supabase
            .from("propostas")
            .select("id_int, cliente, id_cliente")
            .in("id_int", uniqueIds);

          if (propError) {
            setRecentError("Erro ao validar permissões das propostas.");
          } else {
            // Assemble recent chats (deduped by proposal ID and filtered by user access)
            const list: RecentChat[] = [];
            const seen = new Set<number>();

            for (const msg of messages || []) {
              const prop = (propostas || []).find((p) => p.id_int === msg.id_int);
              if (prop && !seen.has(msg.id_int)) {
                seen.add(msg.id_int);
                list.push({
                  idInt: msg.id_int,
                  clienteNome: prop.cliente,
                  idCliente: prop.id_cliente,
                  lastMessage: msg.mensagem,
                  lastMessageAt: msg.created_at,
                  lastMessageAuthor: msg.autor_nome
                });
              }
              if (list.length >= 5) break;
            }

            setRecentChats(list);
            
            // Save in cache only on success
            cacheMap.set(cacheKey, {
              contextProposal: resolvedCtx,
              recentChats: list,
              timestamp: Date.now()
            });
          }
        }
      }
    } catch (err) {
      console.error("[GlobalChatBubble] Erro carregando recentes:", err);
      setRecentError("Erro ao processar conversas recentes.");
    } finally {
      setLoadingContext(false);
      setLoadingRecent(false);
      loadingRef.current = false;
    }
  }, [user?.id, pathname, parsedPath]);

  const toggleOpen = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      void loadData();
    }
  };

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        bubbleRef.current && 
        !bubbleRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Handle ESC key to close the bubble popover
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!user) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[60] flex flex-col items-end">
      {/* Popover Panel */}
      {isOpen && (
        <div
          ref={bubbleRef}
          className="mb-3 w-80 overflow-hidden rounded-2xl border shadow-2xl transition-all duration-200 ease-out flex flex-col"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)"
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3 shrink-0" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--foreground)" }}>
              <MessageCircle className="h-4.5 w-4.5 text-blue-600" />
              Chat de Propostas
            </h3>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1 transition"
              style={{ color: "var(--muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--background)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              aria-label="Fechar popover"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Contexto Atual Section */}
          <div className="p-3 border-b" style={{ borderColor: "var(--border)" }}>
            <h4 className="text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--muted)" }}>
              Contexto da Página
            </h4>
            
            {loadingContext ? (
              <div className="flex items-center gap-2 py-3 text-xs" style={{ color: "var(--muted)" }}>
                <Loader2 className="h-4.5 w-4.5 animate-spin text-blue-600" />
                Carregando contexto...
              </div>
            ) : contextError ? (
              <div className="flex items-center gap-2 py-2 text-xs" style={{ color: "var(--accent)" }}>
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                <span>{contextError}</span>
              </div>
            ) : activeContext ? (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  openChat(activeContext.idInt, {
                    clienteNome: activeContext.clienteNome,
                    idCliente: activeContext.idCliente
                  });
                }}
                className="w-full text-left mt-1.5 p-2 rounded-xl border hover:opacity-95 transition"
                style={{
                  background: "color-mix(in srgb, var(--card-hover) 40%, transparent)",
                  borderColor: "var(--border)"
                }}
              >
                <div className="flex items-center justify-between min-w-0">
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    Proposta #{activeContext.idInt}
                  </span>
                  {unreadCount > 0 && (
                    <span className="flex h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                  )}
                </div>
                <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--muted)" }}>
                  {activeContext.clienteNome || "Cliente não informado"}
                </p>
                <span className="text-[9px] block text-right font-medium mt-1 text-blue-600 dark:text-blue-400">
                  Abrir chat →
                </span>
              </button>
            ) : (
              <p className="text-xs py-2" style={{ color: "var(--muted)" }}>
                Acesse uma proposta ou cliente para abrir o chat correspondente.
              </p>
            )}
          </div>

          {/* Recent Chats Section */}
          <div className="p-3 flex-1 min-h-0 flex flex-col">
            <h4 className="text-[10px] uppercase font-bold tracking-wider mb-1.5" style={{ color: "var(--muted)" }}>
              Conversas Recentes
            </h4>
            
            <div className="overflow-y-auto max-h-[180px] space-y-1 pr-0.5">
              {loadingRecent ? (
                <div className="flex items-center gap-2 py-6 justify-center text-xs" style={{ color: "var(--muted)" }}>
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  Buscando conversas...
                </div>
              ) : recentError ? (
                <p className="text-xs py-4 text-center text-red-500">{recentError}</p>
              ) : recentChats.length === 0 ? (
                <p className="text-xs py-6 text-center" style={{ color: "var(--muted)" }}>
                  Nenhuma conversa recente encontrada.
                </p>
              ) : (
                recentChats.map((chat) => (
                  <button
                    key={chat.idInt}
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      openChat(chat.idInt, {
                        clienteNome: chat.clienteNome,
                        idCliente: chat.idCliente
                      });
                    }}
                    className="w-full text-left p-2 rounded-xl transition flex flex-col"
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div className="flex items-center justify-between min-w-0">
                      <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                        Proposta #{chat.idInt}
                      </span>
                      <span className="text-[8px]" style={{ color: "var(--muted)" }}>
                        {formatDateTime(chat.lastMessageAt)}
                      </span>
                    </div>
                    <span className="text-[10px] font-medium truncate" style={{ color: "var(--muted)" }}>
                      {chat.clienteNome || "Cliente avulso"}
                    </span>
                    <p className="text-[10px] truncate opacity-75 mt-0.5 break-words" style={{ color: "var(--muted)" }}>
                      <strong className="font-semibold text-slate-700 dark:text-slate-300">
                        {chat.lastMessageAuthor || "Sistema"}:
                      </strong>{" "}
                      {chat.lastMessage}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Bubble Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        className="h-14 w-14 rounded-full shadow-2xl flex items-center justify-center relative hover:scale-105 transition duration-200"
        style={{
          background: "var(--primary)",
          color: "#ffffff"
        }}
        title="Abrir chat de propostas"
        aria-label={unreadCount > 0 ? `Abrir chat de propostas. Você tem ${unreadCount} menção(ões) não lida(s)` : "Abrir chat de propostas"}
      >
        <MessageSquare className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-3 w-3 rounded-full bg-blue-600 animate-pulse" />
        )}
      </button>
    </div>
  );
}
