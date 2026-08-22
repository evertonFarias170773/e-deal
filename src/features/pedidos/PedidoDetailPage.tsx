"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, FileText, Package, Truck, MessageSquare, AlertCircle, AlertTriangle, ShieldAlert, RefreshCw, Scale, HardDrive, CheckCircle2, User, Phone, Mail, Calendar, MapPin, ClipboardList, Paperclip, Printer, Sparkles, Bookmark, QrCode, Barcode, Download, ExternalLink, Clock } from "lucide-react";

// --- MOCKS TEMPORÁRIOS PARA MANTER O BUILD (Refatoração de Artes JSONB em andamento) ---
const listarArtesDoModelo = async (id: string) => [];
const anexarArteVersao1 = async (input: any): Promise<any> => ({ success: false, error: "Não implementado na V2" });
// ----------------------------------------------------------------------------------------
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useAppToast } from "@/components/common/AppToast";
import { EmptyState } from "@/components/common/EmptyState";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { usePedidosMockDb, type MockChatMessage } from "./hooks/usePedidosMockDb";
import { obterPedidoOperacionalPorIdOuIdInt } from "./services/pedidos-detalhe.service";
import type { PedidoProducaoListItem, PedidoStatus } from "./types";
import ModelosManagerPanel from "./components/ModelosManagerPanel";
import { ProducaoArtesPanel } from "@/features/producao";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";

import type { PedidoArte } from "@/features/producao/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Loader2, Upload } from "lucide-react";

interface PedidoDetailPageProps {
  idInt: number;
}

