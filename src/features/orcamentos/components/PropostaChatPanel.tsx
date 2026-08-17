"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  listPropostaChatMessages,
  sendPropostaChatMessage,
  uploadChatAnexo,
  saveChatReadInfo,
  listAllUsuarios,
  createPropostaChatMentions,
  markPropostaChatMentionsAsRead,
  type PropostaChatMessage,
  type PropostaChatAnexo,
  type PropostaChatResumo,
  type ChatUsuario
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

/**
 * De onde veio o registro, em uma palavra.
 *
 * As mensagens automáticas nascem com `autor_nome = "Sistema"` e `autor_uid`
 * nulo — nenhuma das ~19 mil guarda quem disparou a ação. O que elas guardam é
 * o `setor` ("Financeiro", "AUTO_FINANCEIRO", "STATUS_ENGINE_FASE_4A"), e é ele
 * que responde de onde partiu. Quando existe pessoa de verdade, a pessoa vence.
 */
function origemDoRegistro(autorNome?: string | null, setor?: string | null): string | null {
  const nome = autorNome?.trim();
  if (nome && nome.toLowerCase() !== "sistema") return nome;
  return setor?.trim() || null;
}

/**
 * Registro automático da timeline (Sistema, Financeiro, Produção).
 *
 * Data, hora e origem ficam SEMPRE visíveis: sem elas a timeline não serve para
 * conferir nada — foi exatamente o que impediu de enxergar, em 17/08/2026, que
 * duas cobranças da proposta 20714 tinham nascido com 1 segundo de diferença.
 */
