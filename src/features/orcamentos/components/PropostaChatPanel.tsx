"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  listPropostaChatMessages,
  sendPropostaChatMessage,
  uploadChatAnexo,
  saveChatReadInfo,
  type PropostaChatMessage,
  type PropostaChatAnexo,
  type PropostaChatResumo
} from "@/features/orcamentos/services/orcamentos.service";
import { Paperclip, Send, Loader2, FileText, Image as ImageIcon, Download, X, AlertCircle } from "lucide-react";
import { formatDateTime } from "@/lib/formatters/date";

interface PropostaChatPanelProps {
  idInt: number;
  clienteNome?: string | null;
  idCliente?: string | number | null;
  tituloContexto?: string;
  showHeader?: boolean;
  className?: string;
  onMessagesUpdated?: (summary: PropostaChatResumo) => void;
}

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "text/plain"
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function PropostaChatPanel({
  idInt,
  clienteNome,
  idCliente,
  tituloContexto,
  showHeader = true,
  className = "h-[650px] rounded-3xl border border-[#d7e5e8] bg-white shadow-sm overflow-hidden",
  onMessagesUpdated
}: PropostaChatPanelProps) {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [messages, setMessages] = useState<PropostaChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  
  // Keep track of the previous proposal ID to reset loading and states during render
  const [prevIdInt, setPrevIdInt] = useState(idInt);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const initialScrolledRef = useRef(false);

  if (idInt !== prevIdInt) {
    setPrevIdInt(idInt);
    setMessages([]);
    setLoadingMessages(true);
    setMessageText("");
    setSelectedFiles([]);
    setSending(false);
  }

  // Reset scroll tracking when proposal ID changes
  useEffect(() => {
    initialScrolledRef.current = false;
  }, [idInt]);

  // Keep ref of onMessagesUpdated to avoid unnecessary triggers / infinite render loops
  const onMessagesUpdatedRef = useRef(onMessagesUpdated);
  useEffect(() => {
    onMessagesUpdatedRef.current = onMessagesUpdated;
  }, [onMessagesUpdated]);

  // Propagate aggregates reactively when messages change
  useEffect(() => {
    let anexoCount = 0;
    let hasPendente = false;
    let hasRecusado = false;

    for (const msg of messages) {
      if (msg.anexos !== null && msg.anexos !== undefined) {
        if (Array.isArray(msg.anexos)) {
          anexoCount += msg.anexos.length;
        }
      }
      if (msg.is_pendente === true) {
        hasPendente = true;
      }
      if (msg.is_recusado === true) {
        hasRecusado = true;
      }
    }

    const lastMsg = messages[messages.length - 1] || null;
    const summary: PropostaChatResumo = {
      id_int: idInt,
      total_mensagens: messages.length,
      total_anexos: anexoCount,
      ultima_mensagem: lastMsg?.mensagem || null,
      ultima_data: lastMsg?.created_at || null,
      has_pendente: hasPendente,
      has_recusado: hasRecusado,
      nao_lidas_count: 0, // open, so marked as read
      ultima_mensagem_id: lastMsg?.id || null,
      ultima_mensagem_created_at: lastMsg?.created_at || null
    };

    onMessagesUpdatedRef.current?.(summary);
  }, [messages, idInt]);

  // Mark messages as read when they load successfully or when a new message is added
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      saveChatReadInfo(user, idInt, lastMsg.id, lastMsg.created_at);
    }
  }, [messages, loadingMessages, idInt, user]);

  // Initial HTTP list fetch
  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await listPropostaChatMessages(idInt);
      if (!active) return;
      if (res.success) {
        setMessages(res.data);
      } else {
        console.error("[PropostaChatPanel] Erro ao carregar mensagens:", res.errorMessage);
      }
      setLoadingMessages(false);
    })();
    return () => {
      active = false;
    };
  }, [idInt]);

  // Realtime subscription setup
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.warn("[PropostaChatPanel] Supabase client indisponível. Funcionando apenas via HTTP.");
      return;
    }

    console.log(`[PropostaChatPanel] Inicializando canal realtime para proposta #${idInt}`);
    const channel = supabase
      .channel(`proposta_chat_${idInt}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "propostas_chat",
          filter: `id_int=eq.${idInt}`
        },
        (payload) => {
          const newMsg = payload.new as PropostaChatMessage;
          console.log(`[PropostaChatPanel] Realtime INSERT recebido para proposta #${idInt}:`, newMsg);
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) {
              return prev;
            }
            return [...prev, newMsg];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "propostas_chat",
          filter: `id_int=eq.${idInt}`
        },
        (payload) => {
          const updatedMsg = payload.new as PropostaChatMessage;
          console.log(`[PropostaChatPanel] Realtime UPDATE recebido para proposta #${idInt}:`, updatedMsg);
          setMessages((prev) =>
            prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m))
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log(`[PropostaChatPanel] Realtime conectado para proposta #${idInt}`);
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          console.warn(`[PropostaChatPanel] Realtime desconectado/erro para proposta #${idInt}. Status: ${status}`);
        }
      });

    return () => {
      console.log(`[PropostaChatPanel] Removendo canal realtime para proposta #${idInt}`);
      void supabase.removeChannel(channel);
    };
  }, [idInt]);

  // Intelligent Scroll Logic
  useEffect(() => {
    if (loadingMessages || messages.length === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    if (!initialScrolledRef.current) {
      // First load scroll to bottom instantly
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      initialScrolledRef.current = true;
      return;
    }

    const lastMsg = messages[messages.length - 1];
    const isCurrentUserMessage = lastMsg && lastMsg.autor_uid === user?.id;

    // Check if user is scrolled near bottom
    const threshold = 150; // px
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;

    if (isCurrentUserMessage || isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loadingMessages, user?.id]);

  // Remover arquivo da lista de seleção
  function handleRemoveFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Tratar seleção de arquivos
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files) return;

    const validFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_FILE_SIZE) {
        showToast({
          type: "warning",
          title: "Arquivo muito grande",
          description: `O arquivo "${file.name}" excede o limite de 10MB.`
        });
        continue;
      }
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        showToast({
          type: "warning",
          title: "Tipo não suportado",
          description: `O tipo de "${file.name}" não é permitido no chat.`
        });
        continue;
      }
      validFiles.push(file);
    }

    setSelectedFiles((prev) => [...prev, ...validFiles]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // Enviar mensagem
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      showToast({ type: "error", title: "Não autenticado", description: "Faça login para poder enviar mensagens." });
      return;
    }

    const trimmedMsg = messageText.trim();
    if (!trimmedMsg && selectedFiles.length === 0) {
      return;
    }

    setSending(true);
    const uploadedAnexos: PropostaChatAnexo[] = [];

    try {
      // 1. Upload de anexos, se houver
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          const res = await uploadChatAnexo(idInt, file);
          if (res.success && res.anexo) {
            uploadedAnexos.push(res.anexo);
          } else {
            showToast({
              type: "error",
              title: "Falha no anexo",
              description: `Não foi possível enviar o arquivo: ${file.name}`
            });
            setSending(false);
            return;
          }
        }
      }

      // 2. Enviar a mensagem principal com os anexos
      const parsedIdCliente = idCliente && !isNaN(Number(idCliente)) ? Number(idCliente) : null;
      const resMsg = await sendPropostaChatMessage({
        id_int: idInt,
        mensagem: trimmedMsg,
        tipo: "MENSAGEM",
        autor_uid: user.id,
        autor_nome: user.name,
        autor_email: user.email,
        setor: user.sector,
        avatar: user.avatarUrl || null,
        visivel_externo: false,
        anexos: uploadedAnexos.length > 0 ? uploadedAnexos : null,
        id_cliente: parsedIdCliente
      });

      if (resMsg.success && resMsg.data) {
        setMessageText("");
        setSelectedFiles([]);
        // Adiciona a mensagem enviada localmente para atualizar o chat imediatamente (se não foi adicionada pelo realtime)
        setMessages((prev) => {
          if (prev.some((m) => m.id === resMsg.data!.id)) {
            return prev;
          }
          return [...prev, resMsg.data!];
        });
      } else {
        console.error("[PropostaChatPanel] Erro ao enviar mensagem:", resMsg.errorMessage);
        showToast({
          type: "error",
          title: "Erro ao enviar",
          description: "Não foi possível enviar a mensagem. Verifique os dados do usuário e tente novamente."
        });
      }
    } catch (err) {
      console.error("[PropostaChatPanel] Erro ao enviar:", err);
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: "Não foi possível enviar a mensagem. Verifique os dados do usuário e tente novamente."
      });
    } finally {
      setSending(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  const displayClienteNome = clienteNome || "Cliente não cadastrado";

  return (
    <section className={`flex flex-col ${className}`}>
      {showHeader && (
        <div className="flex items-center justify-between border-b border-[#d7e5e8] bg-slate-50 px-6 py-4 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-950">{tituloContexto || "Chat Interno"}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Discussão administrativa interna da proposta #{idInt} • {displayClienteNome}
            </p>
          </div>
          <div className="rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700">
            Setor: {user?.sector || "ADMIN"}
          </div>
        </div>
      )}

      {/* Listagem de Mensagens */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30">
        {loadingMessages ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-[#0b2f4a] mx-auto" />
              <p className="text-xs text-slate-500">Carregando mensagens...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center p-8">
            <div className="max-w-xs space-y-2">
              <AlertCircle className="h-8 w-8 text-slate-400 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-800">Sem mensagens ainda</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Este chat está limpo. Envie uma mensagem interna ou anexo para iniciar a conversa.
              </p>
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.autor_uid === user?.id;
            
            // Renderização de mensagens de Sistema, Financeiro e Produção
            if (message.tipo === "SISTEMA") {
              return (
                <div key={message.id} className="flex justify-center my-2">
                  <div className="rounded-full bg-slate-100 px-4 py-1.5 text-xs text-slate-600 border border-slate-200 text-center max-w-md">
                    <span className="font-semibold text-slate-700">Sistema:</span> {message.mensagem}
                  </div>
                </div>
              );
            }

            if (message.tipo === "FINANCEIRO") {
              return (
                <div key={message.id} className="flex justify-center my-2">
                  <div className="rounded-2xl bg-orange-50 px-4 py-2 text-xs text-orange-800 border border-orange-200 text-center max-w-md">
                    <span className="font-semibold">Financeiro:</span> {message.mensagem}
                  </div>
                </div>
              );
            }

            if (message.tipo === "PRODUCAO") {
              return (
                <div key={message.id} className="flex justify-center my-2">
                  <div className="rounded-2xl bg-purple-50 px-4 py-2 text-xs text-purple-800 border border-purple-200 text-center max-w-md">
                    <span className="font-semibold">Produção:</span> {message.mensagem}
                  </div>
                </div>
              );
            }

            // Mensagem normal do usuário
            return (
              <div key={message.id} className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                {/* Avatar */}
                {message.avatar ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={message.avatar}
                    alt={message.autor_nome || ""}
                    className="h-8 w-8 rounded-full object-cover border border-slate-200 shrink-0 mt-1"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-300 text-[11px] font-bold text-slate-600 border border-slate-200 shrink-0 mt-1">
                    {getInitials(message.autor_nome)}
                  </div>
                )}

                {/* Balão */}
                <div className={`max-w-[70%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 px-1 mb-1">
                    <span className="font-semibold text-slate-800">
                      {isUser ? "Você" : message.autor_nome}
                    </span>
                    {message.setor && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 font-medium">
                        {message.setor}
                      </span>
                    )}
                  </div>

                  <div
                    className={`rounded-2xl px-4 py-3 text-sm shadow-sm whitespace-pre-wrap leading-relaxed ${
                      isUser
                        ? "bg-[#0b2f4a] text-white rounded-tr-none"
                        : "bg-slate-100 text-slate-800 rounded-tl-none"
                    }`}
                  >
                    <p>{message.mensagem}</p>

                    {/* Renderização de anexos */}
                    {message.anexos && message.anexos.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-slate-200/20 pt-2.5">
                        {message.anexos.map((anexo, idx) => {
                          const isImg = anexo.type?.startsWith("image/");
                          return (
                            <div key={idx} className="flex flex-col gap-1">
                              {isImg ? (
                                <div className="relative max-w-xs overflow-hidden rounded-lg border border-slate-200/20 bg-black/5">
                                  <a href={anexo.url} target="_blank" rel="noopener noreferrer">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={anexo.url}
                                      alt={anexo.name}
                                      className="max-h-40 w-full object-cover transition hover:opacity-90"
                                    />
                                  </a>
                                  <span className="absolute bottom-1 right-1 bg-black/60 px-1.5 py-0.5 text-[9px] text-white rounded font-mono">
                                    {(anexo.size / 1024).toFixed(1)} KB
                                  </span>
                                </div>
                              ) : (
                                <a
                                  href={anexo.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs transition border ${
                                    isUser
                                      ? "bg-white/10 text-white hover:bg-white/20 border-white/10"
                                      : "bg-white text-slate-800 hover:bg-slate-50 border-slate-200"
                                  }`}
                                >
                                  <FileText className="h-4 w-4 shrink-0" />
                                  <span className="truncate max-w-[150px] font-medium">{anexo.name}</span>
                                  <Download className="h-3.5 w-3.5 shrink-0 opacity-60 ml-auto" />
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-400 mt-1 px-1">
                    {formatDateTime(message.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Lista de arquivos selecionados antes do envio */}
      {selectedFiles.length > 0 && (
        <div className="bg-slate-50 border-t border-[#d7e5e8] px-6 py-3 flex flex-wrap gap-2">
          {selectedFiles.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 bg-white rounded-xl border border-[#d7e5e8] pl-3 pr-1.5 py-1 text-xs text-slate-700 shadow-sm"
            >
              {file.type.startsWith("image/") ? (
                <ImageIcon className="h-3.5 w-3.5 text-[#0f9f9a]" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-[#0b2f4a]" />
              )}
              <span className="truncate max-w-[180px] font-medium">{file.name}</span>
              <span className="text-[10px] text-slate-400 font-mono">
                ({(file.size / (1024 * 1024)).toFixed(2)} MB)
              </span>
              <button
                type="button"
                onClick={() => handleRemoveFile(index)}
                className="p-0.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formulário de Envio */}
      <form onSubmit={handleSend} className="border-t border-[#d7e5e8] bg-white p-4">
        <div className="flex items-end gap-3">
          {/* Botão Anexar */}
          <button
            type="button"
            disabled={sending}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
            title="Anexar arquivo (até 10MB)"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            multiple
            accept={ALLOWED_MIME_TYPES.join(",")}
          />

          {/* Input de Texto */}
          <div className="flex-1">
            <textarea
              rows={1}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(e);
                }
              }}
              disabled={sending}
              placeholder={sending ? "Enviando..." : "Escreva uma mensagem interna (Shift + Enter para pular linha)..."}
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#0b2f4a] focus:bg-white transition"
              style={{ maxHeight: "120px" }}
            />
          </div>

          {/* Botão Enviar */}
          <button
            type="submit"
            disabled={sending || (!messageText.trim() && selectedFiles.length === 0)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0b2f4a] text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