export function PedidoDetailPage({ idInt }: PedidoDetailPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { openChat } = useGlobalChat();
  const {
    pedidos,
    isLoaded,
    updatePedidoStatus,
    toggleUrgente,
    uploadArteModelo,
    enviarParaAprovacaoCliente,
    liberarArteModelo,
    getChatMessages,
    addChatMessage,
    iniciarImpressaoModelo,
    finalizarImpressaoModelo,
    pausarProducao,
    liberarPausa,
    salvarComentarioInternoModelo,
    registrarDecisaoCliente
  } = usePedidosMockDb();

  const { user } = useAuth();
  const [pedido, setPedido] = useState<PedidoProducaoListItem | null>(null);
  const [loadingReal, setLoadingReal] = useState(true);
  const [showRealPanel, setShowRealPanel] = useState(false);
  const [isRealDbOrder, setIsRealDbOrder] = useState(false);
  const [artesMap, setArtesMap] = useState<Record<string, PedidoArte[]>>({});
  const [uploadingModelId, setUploadingModelId] = useState<string | null>(null);
  const [supportFiles, setSupportFiles] = useState<{ name: string; url: string; size?: number; created_at?: string }[]>([]);
  const [loadingSupportFiles, setLoadingSupportFiles] = useState(false);
  const [activeTab, setActiveTab] = useState<"resumo" | "dados_comerciais" | "produtos" | "artes" | "producao" | "expedicao" | "timeline">("resumo");

  const canView = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.view");
  const canApproveArte = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.approve_arte");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab && ["resumo", "dados_comerciais", "produtos", "artes", "producao", "expedicao", "timeline"].includes(tab)) {
        setActiveTab(tab as "resumo" | "dados_comerciais" | "produtos" | "artes" | "producao" | "expedicao" | "timeline");
      }
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let active = true;
    async function loadOrder() {
      if (!isLoaded) return;
      setLoadingReal(true);
      try {
        const dbPedido = await obterPedidoOperacionalPorIdOuIdInt(idInt);
        if (active) {
          if (dbPedido) {
            setPedido(dbPedido);
            setShowRealPanel(true);
            setIsRealDbOrder(true);
          } else {
            const mockPedido = pedidos.find((p) => p.id_int === idInt);
            setPedido(mockPedido || null);
            setShowRealPanel(false);
            setIsRealDbOrder(false);
          }
        }
      } catch (err) {
        console.error("[PedidoDetailPage] Erro ao carregar pedido do Supabase:", err);
        if (active) {
          const mockPedido = pedidos.find((p) => p.id_int === idInt);
          setPedido(mockPedido || null);
          setShowRealPanel(false);
          setIsRealDbOrder(false);
        }
      } finally {
        if (active) {
          setLoadingReal(false);
        }
      }
    }
    void loadOrder();
    return () => {
      active = false;
    };
  }, [idInt, isLoaded, pedidos]);

  // Load real arts when tab is "artes" and it is a real DB order
  useEffect(() => {
    let active = true;
    async function fetchArtes() {
      if (activeTab !== "artes" || !isRealDbOrder || !pedido) return;
      try {
        const tempMap: Record<string, PedidoArte[]> = {};
        const modelsToFetch = pedido.modelos || (pedido.produtos || []).flatMap((p) => p.modelos || []);
        for (const m of modelsToFetch) {
          const list = await listarArtesDoModelo(m.id);
          tempMap[m.id] = list;
        }
        if (active) {
          setArtesMap(tempMap);
        }
      } catch (err) {
        console.error("[PedidoDetailPage] Erro ao carregar artes:", err);
      }
    }
    void fetchArtes();
    return () => {
      active = false;
    };
  }, [activeTab, isRealDbOrder, pedido]);

  // Load support files (Briefing files) from Storage when activeTab is "artes"
  useEffect(() => {
    let active = true;
    async function fetchSupportFiles() {
      if (activeTab !== "artes" || !idInt) return;
      setLoadingSupportFiles(true);
      try {
        const client = getSupabaseClient();
        if (!client) return;

        const prefix = `pedidos-anexos/${idInt}/design/`;
        const { data, error } = await client.storage.from("chat-ideal").list(prefix);
        if (error) {
          console.error("[PedidoDetailPage] Erro ao listar arquivos de apoio:", error);
          return;
        }

        if (data && active) {
          const files = data
            .filter(f => f.name !== ".emptyFolderPlaceholder")
            .map(f => {
              const path = `pedidos-anexos/${idInt}/design/${f.name}`;
              const { data: urlData } = client.storage.from("chat-ideal").getPublicUrl(path);
              return {
                name: f.name,
                url: urlData?.publicUrl || "",
                size: f.metadata?.size || (f as any).size,
                created_at: f.created_at ?? undefined
              };
            });
          setSupportFiles(files);
        }
      } catch (err) {
        console.error("[PedidoDetailPage] Erro ao buscar arquivos de apoio:", err);
      } finally {
        if (active) setLoadingSupportFiles(false);
      }
    }
    void fetchSupportFiles();
    return () => {
      active = false;
    };
  }, [activeTab, idInt]);

  // Hotkey listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "SELECT"
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === "l") {
        router.push("/pedidos");
      } else if (key === "k") {
        router.push("/pedidos/kanban");
      } else if (key === "i") {
        router.push("/pedidos/impressao");
      } else if (key === "u") {
        toggleUrgente(idInt);
        showToast({
          type: "info",
          title: "Urgência Alterada",
          description: `Urgência do Pedido #${idInt} alterada via atalho.`
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router, idInt, toggleUrgente, showToast]);

  // Local Chat / Timeline State
  const [chatMessages, setChatMessages] = useState<MockChatMessage[]>([]);
  const [typedMessage, setTypedMessage] = useState("");
  const [typedAuthor, setTypedAuthor] = useState("Atendente");
  const [selectedSector, setSelectedSector] = useState("Comercial");
  const [timelineFilter, setTimelineFilter] = useState("Tudo");

  // Local Scale / Expedição State
  const [volumes, setVolumes] = useState(1);
  const [pesoRealInput, setPesoRealInput] = useState("");

  // Advanced Expedição States
  const [modoGalpao, setModoGalpao] = useState(false);
  const [tipoEnvio, setTipoEnvio] = useState("Expresso");
  const [transportadoraLog, setTransportadoraLog] = useState("Correios SEDEX");
  const [obsLogistica, setObsLogistica] = useState("Cuidado: material sensível à umidade.");
  const [checklist, setChecklist] = useState({
    arte: false,
    quantidades: false,
    acabamento: false,
    peso: false,
    etiqueta: false,
    notaFrete: false
  });
  const [volumesList, setVolumesList] = useState<Array<{
    id: number;
    peso: string;
    observacao: string;
    status: "aguardando" | "embalado" | "conferido" | "despachado";
  }>>([
    { id: 1, peso: "", observacao: "Caixa 1: Lote principal", status: "aguardando" }
  ]);

  // Sincronizar volumesList com a quantidade de volumes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (volumes < 1) return;
    setVolumesList(prev => {
      const currentLength = prev.length;
      if (volumes === currentLength) return prev;
      if (volumes > currentLength) {
        const added = Array.from({ length: volumes - currentLength }).map((_, i) => ({
          id: currentLength + i + 1,
          peso: "",
          observacao: `Caixa ${currentLength + i + 1}: Lote de modelos`,
          status: "aguardando" as const
        }));
        return [...prev, ...added];
      } else {
        return prev.slice(0, volumes);
      }
    });
  }, [volumes]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const atualizarPesoVolume = (volumeId: number, peso: string) => {
    setVolumesList(prev => prev.map(v => v.id === volumeId ? { ...v, peso } : v));
  };

  const atualizarObsVolume = (volumeId: number, obs: string) => {
    setVolumesList(prev => prev.map(v => v.id === volumeId ? { ...v, observacao: obs } : v));
  };

  const atualizarStatusVolume = (volumeId: number, status: typeof volumesList[0]["status"]) => {
    setVolumesList(prev => prev.map(v => v.id === volumeId ? { ...v, status } : v));
    addChatMessage(
      idInt,
      "Operador Logístico",
      "Expedição",
      "PRODUCAO",
      `Caixa #${volumeId} alterada para status: ${status.toUpperCase()}.`
    );
    showToast({
      type: "info",
      title: "Status de Volume",
      description: `Caixa #${volumeId} marcada como ${status.toUpperCase()}.`
    });
  };

  const simularCenarioLogistico = (cenario: string) => {
    const pesoTeorico = pedido?.pesoTeorico || 1.5;
    if (cenario === "peso_divergente") {
      setVolumes(1);
      setVolumesList([
        { id: 1, peso: (pesoTeorico * 1.45).toFixed(2), observacao: "Caixa 1: Lote Principal (Divergência Simulada)", status: "embalado" }
      ]);
      setChecklist({
        arte: true,
        quantidades: true,
        acabamento: true,
        peso: false,
        etiqueta: true,
        notaFrete: true
      });
      showToast({
        type: "warning",
        title: "Cenário: Peso Divergente",
        description: "Simulação de excesso de itens carregada. Despacho total será bloqueado."
      });
    } else if (cenario === "retirada_balcao") {
      setTipoEnvio("Retirada");
      setTransportadoraLog("Retirada Balcão");
      setObsLogistica("⚠️ CLIENTE AGUARDANDO NA RECEPÇÃO - PEDIDO COM PRIORIDADE MÁXIMA.");
      setVolumes(1);
      setVolumesList([
        { id: 1, peso: pesoTeorico.toFixed(2), observacao: "Volume 1: Retirada imediata", status: "conferido" }
      ]);
      setChecklist({
        arte: true,
        quantidades: true,
        acabamento: true,
        peso: true,
        etiqueta: false,
        notaFrete: true
      });
      showToast({
        type: "info",
        title: "Cenário: Retirada Balcão",
        description: "Cenário de cliente aguardando na recepção carregado."
      });
    } else if (cenario === "despacho_parcial") {
      setTipoEnvio("Transportadora");
      setTransportadoraLog("Jadlog Express");
      setObsLogistica("Enviar volumes 1 e 2 hoje. Volume 3 fica retido para aprovação de arte.");
      setVolumes(3);
      const tercoPeso = (pesoTeorico / 3);
      setVolumesList([
        { id: 1, peso: tercoPeso.toFixed(2), observacao: "Caixa 1: Pulseiras Azuis", status: "conferido" },
        { id: 2, peso: tercoPeso.toFixed(2), observacao: "Caixa 2: Pulseiras Verdes", status: "conferido" },
        { id: 3, peso: "", observacao: "Caixa 3: Aguardando Liberação de Arte", status: "aguardando" }
      ]);
      setChecklist({
        arte: true,
        quantidades: true,
        acabamento: true,
        peso: false,
        etiqueta: true,
        notaFrete: false
      });
      showToast({
        type: "info",
        title: "Cenário: Despacho Parcial",
        description: "Volumes 1 e 2 conferidos, Volume 3 pendente de liberação."
      });
    } else if (cenario === "sedex_completo") {
      setTipoEnvio("Correios");
      setTransportadoraLog("Correios SEDEX");
      setObsLogistica("Enviar completo via SEDEX com aviso de recebimento (AR).");
      setVolumes(2);
      const metPeso = (pesoTeorico / 2);
      setVolumesList([
        { id: 1, peso: metPeso.toFixed(2), observacao: "Caixa 1 de 2", status: "conferido" },
        { id: 2, peso: metPeso.toFixed(2), observacao: "Caixa 2 de 2", status: "conferido" }
      ]);
      setChecklist({
        arte: true,
        quantidades: true,
        acabamento: true,
        peso: true,
        etiqueta: true,
        notaFrete: true
      });
      showToast({
        type: "success",
        title: "Cenário: SEDEX Completo",
        description: "Tudo conferido e pronto para liberação total."
      });
    }
  };

  const executarDespachoExpedicao = (tipo: "parcial" | "total") => {
    const totalPesoReal = volumesList.reduce((acc, v) => acc + (Number(v.peso) || 0), 0);
    const pesoTeorico = pedido?.pesoTeorico || 0;
    const desvioPesoReal = pesoTeorico === 0 ? 0 : Math.abs(totalPesoReal - pesoTeorico) / pesoTeorico;
    const isPesoDivergenteReal = desvioPesoReal > 0.05;

    if (tipo === "total") {
      const checklistPendente = Object.values(checklist).some(val => !val);
      if (checklistPendente) {
        showToast({
          type: "warning",
          title: "Checklist Pendente",
          description: "Marque todos os itens da conferência operacional antes do despacho total."
        });
        return;
      }
      if (isPesoDivergenteReal && totalPesoReal > 0) {
        showToast({
          type: "error",
          title: "Despacho Bloqueado",
          description: `Divergência de peso crítica (${(desvioPesoReal * 100).toFixed(1)}%). Corrija os volumes antes do envio.`
        });
        return;
      }
      
      setVolumesList(prev => prev.map(v => ({ ...v, status: "despachado" })));
      updatePedidoStatus(idInt, "EXPEDIDO");
      
      addChatMessage(
        idInt,
        "Logística Expedição",
        "Expedição",
        "PRODUCAO",
        `📦 DESPACHO TOTAL: Todos os ${volumesList.length} volumes foram conferidos, pesados (Total: ${totalPesoReal.toFixed(2)}kg) e despachados via ${transportadoraLog} (${tipoEnvio}).`
      );
      showToast({
        type: "success",
        title: "Despacho Total Concluído",
        description: "Pedido atualizado para status EXPEDIDO."
      });
    } else {
      const volumesParaDespachar = volumesList.filter(v => v.status === "conferido" || v.status === "embalado");
      if (volumesParaDespachar.length === 0) {
        showToast({
          type: "warning",
          title: "Nenhum volume pronto",
          description: "Marque pelo menos um volume como EMBALADO ou CONFERIDO para realizar o despacho parcial."
        });
        return;
      }
      
      setVolumesList(prev => prev.map(v => (v.status === "conferido" || v.status === "embalado") ? { ...v, status: "despachado" } : v));
      
      const idsDespachados = volumesParaDespachar.map(v => `#${v.id}`).join(", ");
      const idsPendentes = volumesList.filter(v => v.status !== "conferido" && v.status !== "embalado" && v.status !== "despachado").map(v => `#${v.id}`).join(", ");
      
      addChatMessage(
        idInt,
        "Logística Expedição",
        "Expedição",
        "PRODUCAO",
        `📦 DESPACHO PARCIAL: Volumes [${idsDespachados}] foram despachados. Volumes [${idsPendentes || "Nenhum"}] continuam pendentes no galpão.`
      );
      showToast({
        type: "success",
        title: "Despacho Parcial Concluído",
        description: `Volumes [${idsDespachados}] despachados. Restante pendente.`
      });
    }
  };

  // Load chat messages
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isLoaded && pedido) {
      setChatMessages(getChatMessages(idInt));
    }
  }, [isLoaded, idInt, pedido, getChatMessages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Listen to chat changes
  useEffect(() => {
    const handleChatUpdate = () => {
      setChatMessages(getChatMessages(idInt));
    };

    window.addEventListener(`chat_updated_${idInt}`, handleChatUpdate);
    return () => {
      window.removeEventListener(`chat_updated_${idInt}`, handleChatUpdate);
    };
  }, [idInt, getChatMessages]);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title="Acesso Negado"
          description="Você não tem permissão para visualizar o detalhe deste pedido."
          icon={AlertCircle}
        />
      </div>
    );
  }

  if (!isLoaded || loadingReal) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent mx-auto"></div>
          <p className="text-slate-500 font-semibold text-sm">Carregando detalhes do pedido...</p>
        </div>
      </div>
    );
  }

  if (!pedido) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-lg mx-auto mt-12 space-y-4">
        <h2 className="text-lg font-bold text-red-800">Pedido não encontrado</h2>
        <p className="text-sm text-red-600">Pedido não encontrado.</p>
        <div className="pt-2">
          <Link
            href="/pedidos"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a fila
          </Link>
        </div>
      </div>
    );
  }

  const handleSendMessage = () => {
    if (!typedMessage.trim()) return;
    addChatMessage(idInt, typedAuthor.trim() || "Atendente", selectedSector, "MENSAGEM", typedMessage);
    setTypedMessage("");
    showToast({
      type: "success",
      title: "Mensagem enviada",
      description: "Mensagem adicionada à timeline simulada do pedido."
    });
  };

  const handleDispatchWeight = () => {
    const pesoNum = Number(pesoRealInput);
    if (isNaN(pesoNum) || pesoNum <= 0) {
      showToast({
        type: "warning",
        title: "Peso inválido",
        description: "Digite um peso real maior que zero para simular a balança."
      });
      return;
    }

    // Calcula desvio do peso
    const desvio = Math.abs(pesoNum - pedido.pesoTeorico) / pedido.pesoTeorico;
    if (desvio > 0.05) {
      showToast({
        type: "error",
        title: "Bloqueado para segurança",
        description: `Divergência de peso acima de 5% (${(desvio * 100).toFixed(1)}%). Corrija a quantidade física antes de despachar.`
      });
      return;
    }

    updatePedidoStatus(idInt, "EXPEDIDO");
    showToast({
      type: "success",
      title: "Pedido despachado",
      description: "Pesagem conforme. Status alterado para EXPEDIDO."
    });
  };

  const calculateGeneralProgress = () => {
    if (!pedido) return 0;
    if (pedido.statusPedido === "PRONTO_EXPEDICAO" || pedido.statusPedido === "EXPEDIDO") return 100;
    if (pedido.statusPedido === "REVISAO_FINAL") return 90;
    const modelosList = pedido.modelos || [];
    const artesTotal = modelosList.length;
    if (artesTotal === 0) return 0;
    const artesAprovadas = modelosList.filter((m) => m.statusArte === "LIBERADA" || m.statusArte === "NAO_NECESSARIA").length;
    const artesProg = (artesAprovadas / artesTotal) * 50; // 50% max para arte
    const prodProg = pedido.statusPedido === "EM_IMPRESSAO" ? 20 : pedido.statusPedido === "EM_ACABAMENTO" ? 35 : 0;
    return Math.round(artesProg + prodProg);
  };

  const getSectorBadgeStyles = (sector: string) => {
    const s = sector?.toLowerCase() || "";
    if (s === "comercial") {
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900";
    }
    if (s === "design" || s === "arte") {
      return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-900";
    }
    if (s === "produção" || s === "producao") {
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900";
    }
    if (s === "expedição" || s === "expedicao") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900";
    }
    if (s === "financeiro") {
      return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900";
    }
    return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-850 dark:text-slate-300 dark:border-slate-750";
  };

  const pesoNum = Number(pesoRealInput);
  const desvioPeso = isNaN(pesoNum) || pesoNum <= 0 ? 0 : Math.abs(pesoNum - pedido.pesoTeorico) / pedido.pesoTeorico;
  const isPesoDivergente = desvioPeso > 0.05;

  return (
    <div className="space-y-6">
      {/* Banner de OS Operacional */}
      <div className="rounded-lg border-2 border-blue-500 bg-blue-500/10 dark:bg-blue-500/5 p-4 text-slate-900 dark:text-slate-100 flex items-start gap-3">
        <ClipboardList className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-black text-sm uppercase tracking-wider text-blue-600 dark:text-blue-400">Ficha Operacional de OS</h4>
          <p className="text-xs text-slate-605 dark:text-slate-350 mt-1 leading-relaxed font-medium">
            Visualização consolidada de produção, especificações e acompanhamento de lotes.
          </p>
        </div>
      </div>

      <div className="flex justify-between items-center gap-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 p-2.5 rounded-xl shadow-sm text-xs">
        <div className="flex gap-2">
          <Link
            href="/pedidos"
            className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 transition flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" />
            <span>Fila Geral</span>
          </Link>
          <Link
            href="/pedidos/kanban"
            className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 transition"
          >
            Kanban Board
          </Link>
          <Link
            href="/pedidos/impressao"
            className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 transition"
          >
            Fila de Impressão
          </Link>
          <Link
            href="/expedicao"
            className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 transition"
          >
            Expedição
          </Link>
          <span className="px-3.5 py-2 font-bold rounded-xl bg-[#0b2f4a] text-white">
            Detalhe #{pedido.id_int}
          </span>
        </div>
        {!showRealPanel && (
          <span className="bg-slate-100 text-slate-800 text-[10px] font-bold px-2 py-1 rounded">PREVIEW UX</span>
        )}
      </div>

      <PageHeader
        title={`Pedido #${pedido.id_int}`}
        subtitle={`${pedido.clienteNome} — ${pedido.empresa} — Entrega prevista: ${pedido.dataPrevistaEntrega ? formatDate(pedido.dataPrevistaEntrega) : "a definir"}`}
        context="Detalhe do Pedido"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={pedido.statusPedido} />
            {pedido.urgente && (
              <span className="bg-red-600 dark:bg-red-700 text-white font-extrabold border-2 border-red-700 dark:border-red-900 rounded-md px-3 py-1 text-xs animate-pulse tracking-widest flex items-center gap-1.5 uppercase">
                ⚠️ URGENTE - PRIORIDADE CRÍTICA
              </span>
            )}
            <button
              onClick={() => toggleUrgente(idInt)}
              disabled={showRealPanel}
              className="h-9.5 px-4 rounded-2xl border border-slate-200 dark:border-slate-850 bg-white hover:bg-slate-50 text-slate-700 dark:text-slate-300 text-xs font-bold uppercase tracking-wider transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              Toggle Urgência
            </button>
            <select
              value={pedido.statusPedido}
              onChange={(e) => updatePedidoStatus(idInt, e.target.value as PedidoStatus)}
              disabled={showRealPanel}
              className="h-9.5 px-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs font-bold bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
            >
              <option value="NOVO">Mudar Status: Novo</option>
              <option value="ARTE_EM_ANDAMENTO">Arte em Andamento</option>
              <option value="AGUARDANDO_APROVACAO_CLIENTE">Aguardando Cliente</option>
              <option value="AGUARDANDO_APROVACAO_ATENDENTE">Aguardando Atendente</option>
              <option value="AGUARDANDO_OS">Aguardando OS</option>
              <option value="EM_IMPRESSAO">Em Impressão</option>
              <option value="EM_ACABAMENTO">Em Acabamento</option>
              <option value="REVISAO_FINAL">Revisão Final</option>
              <option value="PRONTO_EXPEDICAO">Pronto para Expedição</option>
              <option value="EXPEDIDO">Expedido</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
          </div>
        }
      />

      {/* Progresso Geral */}
      <section className="rounded-3xl border border-[#d7e5e8] dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-3">
        <div className="flex justify-between text-sm font-semibold">
          <span className="text-slate-500">Progresso Geral das Etapas (Arte + Manufatura):</span>
          <span className="text-slate-950 dark:text-slate-100">{calculateGeneralProgress()}% Concluído</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300 animate-pulse"
            style={{ width: `${calculateGeneralProgress()}%` }}
          ></div>
        </div>
      </section>

      {/* Tabs */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-2 shadow-sm">
        <div className="flex gap-1.5 overflow-x-auto font-sans">
          {(["resumo", "dados_comerciais", "produtos", "artes", "producao", "expedicao", "timeline"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`shrink-0 rounded-2xl px-4 py-2.5 text-sm font-semibold transition uppercase tracking-wider ${
                activeTab === tab
                  ? "bg-[#0b2f4a] text-white shadow-sm"
                  : "text-slate-650 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {tab === "resumo" && "Resumo / Boletim"}
              {tab === "dados_comerciais" && "Dados Comerciais"}
              {tab === "produtos" && `Produtos (${pedido.produtos?.length || 0})`}
              {tab === "artes" && `Anexos / Artes`}
              {tab === "producao" && "Produção / Ficha"}
              {tab === "expedicao" && "Expedição / Pesagem"}
              {tab === "timeline" && `Timeline (${chatMessages.length})`}
            </button>
          ))}
        </div>
      </section>

      {/* Tab Content */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-6 shadow-sm font-sans">
        {/* TAB RESUMO */}
        {activeTab === "resumo" && (
          <div className="space-y-6">
            {/* Header de Boletim */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-blue-600" />
                <span>Boletim Operacional de Produção</span>
              </h3>
              <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2.5 py-1 rounded font-bold uppercase tracking-wider">
                OS Geral Unificada
              </span>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Card 1: Briefing Operacional */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 space-y-3 shadow-xs">
                <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-blue-500" />
                  Briefing Operacional
                </h4>
                <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
                  {pedido.briefingOperacional || "Nenhum briefing cadastrado para este pedido."}
                </p>
                {pedido.observacoesGerais && (
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-3 mt-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Observações Gerais</span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                      &quot;{pedido.observacoesGerais}&quot;
                    </p>
                  </div>
                )}
              </div>

              {/* Card 2: Dados do Evento */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 space-y-4 shadow-xs">
                <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Dados do Evento
                </h4>
                {pedido.dadosEvento ? (
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center gap-2 bg-white dark:bg-slate-900/60 p-2.5 border border-slate-100 dark:border-slate-800 rounded-xl">
                      <Bookmark className="h-4 w-4 text-slate-400 shrink-0" />
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Nome do Evento</span>
                        <strong className="text-slate-800 dark:text-slate-200 text-xs">{pedido.dadosEvento.nome}</strong>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-white dark:bg-slate-900/60 p-2.5 border border-slate-100 dark:border-slate-800 rounded-xl">
                      <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Data do Evento</span>
                        <strong className="text-slate-800 dark:text-slate-200 text-xs">{formatDate(pedido.dadosEvento.data)}</strong>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-white dark:bg-slate-900/60 p-2.5 border border-slate-100 dark:border-slate-800 rounded-xl">
                      <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Local</span>
                        <strong className="text-slate-800 dark:text-slate-200 text-xs">{pedido.dadosEvento.local}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">Nenhum dado de evento associado.</p>
                )}
              </div>

              {/* Card 3: Instruções para Design */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 space-y-3 shadow-xs">
                <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <User className="h-4 w-4 text-teal-500" />
                  Instruções para Design
                </h4>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-900/60 p-3.5 border border-slate-100 dark:border-slate-800 rounded-xl font-mono">
                  {pedido.instrucoesDesign || "Nenhuma instrução especial de design cadastrada."}
                </p>
              </div>

              {/* Card 4: Instruções para Impressão */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 space-y-3 shadow-xs">
                <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Printer className="h-4 w-4 text-purple-500" />
                  Instruções para Impressão
                </h4>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-900/60 p-3.5 border border-slate-100 dark:border-slate-800 rounded-xl font-mono">
                  {pedido.instrucoesImpressao || "Nenhuma instrução especial de impressão cadastrada."}
                </p>
              </div>

              {/* Card 5: Anexos do Pedido */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 space-y-3 md:col-span-2 shadow-xs">
                <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Paperclip className="h-4 w-4 text-slate-500" />
                  Anexos e Documentos de Briefing ({pedido.anexos?.length || 0})
                </h4>
                {pedido.anexos && pedido.anexos.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {pedido.anexos.map((anexo, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl text-xs shadow-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-8 w-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 shrink-0">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{anexo.name}</p>
                            <p className="text-[9px] text-slate-400 uppercase">{anexo.type.split("/")[1] || "Arquivo"}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => alert(`Simulando download de: ${anexo.name}`)}
                          className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 text-[10px] font-bold transition shrink-0"
                        >
                          Baixar
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-center text-slate-400 dark:text-slate-600 text-xs">
                    Nenhum anexo geral associado ao briefing.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB DADOS COMERCIAIS */}
        {activeTab === "dados_comerciais" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-blue-600" />
                <span>Dados Comerciais & Faturamento</span>
              </h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 space-y-2 shadow-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Informações do Cliente</span>
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200">{pedido.clienteNome}</p>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <User className="h-3.5 w-3.5" />
                  <span>ID: {pedido.idCliente}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 space-y-2 shadow-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Comercial & Financeiro</span>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Forma de Pagamento: <strong className="text-slate-950 dark:text-slate-100">{pedido.formaPagamento}</strong>
                </p>
                <p className="text-xs text-slate-500">Valor Total: {formatCurrency(pedido.valorTotal)}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 space-y-2 shadow-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Responsáveis</span>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Vendedor: {pedido.vendedor}</p>
                {pedido.contatoNome && (
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Contato: {pedido.contatoNome}</p>
                )}
                <p className="text-xs text-slate-500">Canal: WhatsApp</p>
              </div>
            </div>

            {(pedido.financialBlock || pedido.blockReason) && (
              <div className="bg-red-50/30 dark:bg-red-950/20 border border-red-200 dark:border-red-900 border-l-8 border-l-red-600 dark:border-l-l-red-600 text-red-900 dark:text-red-300 p-5 rounded-3xl space-y-3 shadow-sm">
                <h4 className="font-black text-sm flex items-center gap-1.5 uppercase tracking-wider text-red-700 dark:text-red-400">
                  <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-450 shrink-0" />
                  <span>BLOQUEIOS OU RESTRIÇÕES ATIVAS NA PRODUÇÃO</span>
                </h4>
                <div className="space-y-1.5 pl-6 font-mono text-xs">
                  {pedido.financialBlock && (
                    <p className="flex items-center gap-1.5">
                      <span className="text-red-600 dark:text-red-400 font-bold">[!]</span>
                      <span><strong>BLOQUEIO FINANCEIRO / CRÉDITO:</strong> Aguardando liberação do financeiro.</span>
                    </p>
                  )}
                  {pedido.blockReason && (
                    <p className="flex items-start gap-1.5">
                      <span className="text-red-600 dark:text-red-400 font-bold">[!]</span>
                      <span><strong>PAUSA OPERACIONAL:</strong> {pedido.blockReason}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB PRODUTOS */}
        {activeTab === "produtos" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Package className="h-5 w-5 text-blue-600" />
                <span>Relação de Produtos e Especificações</span>
              </h3>
              <span className="text-xs text-slate-500 font-semibold">
                Total de Itens: {(pedido.produtos || []).reduce((acc, p) => acc + p.quantidade, 0).toLocaleString("pt-BR")} un.
              </span>
            </div>

            <div className="space-y-6 font-sans">
              {!pedido.produtos || pedido.produtos.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/10 p-8 text-center">
                  <Package className="mx-auto h-12 w-12 text-slate-450" />
                  <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-200">Ainda sem produtos cadastrados</h3>
                  <p className="mt-2 text-sm text-slate-500">Esta proposta/pedido ainda não possui produtos de produção vinculados.</p>
                </div>
              ) : (
                pedido.produtos.map((prod) => (
                  <div key={prod.id} className="rounded-2xl border border-[#d7e5e8] dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/25 p-5 shadow-sm space-y-4">
                    {/* Cabeçalho do Produto */}
                    <div className="flex flex-wrap justify-between items-center gap-3">
                      <div className="space-y-1">
                        <span className="bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 text-[9px] font-extrabold px-2 py-0.5 rounded uppercase">PRODUTO PRINCIPAL</span>
                        <h4 className="text-lg font-black text-slate-900 dark:text-slate-100">{prod.nome}</h4>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-semibold">
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 px-3 rounded-xl shadow-xs">
                          <span className="text-slate-400 block text-[9px] uppercase font-bold">Peso Est.</span>
                          <strong className="text-slate-800 dark:text-slate-200">{prod.pesoEstimado.toFixed(2)} kg</strong>
                        </div>
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 px-3 rounded-xl shadow-xs">
                          <span className="text-slate-400 block text-[9px] uppercase font-bold">Qtd Total</span>
                          <strong className="text-blue-600 dark:text-blue-400">{prod.quantidade.toLocaleString("pt-BR")} un.</strong>
                        </div>
                      </div>
                    </div>

                    {/* Tabela/Especificações dos Modelos Aninhados */}
                    <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-sm">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-950 text-slate-550 uppercase text-[9px] font-black tracking-wider border-b border-slate-200 dark:border-slate-800">
                              <th className="py-2.5 px-4">Modelo / Subitem</th>
                              <th className="py-2.5 px-3">Setor</th>
                              <th className="py-2.5 px-3">Qtd</th>
                              <th className="py-2.5 px-3">Cor Material</th>
                              <th className="py-2.5 px-3">Ficha Técnica</th>
                              <th className="py-2.5 px-3">Status Arte</th>
                              <th className="py-2.5 px-4 text-right">Ação</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {(prod.modelos || []).map((m) => (
                              <tr key={m.id} className="hover:bg-slate-50/55 dark:hover:bg-slate-950/20 font-medium">
                                <td className="py-3 px-4">
                                  <p className="font-extrabold text-slate-900 dark:text-slate-100">{m.nomeModelo}</p>
                                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {m.id}</p>
                                </td>
                                <td className="py-3 px-3">
                                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-semibold text-[10px] uppercase">
                                    {m.setor}
                                  </span>
                                </td>
                                <td className="py-3 px-3 font-extrabold text-slate-800 dark:text-slate-200">
                                  {m.quantidade.toLocaleString("pt-BR")}
                                </td>
                                <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                                  {m.corMaterial || "Padrão"}
                                </td>
                                <td className="py-3 px-3 text-[10px] text-slate-500 space-y-0.5">
                                  <div>• Numeração: <strong className="text-slate-700 dark:text-slate-300">{m.configImpressao.tipoNumeracao}</strong></div>
                                  {m.configImpressao.tipoNumeracao !== "SEM_NUMERACAO" && (
                                    <div>• Intervalo: <strong className="text-slate-700 dark:text-slate-300">{m.numeracaoInicial ?? 1} - {m.numeracaoFinal ?? m.quantidade}</strong></div>
                                  )}
                                  <div>• Acabamento: <strong className="text-slate-700 dark:text-slate-300">{m.verso ? "Frente/Verso" : "Apenas Frente"}</strong></div>
                                  {m.bloco && <div>• Pacote: <strong className="text-slate-700 dark:text-slate-300">{m.bloco}</strong></div>}
                                </td>
                                <td className="py-3 px-3">
                                  <StatusBadge status={m.statusArte} />
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveTab("artes");
                                      showToast({
                                        type: "info",
                                        title: "Navegação rápida",
                                        description: `Direcionado para a aba de Artes do modelo: ${m.nomeModelo}`
                                      });
                                    }}
                                    className="px-3 py-1.5 bg-[#0b2f4a] dark:bg-slate-50 hover:bg-[#123f61] dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-xl text-[10px] font-bold transition shadow-sm"
                                  >
                                    Ver Arte
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB ARTES */}
        {activeTab === "artes" && (
          <div className="space-y-4">
            {isRealDbOrder ? (
              <div className="space-y-6 font-sans">
                {/* Hidden File Input */}
                <input
                  type="file"
                  id="real-arte-file-input"
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    const inputEl = e.target;
                    const modeloId = inputEl.getAttribute("data-modelo-id");
                    const nomeModelo = inputEl.getAttribute("data-nome-modelo");
                    if (!modeloId || !nomeModelo) return;

                    setUploadingModelId(modeloId);
                    showToast({
                      type: "info",
                      title: "Enviando arquivo",
                      description: `Fazendo upload de "${file.name}"...`
                    });

                    try {
                      const res = await anexarArteVersao1({
                        idInt,
                        idModelo: modeloId,
                        arquivo: file,
                        enviadoPor: user?.name || user?.email || "Operador",
                        enviadoPorUid: user?.id
                      });

                      if (res.success && res.data) {
                        showToast({
                          type: "success",
                          title: "Arte Anexada",
                          description: `Arquivo "${file.name}" anexado com sucesso como Versão 1.`
                        });
                        
                        // Recarregar artes do modelo
                        setArtesMap((prev) => ({
                          ...prev,
                          [modeloId]: [res.data!]
                        }));
                      } else {
                        showToast({
                          type: "error",
                          title: "Falha ao Salvar Arte",
                          description: res.error || "Ocorreu um erro ao salvar o registro da arte."
                        });
                      }
                    } catch (err) {
                      console.error("Erro no fluxo de upload:", err);
                      showToast({
                type: "error",
                        title: "Erro no Upload",
                        description: err instanceof Error ? err.message : "Erro inesperado."
                      });
                    } finally {
                      setUploadingModelId(null);
                      inputEl.value = ""; // Reset
                    }
                  }}
                />

                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-600" />
                    <span>Anexos e Arquivos para Design (v1)</span>
                  </h3>
                  <span className="text-xs text-slate-550 dark:text-slate-400 font-semibold bg-slate-100 dark:bg-slate-850 px-2.5 py-1 rounded-lg">
                    Consulta e Anexos Iniciais
                  </span>
                </div>

                {/* Seção de Arquivos de Apoio Gerais do Briefing da OS */}
                <div className="rounded-2xl border border-[#d7e5e8] dark:border-slate-800 bg-slate-50/50 dark:bg-slate-955/25 p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <h3 className="text-xs font-black uppercase text-[#0b2f4a] dark:text-slate-200 tracking-wider flex items-center gap-1.5">
                      <Paperclip className="h-4 w-4 text-blue-600" />
                      <span>Arquivos de Apoio / Briefing da OS (Geral)</span>
                    </h3>
                  </div>
                  {loadingSupportFiles ? (
                    <div className="text-[10px] text-slate-550 italic animate-pulse">Carregando arquivos de apoio...</div>
                  ) : supportFiles.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {supportFiles.map((file) => {
                        const fileExt = file.name.split(".").pop()?.toUpperCase() || "ARQUIVO";
                        return (
                          <div key={file.name} className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] shadow-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="h-4 w-4 text-blue-600 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-bold truncate text-slate-800 dark:text-slate-200 max-w-[130px]" title={file.name}>
                                  {file.name.substring(file.name.indexOf("_") + 1)}
                                </p>
                                <p className="text-[8px] text-slate-450">
                                  {fileExt} {file.size ? `• ${(file.size / 1024 / 1024).toFixed(2)} MB` : ""}
                                </p>
                              </div>
                            </div>
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline font-bold text-[9px] shrink-0 ml-2 flex items-center gap-0.5"
                            >
                              Download
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-450 italic">Nenhum arquivo de apoio carregado para esta OS.</p>
                  )}
                </div>

                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800/40 pb-2 pt-4">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-355 flex items-center gap-1.5">
                    <Package className="h-4 w-4 text-slate-500" />
                    <span>Artes e Anexos por Modelo / Lote</span>
                  </h4>
                </div>

                {(!pedido || !pedido.produtos || pedido.produtos.length === 0) ? (
                  <div className="rounded-3xl border border-dashed border-slate-350 bg-slate-50 dark:bg-slate-900/10 p-8 text-center">
                    <Package className="mx-auto h-12 w-12 text-slate-400" />
                    <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-200">Ainda sem produtos cadastrados</h3>
                    <p className="mt-2 text-sm text-slate-500">Esta proposta/pedido ainda não possui produtos de produção vinculados.</p>
                  </div>
                ) : (
                  pedido.produtos.map((prod) => (
                    <div key={prod.id} className="rounded-2xl border border-[#d7e5e8] dark:border-slate-800 bg-slate-50/50 dark:bg-slate-955/25 p-5 shadow-sm space-y-4">
                      {/* Cabeçalho do Produto */}
                      <div className="flex flex-wrap justify-between items-center gap-3">
                        <div className="space-y-1">
                          <span className="bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 text-[9px] font-extrabold px-2 py-0.5 rounded uppercase">PRODUTO</span>
                          <h4 className="text-lg font-black text-slate-900 dark:text-slate-100">{prod.nome}</h4>
                        </div>
                        <div className="text-xs font-semibold">
                          <span className="text-slate-400 text-[10px] uppercase block">Total contratado</span>
                          <strong className="text-blue-600 dark:text-blue-400">{prod.quantidade.toLocaleString("pt-BR")} un.</strong>
                        </div>
                      </div>

                      {/* Modelos e suas Artes */}
                      <div className="space-y-3">
                        {(prod.modelos || []).map((m) => {
                          const modelArtes = artesMap[m.id] || [];
                          const hasArte = modelArtes.length > 0;
                          const latestArte: any = hasArte ? modelArtes[modelArtes.length - 1] : null;

                          return (
                            <div key={m.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm hover:shadow-md transition">
                              <div className="space-y-1.5 min-w-[200px]">
                                <div className="flex items-center gap-2">
                                  <span className="font-extrabold text-slate-900 dark:text-slate-100">{m.nomeModelo}</span>
                                  <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-600 dark:text-slate-400 font-bold">
                                    {m.quantidade} un.
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-450 font-mono">ID do Modelo: {m.id}</p>
                                {m.observacoesTecnicas && (
                                  <p className="text-xs text-slate-500 italic">&quot;{m.observacoesTecnicas}&quot;</p>
                                )}
                              </div>

                              {/* Status e Ação de Arte */}
                              <div className="flex items-center gap-4 flex-wrap">
                                {latestArte ? (
                                  <div className="flex items-center gap-4 border border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-950/40 rounded-xl p-2 px-3">
                                    <FileText className="h-5 w-5 text-blue-600" />
                                    <div className="text-xs">
                                      <p className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[200px]" title={latestArte.nome_arquivo ?? undefined}>
                                        {latestArte.nome_arquivo}
                                      </p>
                                      <div className="flex gap-2 text-[10px] text-slate-550 font-semibold mt-0.5">
                                        <span>Versão {latestArte.versao}</span>
                                        <span>•</span>
                                        <span className="text-amber-600 dark:text-amber-400">Arte anexada — aguardando revisão</span>
                                      </div>
                                    </div>
                                    {latestArte.url_arquivo && (
                                      <a
                                        href={latestArte.url_arquivo}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-650 dark:text-slate-400 transition"
                                        title="Visualizar arquivo"
                                      >
                                        <ExternalLink className="h-4 w-4" />
                                      </a>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-xs text-slate-450 flex items-center gap-1.5">
                                    <AlertTriangle className="h-4 w-4 text-slate-400" />
                                    <span>Nenhuma arte anexada</span>
                                  </div>
                                )}

                                {!hasArte ? (
                                  <button
                                    type="button"
                                    disabled={uploadingModelId === m.id}
                                    onClick={() => {
                                      const inputEl = document.getElementById("real-arte-file-input") as HTMLInputElement;
                                      if (inputEl) {
                                        inputEl.setAttribute("data-modelo-id", m.id);
                                        inputEl.setAttribute("data-nome-modelo", m.nomeModelo);
                                        inputEl.click();
                                      }
                                    }}
                                    className="h-9.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-bold rounded-2xl transition flex items-center gap-1.5 shadow-sm"
                                  >
                                    {uploadingModelId === m.id ? (
                                      <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        <span>Enviando...</span>
                                      </>
                                    ) : (
                                      <>
                                        <Upload className="h-3.5 w-3.5" />
                                        <span>Anexar arte</span>
                                      </>
                                    )}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="h-9.5 px-4 bg-slate-100 dark:bg-slate-850 text-slate-400 dark:text-slate-655 text-xs font-bold rounded-2xl cursor-not-allowed"
                                    title="Este modelo já possui arte anexada. Versionamento será liberado em etapa futura."
                                  >
                                    Bloqueado (v1 já anexada)
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap justify-between items-center bg-slate-50 dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 gap-2">
                  <span className="text-xs font-bold text-slate-500 uppercase">Modo de Visualização da Produção</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowRealPanel(false)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                        !showRealPanel
                          ? "bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 border-slate-900"
                          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-850 dark:text-slate-400"
                      }`}
                    >
                      Simulação
                    </button>
                    <button
                      onClick={() => setShowRealPanel(true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                        showRealPanel
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-850 dark:text-slate-400"
                      }`}
                    >
                      Dados do pedido
                    </button>
                  </div>
                </div>

                {showRealPanel ? (
                  <ProducaoArtesPanel idInt={idInt} idCliente={pedido?.idCliente} />
                ) : (
                  <ModelosManagerPanel
                    idInt={idInt}
                    produtos={pedido.produtos}
                    onUploadArte={(modeloId, fileName) => uploadArteModelo(idInt, modeloId, fileName)}
                    onLiberarArte={(modeloId) => {
                      if (!canApproveArte) {
                        showToast({ type: "error", title: "Acesso Negado", description: "Você não tem permissão para liberar arte." });
                        return;
                      }
                      liberarArteModelo(idInt, modeloId);
                    }}
                    onEnviarAprovacaoCliente={(modeloId) => {
                      if (!canApproveArte) {
                        showToast({ type: "error", title: "Acesso Negado", description: "Você não tem permissão para enviar arte para aprovação." });
                        return;
                      }
                      enviarParaAprovacaoCliente(idInt, modeloId);
                    }}
                    onAdicionarComentarioInterno={(modeloId, text) => salvarComentarioInternoModelo(idInt, modeloId, text)}
                    onRegistrarDecisaoCliente={(token, status, comentario, clienteNome) => registrarDecisaoCliente(token, status, comentario, clienteNome)}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* TAB PRODUCAO */}
        {activeTab === "producao" && (
          <div className="space-y-6 font-sans">
            {/* Header de Produção */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Printer className="h-5 w-5 text-blue-600" />
                <span>Ficha Técnica Chão de Fábrica</span>
              </h3>
              <button
                type="button"
                onClick={() =>
                  showToast({
                    type: "success",
                    title: "Boletim Operacional Impresso",
                    description: "OS unificada impressa com todas as fichas técnicas integradas."
                  })
                }
                className="bg-slate-900 dark:bg-slate-50 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900 text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Imprimir OS Unificada</span>
              </button>
            </div>

            {/* Controle de Pausa da OS Unificada */}
            {!showRealPanel && (pedido.blockReason ? (
              <div className="bg-amber-50 dark:bg-amber-950/20 border-l-4 border-l-amber-500 border-y border-r border-amber-200 dark:border-amber-900/50 rounded-xl p-5 text-amber-900 dark:text-amber-200 flex flex-wrap justify-between items-center gap-4 shadow-xs">
                <div className="space-y-1">
                  <h4 className="font-extrabold text-sm flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4 text-amber-500 animate-pulse" />
                    PRODUÇÃO PAUSADA NO CHÃO DE FÁBRICA
                  </h4>
                  <p className="text-xs">
                    Motivo: <strong>&quot;{pedido.blockReason}&quot;</strong> {pedido.tempoParadoMinutos && `(há ${pedido.tempoParadoMinutos} minutos)`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    liberarPausa(idInt);
                    showToast({
                      type: "success",
                      title: "Produção Retomada",
                      description: "Pausa operacional resolvida. A produção foi liberada."
                    });
                  }}
                  className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition"
                >
                  Resolver Ocorrência / Retomar
                </button>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="font-extrabold text-sm text-slate-800 dark:text-slate-200">Sinalizar Ocorrência Operacional</h4>
                  <p className="text-xs text-slate-500">
                    Sinalize paradas ou interrupções no processo para registrar na timeline e notificar o comercial.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    id="motivo-pausa"
                    className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium focus:outline-none text-slate-800 dark:text-slate-200"
                    defaultValue=""
                  >
                    <option value="" disabled>Selecionar motivo de parada...</option>
                    <option value="Falta de papel couchê 300g">Falta de papel couchê 300g</option>
                    <option value="Falha mecânica guilhotina/corte">Falha mecânica guilhotina/corte</option>
                    <option value="Ajuste na faca de corte">Ajuste na faca de corte</option>
                    <option value="Aguardando bobina holográfica">Aguardando bobina holográfica</option>
                    <option value="Falta de fita crepe preta">Falta de fita crepe preta</option>
                    <option value="Aguardando aprovação de material adicional">Aguardando aprovação de material adicional</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const select = document.getElementById("motivo-pausa") as HTMLSelectElement;
                      const motivo = select.value;
                      if (!motivo) {
                        showToast({
                          type: "warning",
                          title: "Motivo obrigatório",
                          description: "Selecione um motivo de parada válido antes de pausar a produção."
                        });
                        return;
                      }
                      pausarProducao(idInt, motivo);
                      showToast({
                        type: "warning",
                        title: "Produção Pausada",
                        description: `OS pausada por: ${motivo}`
                      });
                    }}
                    className="h-9 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-xl transition"
                  >
                    Pausar OS
                  </button>
                </div>
              </div>
            ))}

            {/* Listagem de Fichas por Produto/Modelo */}
            <div className="space-y-6">
              {!pedido.produtos || pedido.produtos.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-350 bg-slate-50 dark:bg-slate-900/10 p-8 text-center">
                  <FileText className="mx-auto h-12 w-12 text-slate-400" />
                  <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-200">Ainda sem modelos/lotes cadastrados</h3>
                  <p className="mt-2 text-sm text-slate-500">Esta proposta/pedido ainda não possui modelos de produção vinculados.</p>
                </div>
              ) : (
                pedido.produtos.map((prod) => (
                  <div key={prod.id} className="bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                  {/* Cabeçalho do Produto */}
                  <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">GRUPO DE MODELOS</span>
                      <h4 className="text-base font-extrabold text-slate-800 dark:text-slate-200">{prod.nome}</h4>
                    </div>
                    <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold px-3 py-1 rounded-full">
                      {(prod.modelos || []).length} Modelo(s)
                    </span>
                  </div>

                  {/* Lista de Fichas Técnicas por Modelo */}
                  <div className="grid gap-5">
                    {(prod.modelos || []).map((m) => {
                      const isLocked = Boolean(pedido.blockReason) || pedido.financialBlock;
                      return (
                        <div key={m.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-xs space-y-4">
                          {/* Cabeçalho do Modelo */}
                          <div className="flex flex-wrap justify-between items-center gap-3 bg-slate-100/60 dark:bg-slate-950/40 p-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-800">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-slate-500 dark:text-slate-400 text-xs font-mono">ID: {m.id}</span>
                              <h5 className="font-black text-sm text-slate-900 dark:text-slate-100">{m.nomeModelo}</h5>
                              <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded font-extrabold text-[9px] uppercase tracking-wider">
                                {m.setor}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <span className="text-[9px] text-slate-400 uppercase font-bold block">Quantidade</span>
                                <strong className="text-xs font-extrabold text-blue-600 dark:text-blue-400 font-mono">{m.quantidade.toLocaleString("pt-BR")} un.</strong>
                              </div>
                              
                              <div className="h-5 w-px bg-slate-200 dark:bg-slate-800"></div>

                              <div className="flex gap-1.5">
                                <StatusBadge status={m.statusArte} />
                                <StatusBadge status={m.statusProducao} />
                              </div>
                            </div>
                          </div>

                          {/* Grid de Parâmetros Técnicos - Chão de Fábrica */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-slate-100 dark:border-slate-850 text-xs">
                            {/* Col 1: Numeração */}
                            <div className="space-y-2 border-b sm:border-b-0 sm:border-r border-dashed border-slate-200 dark:border-slate-800 pb-3 sm:pb-0 sm:pr-4">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">1. NUMERAÇÃO</span>
                              <div className="space-y-1 text-[11px]">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Tipo:</span>
                                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                    {m.configImpressao.tipoNumeracao === "SEM_NUMERACAO" ? "Sem Numeração" :
                                     m.configImpressao.tipoNumeracao === "SEQUENCIAL" ? "Sequencial" :
                                     m.configImpressao.tipoNumeracao === "ALEATORIO" ? "Aleatória (VDP)" : m.configImpressao.tipoNumeracao}
                                  </span>
                                </div>
                                {m.configImpressao.tipoNumeracao !== "SEM_NUMERACAO" && (
                                  <>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Início:</span>
                                      <span className="font-mono font-bold text-blue-700 dark:text-blue-400">
                                        {m.numeracaoInicial !== undefined ? String(m.numeracaoInicial).padStart(6, '0') : "000001"}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Fim:</span>
                                      <span className="font-mono font-bold text-blue-700 dark:text-blue-400">
                                        {m.numeracaoFinal !== undefined ? String(m.numeracaoFinal).padStart(6, '0') : String(m.quantidade).padStart(6, '0')}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Col 2: QR & Barcode (Codificação) */}
                            <div className="space-y-2 border-b sm:border-b-0 sm:border-r border-dashed border-slate-200 dark:border-slate-800 pb-3 sm:pb-0 sm:px-2 md:px-4">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">2. CODIFICAÇÃO (VDP)</span>
                              <div className="space-y-2 text-[11px]">
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 flex items-center gap-1">
                                    <QrCode className="h-3.5 w-3.5 text-slate-400" />
                                    QR Code:
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                    m.configImpressao.qrCode 
                                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900" 
                                      : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                                  }`}>
                                    {m.configImpressao.qrCode ? "ATIVO" : "NÃO"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 flex items-center gap-1">
                                    <Barcode className="h-3.5 w-3.5 text-slate-400" />
                                    Barcode:
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                    m.configImpressao.codBarras 
                                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900" 
                                      : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                                  }`}>
                                    {m.configImpressao.codBarras ? `${m.configImpressao.codBarrasTipo || "ATIVO"}` : "NÃO"}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Col 3: Suprimentos & Acabamento */}
                            <div className="space-y-2 border-b sm:border-b-0 sm:border-r border-dashed border-slate-200 dark:border-slate-800 pb-3 sm:pb-0 sm:px-2 md:px-4">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">3. SUPRIMENTO / LAYOUT</span>
                              <div className="space-y-1 text-[11px]">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Cor Material:</span>
                                  <span className="font-bold text-slate-800 dark:text-slate-200">{m.corMaterial || "Padrão"}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Verso Impresso:</span>
                                  <span className={`font-bold ${m.verso ? "text-purple-600 dark:text-purple-400" : "text-slate-600 dark:text-slate-400"}`}>
                                    {m.verso ? "SIM (Frente/Verso)" : "NÃO (Só Frente)"}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Bloco/Pacotes:</span>
                                  <span className="font-bold text-slate-800 dark:text-slate-200">{m.bloco || "Avulso"}</span>
                                </div>
                              </div>
                            </div>

                            {/* Col 4: Arquivo CSV / Dados Variáveis */}
                            <div className="space-y-2 pt-2 sm:pt-0 sm:pl-4">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">4. PLANILHA DE DADOS (VDP)</span>
                              <div className="pt-0.5">
                                {m.csvDadosVariaveisUrl ? (
                                  <a
                                    href={m.csvDadosVariaveisUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-900 font-bold transition w-full justify-center text-[10px]"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                    <span>Download CSV (VDP)</span>
                                  </a>
                                ) : (
                                  <div className="text-center py-2 text-slate-400 dark:text-slate-600 italic border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-900/10">
                                    Sem planilha VDP
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Observações Técnicas */}
                          {m.observacoesTecnicas && (
                            <div className="p-3 bg-amber-50/40 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/40 rounded-xl text-[11px] text-slate-700 dark:text-slate-300 flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-extrabold text-[9px] text-amber-600 uppercase block tracking-wider mb-0.5">Observações Técnicas do Modelo</span>
                                <p className="italic leading-relaxed">&quot;{m.observacoesTecnicas}&quot;</p>
                              </div>
                            </div>
                          )}

                          {/* Operação de Chão de Fábrica */}
                          <div className="flex justify-end items-center gap-3 pt-1">
                            {m.statusArte !== "LIBERADA" ? (
                              <div className="text-[10px] font-extrabold text-red-700 dark:text-red-300 bg-red-100/70 dark:bg-red-950/40 p-2 px-3.5 rounded-xl border border-red-300 dark:border-red-900 text-center select-none flex items-center gap-1.5">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>PRODUÇÃO BLOQUEADA: AGUARDANDO LIBERAÇÃO DA ARTE</span>
                              </div>
                            ) : isLocked ? (
                              <div className="text-[10px] font-extrabold text-amber-700 dark:text-amber-300 bg-amber-100/75 dark:bg-amber-950/40 p-2 px-3.5 rounded-xl border border-amber-300 dark:border-amber-900 text-center select-none flex items-center gap-1.5 animate-pulse">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>PRODUÇÃO SUSPENSA: OS PAUSADA OU BLOQUEIO FINANCEIRO</span>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                {m.statusProducao === "PENDENTE" && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      iniciarImpressaoModelo(pedido.id_int, m.id);
                                      showToast({
                                        type: "info",
                                        title: "Impressão Iniciada",
                                        description: `Lote "${m.nomeModelo}" em impressão física.`
                                      });
                                    }}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl transition text-[11px] flex items-center gap-1.5 shadow-sm"
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                    <span>Iniciar Impressão Física</span>
                                  </button>
                                )}
                                {m.statusProducao === "EM_IMPRESSAO" && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      finalizarImpressaoModelo(pedido.id_int, m.id);
                                      showToast({
                                        type: "success",
                                        title: "Impressão Concluída",
                                        description: `Lote "${m.nomeModelo}" enviado para o Acabamento.`
                                      });
                                    }}
                                    className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-xl transition text-[11px] flex items-center gap-1.5 shadow-sm"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    <span>Concluir Impressão / Enviar Acabamento</span>
                                  </button>
                                )}
                                {(m.statusProducao === "EM_ACABAMENTO" || m.statusProducao === "CONCLUIDA") && (
                                  <span className="text-teal-600 dark:text-teal-400 font-extrabold flex items-center gap-1.5 py-1.5 px-3 bg-teal-50 dark:bg-teal-950/20 border border-teal-100 dark:border-teal-900 rounded-xl text-[11px]">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    <span>Lote Concluído no Chão de Fábrica</span>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )))
              }
            </div>
          </div>
        )}

        {/* TAB EXPEDIÇÃO */}
        {activeTab === "expedicao" && (showRealPanel ? (
          <div className="rounded-3xl border border-dashed border-slate-350 bg-slate-50 dark:bg-slate-900/10 p-8 text-center font-sans">
            <Truck className="mx-auto h-12 w-12 text-slate-400" />
            <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-200">Expedição ainda não iniciada</h3>
            <p className="mt-2 text-sm text-slate-500">Este pedido aguarda a conclusão das etapas de produção e faturamento.</p>
          </div>
        ) : (() => {
          const totalPesoReal = volumesList.reduce((acc, v) => acc + (Number(v.peso) || 0), 0);
          const desvioPesoReal = pedido.pesoTeorico === 0 ? 0 : Math.abs(totalPesoReal - pedido.pesoTeorico) / pedido.pesoTeorico;
          const isPesoDivergenteReal = desvioPesoReal > 0.05;
          const isChecklistCompleto = Object.values(checklist).every(Boolean);

          return (
            <div className={`space-y-6 font-sans ${modoGalpao ? "text-slate-900 dark:text-slate-100" : ""}`}>
              {/* Header Operacional */}
              <div className="flex flex-wrap items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 gap-2">
                <div>
                  <h3 className={`font-black flex items-center gap-2 text-slate-900 dark:text-slate-100 ${modoGalpao ? "text-2xl" : "text-lg"}`}>
                    <Scale className="h-6 w-6 text-slate-900" />
                    <span>EXPEDIÇÃO & PESAGEM OPERACIONAL</span>
                  </h3>
                  <p className={`text-slate-500 font-semibold ${modoGalpao ? "text-sm" : "text-xs"}`}>
                    Conferência física, fracionamento de volumes e validação de peso na balança integrada.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModoGalpao(!modoGalpao)}
                  className={`px-4 py-2 rounded-xl font-bold text-xs transition duration-150 flex items-center gap-1.5 border uppercase tracking-wider ${
                    modoGalpao
                      ? "bg-amber-500 hover:bg-amber-600 text-slate-950 border-amber-500 animate-pulse shadow-md"
                      : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-800 dark:text-slate-400"
                  }`}
                >
                  <HardDrive className="h-4 w-4" />
                  <span>{modoGalpao ? "Modo TV / Galpão Ativo" : "Ativar Modo TV / Galpão"}</span>
                </button>
              </div>

              {/* Box de Simulações Operacionais */}
              <div className="bg-slate-100/50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Simulador de Eventos e Ocorrências Reais
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => simularCenarioLogistico("peso_divergente")}
                    className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-950/20 dark:hover:bg-red-950/45 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl text-xs font-bold transition"
                  >
                    ⚠️ Peso Divergente (&gt; 5%)
                  </button>
                  <button
                    type="button"
                    onClick={() => simularCenarioLogistico("despacho_parcial")}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/20 dark:hover:bg-blue-950/45 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 rounded-xl text-xs font-bold transition"
                  >
                    📦 Pedido Parcial (3 Volumes)
                  </button>
                  <button
                    type="button"
                    onClick={() => simularCenarioLogistico("retirada_balcao")}
                    className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:hover:bg-amber-950/45 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs font-bold transition"
                  >
                    🚶 Retirada Balcão (Urgente)
                  </button>
                  <button
                    type="button"
                    onClick={() => simularCenarioLogistico("sedex_completo")}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/45 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-bold transition"
                  >
                    ✅ SEDEX Completo (Ok)
                  </button>
                </div>
              </div>

              {/* Grid Principal */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Lado Esquerdo: Dados Envio, Checklist e Balança */}
                <div className="lg:col-span-5 space-y-6">
                  
                  {/* Card 1: Dados do Envio */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
                    <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Truck className="h-4 w-4 text-blue-600" />
                      Dados do Envio
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase block">Tipo de Envio</label>
                        <select
                          value={tipoEnvio}
                          onChange={(e) => {
                            setTipoEnvio(e.target.value);
                            if (e.target.value === "Retirada") {
                              setTransportadoraLog("Retirada Balcão");
                            }
                          }}
                          className="w-full h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none"
                        >
                          <option value="Correios">Correios</option>
                          <option value="Transportadora">Transportadora</option>
                          <option value="Motoboy">Motoboy</option>
                          <option value="Retirada">Retirada / Balcão</option>
                          <option value="Excursão">Excursão / Ônibus</option>
                          <option value="Cliente próprio">Cliente Próprio</option>
                        </select>
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase block">Transportadora</label>
                        <input
                          type="text"
                          value={transportadoraLog}
                          onChange={(e) => setTransportadoraLog(e.target.value)}
                          placeholder="Correios, Jadlog, etc..."
                          className="w-full h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-950/30 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-bold uppercase text-[9px]">Cliente</span>
                        <strong className="text-slate-700 dark:text-slate-300">{pedido.clienteNome}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-bold uppercase text-[9px]">Previsão de Despacho</span>
                        <strong className="text-slate-700 dark:text-slate-300">
                          {pedido.dataPrevistaEntrega ? formatDate(pedido.dataPrevistaEntrega) : "—"}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-bold uppercase text-[9px]">Endereço Simplificado</span>
                        <strong className="text-slate-700 dark:text-slate-300 text-right truncate max-w-[200px]" title="Rua das Palmeiras, 456 - São Paulo / SP">
                          Rua das Palmeiras, 456 - SP
                        </strong>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase block">Observações Logísticas</label>
                      <textarea
                        value={obsLogistica}
                        onChange={(e) => setObsLogistica(e.target.value)}
                        placeholder="Observações especiais..."
                        className="w-full h-16 p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none resize-none"
                      />
                    </div>
                  </div>

                  {/* Card 2: Checklist Operacional */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
                    <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <ClipboardList className="h-4 w-4 text-blue-600" />
                      Conferência Checklist
                    </h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(Object.keys(checklist) as Array<keyof typeof checklist>).map((key) => {
                        const labels: Record<string, string> = {
                          arte: "Arte Final Homologada",
                          quantidades: "Quantidades Batidas",
                          acabamento: "Acabamento Perfeito",
                          peso: "Peso Balança Ok",
                          etiqueta: "Etiqueta Despacho Ok",
                          notaFrete: "NF-e / Frete Pago"
                        };
                        return (
                          <label
                            key={key}
                            className={`flex items-center gap-3 p-3 rounded-2xl border transition cursor-pointer select-none ${
                              checklist[key]
                                ? "bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-300 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 font-extrabold"
                                : "bg-slate-50/50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checklist[key]}
                              onChange={(e) => setChecklist(prev => ({ ...prev, [key]: e.target.checked }))}
                              className="h-4 w-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                            />
                            <span className="text-[11px] uppercase tracking-wide leading-tight">{labels[key]}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Card 3: Balança / Comparação de Peso */}
                  <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm ${
                    modoGalpao ? "border-amber-400" : ""
                  }`}>
                    <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Scale className="h-4 w-4 text-blue-600" />
                      Balança Digital
                    </h4>

                    {/* Comparativo de peso */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-50 dark:bg-slate-950/40 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 text-center space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block tracking-wider">Peso Teórico (Estimado)</span>
                        <strong className={`font-mono block text-slate-900 dark:text-blue-400 ${modoGalpao ? "text-3xl" : "text-xl"}`}>
                          {pedido.pesoTeorico.toFixed(2)} <span className="text-xs">kg</span>
                        </strong>
                      </div>
                      
                      <div className={`p-3.5 rounded-2xl border text-center space-y-1 ${
                        isPesoDivergenteReal 
                          ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-700 dark:text-red-400"
                          : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
                      }`}>
                        <span className="text-[10px] font-bold uppercase block tracking-wider">Peso Real Aferido</span>
                        <strong className={`font-mono block ${modoGalpao ? "text-3xl" : "text-xl"}`}>
                          {totalPesoReal.toFixed(2)} <span className="text-xs">kg</span>
                        </strong>
                      </div>
                    </div>

                    {/* Desvio do Peso e Validação */}
                    <div className="text-xs space-y-2">
                      <div className="flex justify-between font-bold text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <span>Divergência:</span>
                        <span className={isPesoDivergenteReal ? "text-red-600 dark:text-red-400 font-extrabold animate-pulse" : "text-emerald-600 dark:text-emerald-400 font-bold"}>
                          {totalPesoReal === 0 ? "0.0%" : `${(desvioPesoReal * 100).toFixed(1)}%`} {isPesoDivergenteReal ? "(Fora da Tolerância)" : "(Tolerado ≤ 5.0%)"}
                        </span>
                      </div>
                      
                      {/* Alerta de Divergência Crítica */}
                      {isPesoDivergenteReal && totalPesoReal > 0 && (
                        <div className="bg-red-600 text-white font-black rounded-2xl p-4 text-center space-y-1.5 animate-bounce shadow-lg">
                          <h5 className="text-xs uppercase tracking-widest flex items-center justify-center gap-1.5">
                            <AlertCircle className="h-5 w-5 text-white animate-spin" />
                            DIVERGÊNCIA CRÍTICA DE PESO!
                          </h5>
                          <p className="text-[10px] font-normal leading-normal">
                            O peso real ultrapassou o limite de 5% de tolerância. Verifique se faltam itens ou se colocou material incorreto. Despacho total bloqueado.
                          </p>
                        </div>
                      )}

                      {!isPesoDivergenteReal && totalPesoReal > 0 && (
                        <div className="bg-emerald-50 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-400 font-extrabold rounded-2xl p-3 text-center text-[10px] uppercase tracking-wider flex items-center justify-center gap-1">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          <span>Peso validado com sucesso! Pronto para despacho.</span>
                        </div>
                      )}
                    </div>
                  </div>

                </div>

                {/* Lado Direito: Gestão de Volumes */}
                <div className="lg:col-span-7 space-y-6">
                  
                  {/* Card 4: Gestão de Volumes */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
                    
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                      <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Package className="h-4 w-4 text-blue-600" />
                        Volumes (Caixas / Volumes de Envio)
                      </h4>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Qtd Volumes:</span>
                        <input
                          type="number"
                          min="1"
                          max="15"
                          value={volumes}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(15, Number(e.target.value) || 1));
                            setVolumes(val);
                          }}
                          className="w-12 h-7 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-bold text-center text-slate-800 dark:text-slate-200 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Lista de Volumes Grid */}
                    <div className={`grid gap-4 ${modoGalpao ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
                      {volumesList.map((vol) => {
                        const isVolDespachado = vol.status === "despachado";
                        const isVolConferido = vol.status === "conferido";
                        const isVolEmbalado = vol.status === "embalado";
                        
                        return (
                          <div
                            key={vol.id}
                            className={`border rounded-2xl p-4 space-y-3 transition duration-150 relative ${
                              isVolDespachado 
                                ? "bg-slate-50/50 dark:bg-slate-950/20 border-slate-200 dark:border-slate-800 opacity-60" 
                                : isVolConferido
                                  ? "bg-emerald-50/10 dark:bg-emerald-950/5 border-emerald-300 dark:border-emerald-900"
                                  : isVolEmbalado
                                    ? "bg-blue-50/10 dark:bg-blue-950/5 border-blue-300 dark:border-blue-900"
                                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                            } ${modoGalpao ? "p-5 border-2" : ""}`}
                          >
                            {/* Caixa header */}
                            <div className="flex justify-between items-center">
                              <span className={`font-black uppercase tracking-wider ${modoGalpao ? "text-base text-slate-800 dark:text-slate-100" : "text-xs text-slate-500"}`}>
                                📦 CAIXA {vol.id} de {volumes}
                              </span>
                              
                              {/* Selector de status do volume */}
                              <select
                                disabled={isVolDespachado}
                                value={vol.status}
                                onChange={(e) => atualizarStatusVolume(vol.id, e.target.value as typeof volumesList[0]["status"])}
                                className={`h-7 px-1.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-[10px] font-bold focus:outline-none text-slate-800 dark:text-slate-200 cursor-pointer ${
                                  modoGalpao ? "text-xs h-8 px-2" : ""
                                }`}
                              >
                                <option value="aguardando">Aguardando</option>
                                <option value="embalado">Embalado</option>
                                <option value="conferido">Conferido</option>
                                <option value="despachado">Despachado</option>
                              </select>
                            </div>

                            {/* Inputs de Peso e Descrição */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Peso Real (kg)</label>
                                <input
                                  type="text"
                                  disabled={isVolDespachado}
                                  placeholder="0.00"
                                  value={vol.peso}
                                  onChange={(e) => atualizarPesoVolume(vol.id, e.target.value)}
                                  className={`w-full h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-mono font-bold focus:outline-none text-slate-800 dark:text-slate-100 ${
                                    modoGalpao ? "text-sm h-10" : ""
                                  }`}
                                />
                              </div>
                              
                              <div className="space-y-1">
                                <label className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Conteúdo / Obs</label>
                                <input
                                  type="text"
                                  disabled={isVolDespachado}
                                  value={vol.observacao}
                                  onChange={(e) => atualizarObsVolume(vol.id, e.target.value)}
                                  placeholder="Descrição do lote..."
                                  className={`w-full h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-medium focus:outline-none text-slate-800 dark:text-slate-200 ${
                                    modoGalpao ? "text-sm h-10" : ""
                                  }`}
                                />
                              </div>
                            </div>

                            {/* Indicador Visual do Status */}
                            <div className="flex justify-between items-center text-[10px] border-t border-slate-100 dark:border-slate-800 pt-2">
                              <span className="text-slate-400 font-semibold uppercase text-[9px]">Status Caixa:</span>
                              <span className={`font-black px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wider ${
                                isVolDespachado 
                                  ? "bg-slate-200 dark:bg-slate-800 text-slate-500" 
                                  : isVolConferido
                                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900"
                                    : isVolEmbalado
                                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-900"
                                      : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                              }`}>
                                {vol.status}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Card 5: Ações do Despacho Operacional */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
                    <h4 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <HardDrive className="h-4 w-4 text-blue-600" />
                      Operação e Despacho Logístico
                    </h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      
                      {/* Despacho Parcial */}
                      <div className="bg-slate-50 dark:bg-slate-950/20 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
                        <div className="space-y-1">
                          <h5 className="font-extrabold text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider">Despacho Parcial</h5>
                          <p className="text-[10px] text-slate-500 leading-normal">
                            Libera apenas os volumes que já estão como EMBALADO ou CONFERIDO. O pedido permanece ativo na fila e o histórico registra a entrega fracionada.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => executarDespachoExpedicao("parcial")}
                          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 font-bold py-2 px-3 rounded-xl transition text-[11px] uppercase tracking-wider flex items-center justify-center gap-1 border border-slate-300 dark:border-slate-700"
                        >
                          <Package className="h-3.5 w-3.5" />
                          <span>Despachar Parcial</span>
                        </button>
                      </div>

                      {/* Despacho Total */}
                      <div className={`p-4 rounded-2xl border flex flex-col justify-between space-y-3 ${
                        isPesoDivergenteReal || !isChecklistCompleto
                          ? "bg-red-500/5 dark:bg-red-950/5 border-red-200 dark:border-red-950/40"
                          : "bg-emerald-500/5 dark:bg-emerald-950/5 border-emerald-200 dark:border-emerald-950/40"
                      }`}>
                        <div className="space-y-1">
                          <h5 className="font-extrabold text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider">Despacho Total</h5>
                          <p className="text-[10px] text-slate-500 leading-normal">
                            Finaliza a entrega de todas as caixas. Requer checklist operacional 100% marcado e peso aferido dentro dos 5% de tolerância de segurança.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isPesoDivergenteReal || !isChecklistCompleto}
                          onClick={() => executarDespachoExpedicao("total")}
                          className={`w-full font-extrabold py-2 px-3 rounded-xl transition text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm ${
                            isPesoDivergenteReal || !isChecklistCompleto
                              ? "bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed border border-slate-300 dark:border-slate-800"
                              : "bg-emerald-600 hover:bg-emerald-700 text-white"
                          }`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>{tipoEnvio === "Retirada" ? "Confirmar Retirada Balcão" : "Confirmar Despacho Total"}</span>
                        </button>
                      </div>

                    </div>
                  </div>

                </div>

              </div>
            </div>
          );
        })())}

        {/* TAB TIMELINE */}
        {activeTab === "timeline" && (
          <div className="space-y-6 font-sans text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-blue-600" />
                <span>Histórico de Comunicação & Ocorrências</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-bold uppercase">Memória Operacional do Pedido</span>
            </div>

            {/* Filtros rápidos */}
            <div className="flex flex-wrap gap-1.5 pb-2">
              {(["Tudo", "Comercial", "Design", "Produção", "Expedição", "Financeiro", "Sistema"] as const).map((filter) => {
                const count = chatMessages.filter(m => {
                  if (filter === "Tudo") return true;
                  const setor = m.setor?.toLowerCase() || "";
                  const f = filter.toLowerCase();
                  if (f === "design") return setor === "design" || setor === "arte";
                  return setor === f;
                }).length;
                
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setTimelineFilter(filter)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border ${
                      timelineFilter === filter
                        ? "bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 border-slate-900"
                        : "bg-white hover:bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-800 dark:text-slate-400"
                    }`}
                  >
                    <span>{filter}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                      timelineFilter === filter
                        ? "bg-white/20 text-white dark:bg-slate-900/50"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* List of messages with vertical timeline connection */}
            <div className="relative border-l border-slate-200 dark:border-slate-800 pl-4 py-2 space-y-4 max-h-[400px] overflow-y-auto pr-2">
              {chatMessages.filter(msg => {
                if (timelineFilter === "Tudo") return true;
                const setor = msg.setor?.toLowerCase() || "";
                const f = timelineFilter.toLowerCase();
                if (f === "design") return setor === "design" || setor === "arte";
                return setor === f;
              }).map((msg: MockChatMessage) => {
                const isCritical = msg.mensagem.includes("⚠️") || msg.mensagem.includes("❌") || msg.mensagem.includes("bloqueado") || msg.mensagem.includes("DIVERGÊNCIA") || msg.mensagem.toLowerCase().includes("reprovada");
                const isSuccess = msg.mensagem.includes("✅") || msg.mensagem.includes("concluída") || msg.mensagem.includes("liberada") || msg.mensagem.includes("sucesso");
                
                return (
                  <div key={msg.id} className="relative group">
                    {/* Bullet Point Node on the line */}
                    <div className={`absolute -left-[22px] top-2 h-2.5 w-2.5 rounded-full border bg-white dark:bg-slate-950 z-10 transition duration-150 ${
                      isCritical ? "border-red-500 bg-red-500" :
                      isSuccess ? "border-teal-500 bg-teal-500" : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    }`}></div>

                    {/* Ficha de Evento */}
                    <div className={`rounded-xl border p-3 text-xs space-y-1.5 transition ${
                      isCritical 
                        ? "border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20 text-red-700 dark:text-red-200 font-semibold" 
                        : isSuccess
                          ? "border-teal-200 bg-teal-50/20 dark:border-teal-900/30 dark:bg-teal-950/10 text-slate-800 dark:text-slate-200"
                          : "border-slate-200 bg-slate-50/40 dark:border-slate-800/60 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300"
                    }`}>
                      {/* Event Header */}
                      <div className="flex justify-between items-center text-[10px]">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded font-extrabold uppercase border text-[9px] tracking-wider ${getSectorBadgeStyles(msg.setor)}`}>
                            {msg.setor}
                          </span>
                          <span className="font-extrabold text-slate-850 dark:text-slate-200">
                            {msg.autor_nome}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-400 font-mono text-[9px]">
                          <Clock className="h-3 w-3" />
                          <span>{new Date(msg.created_at).toLocaleTimeString("pt-BR")} — {new Date(msg.created_at).toLocaleDateString("pt-BR")}</span>
                        </div>
                      </div>

                      {/* Event Message */}
                      <p className="leading-relaxed whitespace-pre-wrap font-medium text-slate-700 dark:text-slate-300">
                        {msg.mensagem}
                      </p>

                      {/* Attachments */}
                      {msg.anexos && msg.anexos.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-850 mt-1">
                          {msg.anexos.map((anexo: { name: string; url: string }, idx: number) => (
                            <a
                              key={idx}
                              href={anexo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 text-[10px] text-blue-600 dark:text-blue-400 border border-slate-205 dark:border-slate-800 flex items-center gap-1 font-bold transition"
                            >
                              📎 {anexo.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Campo de Mensagem Manual Mockado */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
              <span className="text-[10px] font-bold text-slate-450 uppercase block tracking-wider">Inserir Mensagem Manual na Timeline</span>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Autor (Quem envia):</label>
                  <input
                    type="text"
                    value={typedAuthor}
                    onChange={(e) => setTypedAuthor(e.target.value)}
                    placeholder="Ex: Atendente Comercial"
                    className="w-full h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Setor Responsável:</label>
                  <select
                    value={selectedSector}
                    onChange={(e) => setSelectedSector(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                  >
                    <option value="Comercial">Comercial</option>
                    <option value="Design">Design</option>
                    <option value="Produção">Produção</option>
                    <option value="Expedição">Expedição</option>
                    <option value="Financeiro">Financeiro</option>
                    <option value="Sistema">Sistema</option>
                  </select>
                </div>
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Texto da Mensagem:</label>
                  <div className="flex gap-2">
                    <textarea
                      placeholder="Descreva a ocorrência, diálogo comercial ou atualização técnica..."
                      value={typedMessage}
                      onChange={(e) => setTypedMessage(e.target.value)}
                      className="flex-1 h-12 px-3 py-2 border border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-900 rounded-xl text-xs resize-none focus:outline-none text-slate-800 dark:text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleSendMessage}
                      className="bg-[#0b2f4a] hover:bg-[#123f61] text-white text-xs font-bold px-5 rounded-xl transition flex items-center justify-center shrink-0 self-end h-10 shadow-xs"
                    >
                      Enviar Nota
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