function RegistroDeSistema({
  rotulo,
  tom,
  mensagem,
  criadoEm,
  origem
}: {
  rotulo: string;
  tom: string;
  mensagem: string;
  criadoEm: string;
  origem: string | null;
}) {
  return (
    <div className="flex justify-center my-2">
      <div className="max-w-md">
        <div className={`rounded-2xl border px-4 py-2 text-xs text-center ${tom}`}>
          <span className="font-semibold">{rotulo}:</span> {mensagem}
        </div>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
          <span className="tabular-nums">{formatDateTime(criadoEm)}</span>
          {origem && (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium text-slate-500">{origem}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PropostaChatPanel({
  idInt,
  clienteNome,
  idCliente,
  tituloContexto,
  showHeader = true,
  className = "h-[650px] rounded-3xl border border-[#d7e5e8] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden",
  onMessagesUpdated
}: PropostaChatPanelProps) {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [messages, setMessages] = useState<PropostaChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // Mentions and Autocomplete state
  const [allUsers, setAllUsers] = useState<ChatUsuario[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<ChatUsuario[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState(-1);
  
  // Keep track of the previous proposal ID to reset loading and states during render
  const [prevIdInt, setPrevIdInt] = useState(idInt);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialScrolledRef = useRef(false);

  if (idInt !== prevIdInt) {
    setPrevIdInt(idInt);
    setMessages([]);
    setLoadingMessages(true);
    setMessageText("");
    setSelectedFiles([]);
    setSending(false);
    setSelectedMentions([]);
    setShowAutocomplete(false);
  }

  // Load users list on-demand when focused
  const [usersLoaded, setUsersLoaded] = useState(false);
  const loadUsersOnDemand = useCallback(async () => {
    if (usersLoaded) return;
    try {
      const users = await listAllUsuarios();
      setAllUsers(users);
      setUsersLoaded(true);
    } catch (err) {
      console.error("[PropostaChatPanel] Erro ao carregar usuários:", err);
    }
  }, [usersLoaded]);

  // Mark mentions as read when proposal changes or chat is opened
  useEffect(() => {
    if (user?.id) {
      void markPropostaChatMentionsAsRead(user.id, idInt);
    }
  }, [idInt, user?.id]);

  // Reset scroll tracking when proposal ID changes
  useEffect(() => {
    initialScrolledRef.current = false;
  }, [idInt]);

  // Autocomplete query filters
  const filteredUsers = useMemo(() => {
    if (!showAutocomplete) return [];
    const query = autocompleteQuery.toLowerCase().trim();
    if (!query) {
      return allUsers.slice(0, 10);
    }
    return allUsers.filter(
      (u) =>
        u.nome_usuario.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query)
    );
  }, [allUsers, showAutocomplete, autocompleteQuery]);

  // Select user callback
  const selectUser = useCallback((selectedUser: ChatUsuario) => {
    if (mentionTriggerIndex === -1 || !textareaRef.current) return;
    
    const text = messageText;
    const selectionStart = textareaRef.current.selectionStart;
    
    const beforeMention = text.slice(0, mentionTriggerIndex);
    const afterCursor = text.slice(selectionStart);
    
    const mentionText = `@${selectedUser.nome_usuario} `;
    const newText = beforeMention + mentionText + afterCursor;
    
    setMessageText(newText);
    
    setSelectedMentions((prev) => {
      if (prev.some((u) => u.user_id === selectedUser.user_id)) {
        return prev;
      }
      return [...prev, selectedUser];
    });

    setShowAutocomplete(false);
    setMentionTriggerIndex(-1);
    
    const newCursorPos = mentionTriggerIndex + mentionText.length;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }, [messageText, mentionTriggerIndex]);

  // Autocomplete key and change handlers
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    setMessageText(text);

    const selectionStart = e.target.selectionStart;
    const textBeforeCursor = text.slice(0, selectionStart);
    const lastAtOffset = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtOffset !== -1) {
      const charBeforeAt = lastAtOffset > 0 ? textBeforeCursor[lastAtOffset - 1] : "";
      const isValidStart = !charBeforeAt || /\s/.test(charBeforeAt);
      const textBetweenAtAndCursor = textBeforeCursor.slice(lastAtOffset + 1);
      const hasWhitespaceBetween = /\s/.test(textBetweenAtAndCursor);

      if (isValidStart && !hasWhitespaceBetween) {
        setShowAutocomplete(true);
        setAutocompleteQuery(textBetweenAtAndCursor);
        setMentionTriggerIndex(lastAtOffset);
        setAutocompleteIndex(0);
        return;
      }
    }
    
    setShowAutocomplete(false);
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showAutocomplete && filteredUsers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((prev) => (prev + 1) % filteredUsers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectUser(filteredUsers[autocompleteIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowAutocomplete(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !showAutocomplete) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  }

  // Parser to render mentions in text using Regex (O(M) performance)
  function renderMessageContent(text: string) {
    if (!text) return null;

    // Matches @ followed by letters, numbers, accents, dots, underscores, dashes
    const mentionRegex = /@([a-zA-Z0-9\u00C0-\u017F._-]+)/g;
    const parts: Array<string | React.ReactNode> = [];
    let lastIndex = 0;
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      const matchIndex = match.index;
      const fullMatch = match[0];
      const username = match[1];

      // If user list is not loaded yet, we preventively style it as a mention.
      // Once loaded, we validate that the name corresponds to a real user in the system.
      const isValidUser = !usersLoaded || allUsers.some(
        (u) => u.nome_usuario.toLowerCase() === username.toLowerCase()
      );

      if (isValidUser) {
        if (matchIndex > lastIndex) {
          parts.push(text.slice(lastIndex, matchIndex));
        }
        parts.push(
          <span
            key={`mention-${matchIndex}`}
            className="inline-flex items-center font-semibold px-1 py-0.5 rounded-md text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800/40"
          >
            {fullMatch}
          </span>
        );
        lastIndex = mentionRegex.lastIndex;
      }
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : text;
  }

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
        // Parse active mentions from the selected list that are actually in the text
        const activeMentions = selectedMentions.filter((u) =>
          trimmedMsg.toLowerCase().includes(`@${u.nome_usuario.toLowerCase()}`)
        );

        // Fire and forget mentions creation (non-blocking)
        if (activeMentions.length > 0) {
          createPropostaChatMentions(resMsg.data.id, idInt, activeMentions, user)
            .then((mentionRes) => {
              if (!mentionRes.success) {
                console.warn("[PropostaChatPanel] Falha não-bloqueante ao salvar menções:", mentionRes.errorMessage);
              } else {
                console.log("[PropostaChatPanel] Menções salvas com sucesso!");
              }
            })
            .catch((err) => {
              console.error("[PropostaChatPanel] Exceção não-bloqueante ao salvar menções:", err);
            });
        }

        setMessageText("");
        setSelectedFiles([]);
        setSelectedMentions([]);
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
        <div className="flex items-center justify-between border-b border-[#d7e5e8] dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-6 py-4 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50">{tituloContexto || "Chat Interno"}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Discussão administrativa interna da proposta #{idInt} • {displayClienteNome}
            </p>
          </div>
          <div className="rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
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
              <AlertCircle className="h-8 w-8 text-slate-400 dark:text-slate-500 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Sem mensagens ainda</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Este chat está limpo. Envie uma mensagem interna ou anexo para iniciar a conversa.
              </p>
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.autor_uid === user?.id;
            
            // Registros automáticos: Sistema, Financeiro e Produção. Mudam só o
            // rótulo e a cor — data, hora e origem vêm do mesmo componente, para
            // não existir um caminho em que a timeline volte a ficar sem eles.
            const registroAutomatico: Record<string, { rotulo: string; tom: string }> = {
              SISTEMA: { rotulo: "Sistema", tom: "bg-slate-100 text-slate-600 border-slate-200" },
              FINANCEIRO: { rotulo: "Financeiro", tom: "bg-orange-50 text-orange-800 border-orange-200" },
              PRODUCAO: { rotulo: "Produção", tom: "bg-purple-50 text-purple-800 border-purple-200" }
            };

            const estilo = registroAutomatico[message.tipo];
            if (estilo) {
              return (
                <RegistroDeSistema
                  key={message.id}
                  rotulo={estilo.rotulo}
                  tom={estilo.tom}
                  mensagem={message.mensagem}
                  criadoEm={message.created_at}
                  origem={origemDoRegistro(message.autor_nome, message.setor)}
                />
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
                    <p>{renderMessageContent(message.mensagem)}</p>

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
                                      : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700"
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
              className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-xl border border-[#d7e5e8] dark:border-slate-700 pl-3 pr-1.5 py-1 text-xs text-slate-700 dark:text-slate-300 shadow-sm"
            >
              {file.type.startsWith("image/") ? (
                <ImageIcon className="h-3.5 w-3.5 text-[#0f9f9a] dark:text-[#14b8a6]" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-[#0b2f4a] dark:text-blue-400" />
              )}
              <span className="truncate max-w-[180px] font-medium">{file.name}</span>
              <span className="text-[10px] text-slate-450 dark:text-slate-500 font-mono">
                ({(file.size / (1024 * 1024)).toFixed(2)} MB)
              </span>
              <button
                type="button"
                onClick={() => handleRemoveFile(index)}
                className="p-0.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300 transition"
                aria-label="Remover anexo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formulário de Envio */}
      <form onSubmit={handleSend} className="border-t border-[#d7e5e8] dark:border-slate-800 bg-white dark:bg-slate-900 p-4 relative">
        {showAutocomplete && filteredUsers.length > 0 && (
          <div className="absolute bottom-full left-4 z-50 mb-2 w-64 max-h-48 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-lg space-y-0.5">
            {filteredUsers.map((u, index) => {
              const isSelected = index === autocompleteIndex;
              return (
                <button
                  key={u.user_id}
                  type="button"
                  onClick={() => selectUser(u)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                    isSelected
                      ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400">
                    {u.avatar ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={u.avatar} alt="" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      u.nome_usuario.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
                    )}
                  </div>
                  <div className="truncate">
                    <span className="block font-semibold text-slate-800 dark:text-slate-200">{u.nome_usuario}</span>
                    <span className="block text-[10px] text-slate-400 dark:text-slate-500 truncate">{u.email} {u.setor ? `• ${u.setor}` : ""}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-3">
          {/* Botão Anexar */}
          <button
            type="button"
            disabled={sending}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-850 hover:text-slate-900 dark:hover:text-slate-200 disabled:opacity-50"
            title="Anexar arquivo (até 10MB)"
            aria-label="Anexar arquivo"
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
              ref={textareaRef}
              rows={1}
              value={messageText}
              onChange={handleTextareaChange}
              onKeyDown={handleTextareaKeyDown}
              onFocus={loadUsersOnDemand}
              disabled={sending}
              placeholder={sending ? "Enviando..." : "Escreva uma mensagem interna (Shift + Enter para pular linha)..."}
              className="w-full resize-none rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 outline-none focus:border-[#0b2f4a] dark:focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition"
              style={{ maxHeight: "120px" }}
            />
          </div>

          {/* Botão Enviar */}
          <button
            type="submit"
            disabled={sending || (!messageText.trim() && selectedFiles.length === 0)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0b2f4a] text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-50"
            title="Enviar mensagem"
            aria-label="Enviar mensagem"
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
