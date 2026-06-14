"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppToast } from "@/components/common/AppToast";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { EmptyState } from "@/components/common/EmptyState";
import { listarPedidosProducao } from "./services/pedidos-producao.service";
import type { PedidoProducaoListItem } from "./types";
import {
  Flame,
  AlertCircle,
  Eye,
  ArrowLeft,
  ArrowRight,
  Tv,
  Minimize2,
  Lock,
  PauseCircle,
  PlayCircle,
  Search,
  MessageSquare,
  RefreshCw,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Wrench,
  FileText,
  Calendar,
  Clock
} from "lucide-react";
import { PedidoMock, PedidoStatus } from "./types";
import { formatDate } from "@/lib/formatters/date";

const COLUNAS_KANBAN: { label: string; statusList: PedidoStatus[] }[] = [
  { label: "Novo / Boletim", statusList: ["NOVO"] },
  { label: "Arte", statusList: ["ARTE_EM_ANDAMENTO"] },
  { label: "Aprovação Cliente", statusList: ["AGUARDANDO_APROVACAO_CLIENTE"] },
  { label: "Aguardando OS", statusList: ["AGUARDANDO_APROVACAO_ATENDENTE", "AGUARDANDO_OS"] },
  { label: "Impressão", statusList: ["EM_IMPRESSAO"] },
  { label: "Acabamento", statusList: ["EM_ACABAMENTO"] },
  { label: "Revisão", statusList: ["REVISAO_FINAL"] },
  { label: "Expedição", statusList: ["PRONTO_EXPEDICAO"] },
  { label: "Finalizado", statusList: ["EXPEDIDO", "CANCELADO"] }
];

const getPrazoStatus = (pedido: PedidoMock) => {
  if (pedido.statusPedido === "EXPEDIDO" || pedido.statusPedido === "CANCELADO") {
    return { label: "CONCLUÍDO", color: "text-slate-400 bg-slate-100 dark:bg-slate-800 dark:text-slate-500", isLate: false };
  }
  const deliveryDate = new Date(pedido.dataPrevistaEntrega + "T00:00:00");
  const today = new Date("2026-06-02T00:00:00");
  const diffTime = deliveryDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return {
      label: `ATRASADO ${Math.abs(diffDays)}d (${formatDate(pedido.dataPrevistaEntrega)})`,
      color: "text-white bg-red-600 dark:bg-red-700 animate-pulse font-extrabold",
      isLate: true
    };
  } else if (diffDays === 0) {
    return {
      label: `ENTREGA HOJE`,
      color: "text-white bg-amber-600 dark:bg-amber-700 font-extrabold",
      isLate: false
    };
  } else if (diffDays === 1) {
    return {
      label: `ENTREGA AMANHÃ`,
      color: "text-amber-800 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 font-extrabold",
      isLate: false
    };
  }
  return {
    label: `PRAZO: ${formatDate(pedido.dataPrevistaEntrega)}`,
    color: "text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-350 font-bold",
    isLate: false
  };
};

export function PedidosKanbanPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { openChat } = useGlobalChat();
  const [pedidos, setPedidos] = useState<PedidoProducaoListItem[]>([]);

  useEffect(() => {
    async function load() {
      const data = await listarPedidosProducao();
      setPedidos(data);
    }
    void load();
  }, []);

  /* eslint-disable @typescript-eslint/no-unused-vars */
  const moverEtapaPedido = (idInt: number, status: string) => {};
  const toggleUrgente = (idInt: number) => {};
  const pausarProducao = (idInt: number, reason: string) => {};
  const liberarPausa = (idInt: number) => {};
  /* eslint-enable @typescript-eslint/no-unused-vars */

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterEmpresa, setFilterEmpresa] = useState("all");
  const [isPauseModalOpen, setIsPauseModalOpen] = useState(false);
  const [selectedPedidoId, setSelectedPedidoId] = useState<number | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [isCompact, setIsCompact] = useState(false);
  const [sortBy, setSortBy] = useState<"recente" | "antigo" | "valor" | "urgente">("recente");
  const [activeFilter, setActiveFilter] = useState<"all" | "atrasado" | "urgente" | "arte" | "producao" | "expedicao" | "aguardando_cliente" | "bloqueado" | "hoje" | "semana">("all");

  // Keydown listener for global shortcuts
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
      } else if (key === "i") {
        router.push("/pedidos/impressao");
      } else if (key === "u") {
        setActiveFilter(prev => prev === "urgente" ? "all" : "urgente");
        showToast({
          type: "info",
          title: "Filtro Rápido",
          description: "Pedidos urgentes filtrados via atalho de teclado."
        });
      } else if (key === "escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [router, isFullscreen, showToast]);

  const resetLocalStorage = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("erp_ideal_mock_pedidos_db");
      window.location.reload();
      showToast({
        type: "info",
        title: "Banco resetado",
        description: "Os dados do protótipo de UX foram restaurados para os originais."
      });
    }
  };

  const handleMoveLeft = (pedido: PedidoMock, currentColIdx: number) => {
    if (currentColIdx === 0) return;
    const targetCol = COLUNAS_KANBAN[currentColIdx - 1];
    const targetStatus = targetCol.statusList[0];
    moverEtapaPedido(pedido.id_int, targetStatus);
    showToast({
      type: "success",
      title: "Pedido movido",
      description: `Pedido #${pedido.id_int} retrocedeu para a etapa de ${targetCol.label}.`
    });
  };

  const handleMoveRight = (pedido: PedidoMock, currentColIdx: number) => {
    if (currentColIdx === COLUNAS_KANBAN.length - 1) return;
    const targetCol = COLUNAS_KANBAN[currentColIdx + 1];
    const targetStatus = targetCol.statusList[0];
    moverEtapaPedido(pedido.id_int, targetStatus);
    showToast({
      type: "success",
      title: "Pedido movido",
      description: `Pedido #${pedido.id_int} avançou para a etapa de ${targetCol.label}.`
    });
  };

  const handlePauseToggle = (pedido: PedidoMock) => {
    if (pedido.blockReason) {
      liberarPausa(pedido.id_int);
      showToast({
        type: "success",
        title: "Pedido Liberado",
        description: "Pausa operacional resolvida."
      });
    } else {
      setSelectedPedidoId(pedido.id_int);
      setPauseReason("");
      setIsPauseModalOpen(true);
    }
  };

  const submitPausa = () => {
    if (selectedPedidoId !== null && pauseReason.trim()) {
      pausarProducao(selectedPedidoId, pauseReason);
      setIsPauseModalOpen(false);
      setSelectedPedidoId(null);
      showToast({
        type: "warning",
        title: "Produção Pausada",
        description: `Pausa registrada: "${pauseReason}"`
      });
    }
  };

  const isPedidoAtrasado = (pedido: PedidoMock) => {
    if (pedido.statusPedido === "EXPEDIDO" || pedido.statusPedido === "CANCELADO") return false;
    const deliveryDate = new Date(pedido.dataPrevistaEntrega);
    const today = new Date("2026-06-02");
    return deliveryDate < today;
  };

  const isPedidoBloqueado = (pedido: PedidoMock) => {
    return pedido.financialBlock || Boolean(pedido.blockReason);
  };

  // Filter calculations
  const totalCount = pedidos.length;
  const atrasadosCount = pedidos.filter(p => isPedidoAtrasado(p)).length;
  const urgentesCount = pedidos.filter(p => p.urgente).length;
  const arteCount = pedidos.filter(p => ["ARTE_EM_ANDAMENTO", "AGUARDANDO_APROVACAO_CLIENTE"].includes(p.statusPedido)).length;
  const producaoCount = pedidos.filter(p => ["EM_IMPRESSAO", "EM_ACABAMENTO", "REVISAO_FINAL"].includes(p.statusPedido)).length;
  const expedicaoCount = pedidos.filter(p => ["PRONTO_EXPEDICAO", "EXPEDIDO"].includes(p.statusPedido)).length;
  const aguardandoClienteCount = pedidos.filter(p => p.statusPedido === "AGUARDANDO_APROVACAO_CLIENTE").length;
  const bloqueadosCount = pedidos.filter(p => isPedidoBloqueado(p)).length;
  const hojeCount = pedidos.filter(p => p.dataPrevistaEntrega === "2026-06-02" && p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO").length;
  const semanaCount = pedidos.filter(p => {
    const t = new Date(p.dataPrevistaEntrega).getTime();
    const todayTime = new Date("2026-06-02").getTime();
    return t >= todayTime && t <= todayTime + 7 * 24 * 60 * 60 * 1000 && p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO";
  }).length;

  const calculateProducaoProgress = (pedido: any) => {
    if (pedido.statusPedido === "PRONTO_EXPEDICAO" || pedido.statusPedido === "EXPEDIDO") return 100;
    if (pedido.statusPedido === "REVISAO_FINAL") return 80;
    if (pedido.statusPedido === "EM_ACABAMENTO") return 60;
    if (pedido.statusPedido === "EM_IMPRESSAO") return 30;
    return 0;
  };

  // Filter logic for columns
  const getFilteredPedidosForStatus = (statusList: PedidoStatus[]) => {
    const filtered = pedidos.filter((p) => {
      const matchesStatus = statusList.includes(p.statusPedido);
      const matchesSearch =
        search === "" ||
        p.clienteNome.toLowerCase().includes(search.toLowerCase()) ||
        String(p.id_int).includes(search) ||
        (p.vendedor && p.vendedor.toLowerCase().includes(search.toLowerCase())) ||
        p.empresa.toLowerCase().includes(search.toLowerCase());

      const matchesEmpresa =
        filterEmpresa === "all" ||
        p.empresa.toLowerCase().replace(" ", "") === filterEmpresa.toLowerCase().replace(" ", "");

      let matchesQuickFilter = true;
      if (activeFilter === "atrasado") {
        matchesQuickFilter = isPedidoAtrasado(p);
      } else if (activeFilter === "urgente") {
        matchesQuickFilter = p.urgente;
      } else if (activeFilter === "arte") {
        matchesQuickFilter = ["ARTE_EM_ANDAMENTO", "AGUARDANDO_APROVACAO_CLIENTE"].includes(p.statusPedido);
      } else if (activeFilter === "producao") {
        matchesQuickFilter = ["EM_IMPRESSAO", "EM_ACABAMENTO", "REVISAO_FINAL"].includes(p.statusPedido);
      } else if (activeFilter === "expedicao") {
        matchesQuickFilter = ["PRONTO_EXPEDICAO", "EXPEDIDO"].includes(p.statusPedido);
      } else if (activeFilter === "aguardando_cliente") {
        matchesQuickFilter = p.statusPedido === "AGUARDANDO_APROVACAO_CLIENTE";
      } else if (activeFilter === "bloqueado") {
        matchesQuickFilter = isPedidoBloqueado(p);
      } else if (activeFilter === "hoje") {
        matchesQuickFilter = p.dataPrevistaEntrega === "2026-06-02" && p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO";
      } else if (activeFilter === "semana") {
        const t = new Date(p.dataPrevistaEntrega).getTime();
        const todayTime = new Date("2026-06-02").getTime();
        matchesQuickFilter = t >= todayTime && t <= todayTime + 7 * 24 * 60 * 60 * 1000 && p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO";
      }

      return matchesStatus && matchesSearch && matchesEmpresa && matchesQuickFilter;
    });

    // Apply sorting
    return [...filtered].sort((a, b) => {
      if (sortBy === "urgente") {
        if (a.urgente && !b.urgente) return -1;
        if (!a.urgente && b.urgente) return 1;
        return b.id_int - a.id_int;
      }
      if (sortBy === "valor") {
        return b.valorTotal - a.valorTotal;
      }
      if (sortBy === "antigo") {
        return a.id_int - b.id_int;
      }
      return b.id_int - a.id_int;
    });
  };

  const getArteBadgeColor = (status: string) => {
    if (status === "LIBERADA") return "text-teal-600 border-teal-200 dark:text-teal-400";
    if (status === "REPROVADA_CLIENTE") return "text-red-600 border-red-200 dark:text-red-400";
    if (status === "PENDENTE") return "text-slate-500 border-slate-200 dark:text-slate-400";
    return "text-amber-600 border-amber-200 dark:text-amber-450";
  };

  // Render Kanban Board
  const renderKanbanBoard = (isTv: boolean) => (
    <div className={`flex-1 overflow-x-auto min-w-0 pb-4 select-none ${isTv ? "bg-slate-950 p-2 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent" : "scrollbar-thin"}`}>
      <div className="flex gap-3" style={{ minWidth: isTv ? "2000px" : "2200px" }}>
        {COLUNAS_KANBAN.filter((coluna) => {
          const colPedidos = getFilteredPedidosForStatus(coluna.statusList);
          
          // Specific quick filter column visibility rules
          if (activeFilter === "producao") {
            return ["Impressão", "Acabamento", "Revisão"].includes(coluna.label);
          }
          if (activeFilter === "expedicao") {
            return ["Expedição", "Finalizado"].includes(coluna.label);
          }
          if (activeFilter === "arte") {
            return ["Arte", "Aprovação Cliente"].includes(coluna.label);
          }
          if (activeFilter === "bloqueado") {
            // only columns containing blocked orders
            return colPedidos.some(p => isPedidoBloqueado(p));
          }
          
          // General dynamic rule: hide columns with 0 records when any search or quick filter is active
          const hasActiveFilter = activeFilter !== "all" || search !== "" || filterEmpresa !== "all";
          if (hasActiveFilter) {
            return colPedidos.length > 0;
          }
          
          return true;
        }).map((coluna) => {
          const colPedidos = getFilteredPedidosForStatus(coluna.statusList);
          const colIdx = COLUNAS_KANBAN.findIndex(c => c.label === coluna.label);
          return (
            <div
              key={coluna.label}
              className={`shrink-0 rounded-xl flex flex-col overflow-hidden border ${
                isTv
                  ? "w-64 bg-slate-900/30 border-slate-800/50 p-2.5 max-h-[85vh] shadow-lg"
                  : "w-72 bg-slate-50/40 dark:bg-slate-900/10 border-slate-200/40 dark:border-slate-800/30 p-3 max-h-[620px]"
              }`}
            >
              {/* Header Coluna */}
              <div className={`flex justify-between items-center pb-2 border-b mb-3 text-xs ${
                isTv
                  ? "border-slate-800 text-slate-200 font-extrabold tracking-wider"
                  : "border-slate-200/60 dark:border-slate-800/30 text-slate-700 dark:text-slate-300 font-bold"
              }`}>
                <span className="uppercase tracking-widest font-black text-[10px] truncate max-w-[80%]">{coluna.label}</span>
                <span className={`px-2 py-0.5 rounded-full font-mono font-black text-[10px] ${
                  isTv ? "bg-slate-800 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-850 dark:text-slate-400"
                }`}>
                  {colPedidos.length}
                </span>
              </div>

              {/* Cards List */}
              <div className={`flex-1 overflow-y-auto pr-1 ${isTv ? "space-y-2" : "space-y-2.5"}`}>
                {colPedidos.map((pedido) => {
                  const models = pedido.produtos ? pedido.produtos.flatMap(prod => prod.modelos) : pedido.modelos || [];
                  const totalArtes = models.length;
                  const aprovadas = models.filter((m: any) => m.statusArte === "LIBERADA" || m.statusArte === "NAO_NECESSARIA").length;
                  const atrasado = isPedidoAtrasado(pedido);
                  const bloqueado = isPedidoBloqueado(pedido);
                  const hasReproved = models.some((m: any) => m.statusArte === "REPROVADA_CLIENTE");
                  const hasPendingArte = models.some((m: any) => m.statusArte === "PENDENTE");

                  const arteProgress = totalArtes === 0 ? 0 : Math.round((aprovadas / totalArtes) * 100);
                  const prodProgress = calculateProducaoProgress(pedido);
                  const prazoInfo = getPrazoStatus(pedido);

                  // Setup left border line (status indicator)
                  let borderLeftClass = "border-l-4 ";
                  if (atrasado) {
                    borderLeftClass += "border-l-red-600 dark:border-l-red-500";
                  } else if (pedido.urgente) {
                    borderLeftClass += "border-l-red-500 dark:border-l-red-400";
                  } else if (bloqueado) {
                    borderLeftClass += "border-l-amber-500 dark:border-l-amber-400";
                  } else {
                    // Company color indicator
                    const empresaLower = pedido.empresa.toLowerCase();
                    if (empresaLower.includes("gráfica")) {
                      borderLeftClass += "border-l-blue-600 dark:border-l-blue-400";
                    } else if (empresaLower.includes("birô") || empresaLower.includes("biro")) {
                      borderLeftClass += "border-l-emerald-600 dark:border-l-emerald-400";
                    } else if (empresaLower.includes("brindes")) {
                      borderLeftClass += "border-l-indigo-600 dark:border-l-indigo-400";
                    } else {
                      borderLeftClass += "border-l-slate-400 dark:border-l-slate-500";
                    }
                  }

                  // Main card styling - softened borders to match the minimal design
                  let cardBgStyles = "bg-white dark:bg-slate-900";
                  let cardBorderStyles = "border-slate-200/40 dark:border-slate-800/30";

                  if (isTv) {
                    cardBgStyles = "bg-slate-900/90 text-slate-100";
                    cardBorderStyles = "border-slate-800/50";
                    if (pedido.urgente) {
                      cardBorderStyles = "border border-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.25)]";
                    } else if (atrasado) {
                      cardBorderStyles = "border border-red-600/80 shadow-[0_0_8px_rgba(220,38,38,0.3)]";
                    } else if (bloqueado) {
                      cardBorderStyles = "border border-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.25)]";
                    }
                  } else {
                    // Standard hover effects and borders
                    if (pedido.urgente) {
                      cardBgStyles = "bg-red-50/5 dark:bg-red-955/5";
                      cardBorderStyles = "border-red-200/60 dark:border-red-950/40";
                    } else if (atrasado) {
                      cardBgStyles = "bg-red-50/10 dark:bg-red-955/10";
                      cardBorderStyles = "border-red-250/60 dark:border-red-950/50";
                    } else if (bloqueado) {
                      cardBgStyles = "bg-amber-50/5 dark:bg-amber-955/5";
                      cardBorderStyles = "border-amber-200/60 dark:border-amber-950/30";
                    }
                  }

                  return (
                    <div
                      key={pedido.id_int}
                      className={`relative flex flex-col justify-between transition-all duration-150 rounded-lg border shadow-xs hover:shadow-md ${cardBgStyles} ${cardBorderStyles} ${borderLeftClass} ${
                        isCompact ? "p-2 space-y-1.5 text-[10px]" : "p-3 space-y-2 text-[11px]"
                      }`}
                    >
                      {/* OS Header */}
                      <div className="flex justify-between items-center gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono font-black text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[#0b2f4a] dark:text-blue-400">
                            #{pedido.id_int}
                          </span>
                          <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider truncate">
                            {pedido.empresa === "Ideal Gráfica" ? "IG" : pedido.empresa === "Ideal Birô" ? "IB" : pedido.empresa === "E3 Brindes" ? "E3" : pedido.empresa}
                          </span>
                        </div>
                        <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400 px-1 bg-slate-100 dark:bg-slate-800 rounded">
                          {pedido.vendedor.split(" ")[0]}
                        </span>
                      </div>

                      {/* Client & Product Summary */}
                      <div>
                        <h4 className={`font-black text-slate-900 dark:text-slate-100 truncate ${
                          isTv ? "text-xs text-white" : "text-xs"
                        }`}>
                          {pedido.clienteNome}
                        </h4>
                        
                        {/* Brief list of products (hidden if compact to maintain extreme density) */}
                        {!isCompact && (
                          <div className="text-[9px] font-semibold text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {pedido.produtos && pedido.produtos.length > 0
                              ? pedido.produtos.map(p => `${p.quantidade}x ${p.nome}`).join(" | ")
                              : `${pedido.modelos ? pedido.modelos.length : 0} modelos`}
                          </div>
                        )}
                      </div>

                      {/* Prazo Tag */}
                      <div className="flex items-center">
                        <span className={`text-[8px] font-extrabold px-1.5 py-0.2 rounded ${prazoInfo.color}`}>
                          {prazoInfo.label}
                        </span>
                      </div>

                      {/* Progresso: Arte & Fábrica side-by-side */}
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/60">
                        <div className="space-y-0.5">
                          <div className="flex justify-between text-[8px] font-bold text-slate-400">
                            <span>ARTE</span>
                            <span className="text-blue-600 dark:text-blue-450">{arteProgress}%</span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1 overflow-hidden">
                            <div className="bg-blue-500 h-full rounded-full transition-all duration-300" style={{ width: `${arteProgress}%` }}></div>
                          </div>
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex justify-between text-[8px] font-bold text-slate-400">
                            <span>FÁBRICA</span>
                            <span className="text-emerald-600 dark:text-emerald-450">{prodProgress}%</span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1 overflow-hidden">
                            <div className="bg-emerald-500 h-full rounded-full transition-all duration-300" style={{ width: `${prodProgress}%` }}></div>
                          </div>
                        </div>
                      </div>

                      {/* Gargalos Badges */}
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {pedido.urgente && (
                          <span className="bg-red-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider flex items-center gap-0.5 animate-pulse">
                            <Flame className="h-2.5 w-2.5 shrink-0" />
                            <span>URGENTE</span>
                          </span>
                        )}
                        {atrasado && (
                          <span className="bg-red-750 text-white font-extrabold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">
                            ⚠️ ATRASADO
                          </span>
                        )}
                        {pedido.financialBlock && (
                          <span className="bg-red-50 text-red-700 border border-red-200/60 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/60 font-extrabold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider flex items-center gap-0.5">
                            <Lock className="h-2.5 w-2.5 shrink-0" />
                            <span>FINAN BLOQ</span>
                          </span>
                        )}
                        {pedido.blockReason && (
                          <span className="bg-amber-550 text-white font-extrabold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider flex items-center gap-0.5 animate-pulse" title={pedido.blockReason}>
                            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                            <span>PAUSA</span>
                          </span>
                        )}
                        {hasReproved && (
                          <span className="bg-red-50 text-red-700 border border-red-200/60 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/60 font-extrabold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">
                            ❌ ARTE REPROVADA
                          </span>
                        )}
                        {pedido.statusPedido === "AGUARDANDO_APROVACAO_CLIENTE" && (
                          <span className="bg-blue-50 text-blue-700 border border-blue-200/60 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/60 font-extrabold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">
                            💬 AGUARDANDO CLIENTE
                          </span>
                        )}
                      </div>

                      {/* Action buttons (only if not TV mode) */}
                      {!isTv && (
                        <div className="flex justify-between items-center border-t border-slate-100 dark:border-slate-800/50 pt-2 mt-1 gap-1">
                          {/* Left/Right movement */}
                          <div className="flex gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleMoveLeft(pedido, colIdx)}
                              disabled={colIdx === 0}
                              className="h-6 w-6 rounded border border-slate-200/60 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center disabled:opacity-20 transition"
                              title="Voltar Etapa"
                            >
                              <ArrowLeft className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveRight(pedido, colIdx)}
                              disabled={colIdx === COLUNAS_KANBAN.length - 1}
                              className="h-6 w-6 rounded border border-slate-200/60 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center disabled:opacity-20 transition"
                              title="Avançar Etapa"
                            >
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </div>

                          {/* Quick controls */}
                          <div className="flex items-center gap-0.5 min-w-0">
                            {/* Urgent toggle */}
                            <button
                              type="button"
                              onClick={() => {
                                toggleUrgente(pedido.id_int);
                                showToast({
                                  type: "info",
                                  title: "Urgência Alterada",
                                  description: `Pedido #${pedido.id_int} alterado.`
                                });
                              }}
                              className={`h-6 w-6 rounded border flex items-center justify-center transition shrink-0 ${
                                pedido.urgente
                                  ? "bg-red-50 border-red-200/60 text-red-750 dark:bg-red-955 dark:border-red-900/50 dark:text-red-400"
                                  : "border-slate-200/60 dark:border-slate-800 text-slate-400 hover:bg-slate-105 dark:hover:bg-slate-800"
                              }`}
                              title="Marcar Urgente"
                            >
                              <Flame className="h-3.5 w-3.5" />
                            </button>

                            {/* Pause production toggle */}
                            <button
                              type="button"
                              onClick={() => handlePauseToggle(pedido)}
                              className="h-6 w-6 rounded border border-slate-200/60 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition shrink-0"
                              title={pedido.blockReason ? "Retomar Produção" : "Pausar Produção"}
                            >
                              {pedido.blockReason ? (
                                <PlayCircle className="h-3.5 w-3.5 text-teal-650" />
                              ) : (
                                <PauseCircle className="h-3.5 w-3.5 text-slate-400" />
                              )}
                            </button>

                            {/* Chat drawer */}
                            <button
                              type="button"
                              onClick={() => openChat(pedido.id_int, { clienteNome: pedido.clienteNome, idCliente: pedido.idCliente })}
                              className="h-6 w-6 rounded border border-slate-200/60 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition shrink-0"
                              title="Chat"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </button>

                            {/* Ficha Geral */}
                            <Link
                              href={`/pedidos/${pedido.id_int}`}
                              className="h-6 w-6 rounded border border-slate-200/60 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition shrink-0"
                              title="Abrir Ficha Geral"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Link>

                            {/* Ir para Produção */}
                            <Link
                              href={`/pedidos/${pedido.id_int}?tab=producao`}
                              className="h-6 px-1.5 bg-[#0b2f4a] hover:bg-[#123f61] text-white rounded text-[9px] font-bold flex items-center justify-center gap-0.5 transition shrink-0"
                              title="Ir para Ficha de Produção"
                            >
                              <Wrench className="h-3 w-3" />
                              <span className="hidden xs:inline">Fábrica</span>
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-5 font-sans">
      {/* Banner de Protótipo */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3.5 text-blue-900 flex items-start justify-between gap-4 text-xs">
        <div className="flex gap-2">
          <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold uppercase tracking-wider text-xs">Kanban de Produção & OS</h4>
            <p className="text-[11px] text-blue-700 mt-0.5 leading-relaxed">
              Atalhos de teclado: <strong className="font-extrabold">K</strong> (Kanban),{" "}
              <strong className="font-extrabold">L</strong> (Lista Geral), <strong className="font-extrabold">I</strong>{" "}
              (Fila de Impressão) e <strong className="font-extrabold">U</strong> (Filtrar Urgência).
            </p>
          </div>
        </div>
        <button
          onClick={resetLocalStorage}
          className="shrink-0 flex items-center gap-1 bg-blue-100 hover:bg-blue-205 text-blue-805 rounded-lg px-2.5 py-1 text-[11px] font-bold transition"
        >
          <RefreshCw className="h-3 w-3" />
          <span>Resetar Base</span>
        </button>
      </div>

      {/* Header e Seleção de modo TV */}
      <div className="flex justify-between items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-2xl shadow-sm text-xs">
        <div className="flex gap-2">
          <Link
            href="/pedidos"
            className="px-3.5 py-2 font-bold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Fila Geral
          </Link>
          <Link
            href="/pedidos/kanban"
            className="px-3.5 py-2 font-bold rounded-xl bg-[#0b2f4a] text-white transition"
          >
            Kanban Board
          </Link>
          <Link
            href="/pedidos/impressao"
            className="px-3.5 py-2 font-bold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Fila de Impressão
          </Link>
          <Link
            href="/expedicao"
            className="px-3.5 py-2 font-bold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Expedição
          </Link>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setIsFullscreen(true)}
            className="h-8 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-xl font-bold flex items-center gap-1.5 transition text-xs border border-slate-200 dark:border-slate-700"
            title="Fullscreen / TV Mode"
          >
            <Tv className="h-4 w-4" />
            <span>Modo TV / Galpão</span>
          </button>
        </div>
      </div>

      {/* Filtros Rápidos (Barra de Badges) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-1.5 text-xs">
        {[
          { key: "all", label: "Tudo", count: totalCount, style: "border-slate-200/60 dark:border-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-355" },
          { key: "atrasado", label: "Atrasados", count: atrasadosCount, style: "border-red-200/60 bg-red-50/10 text-red-750 dark:border-red-955 dark:text-red-400 hover:bg-red-50/30" },
          { key: "urgente", label: "Urgentes", count: urgentesCount, style: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:text-red-400 hover:bg-red-100/40 animate-pulse" },
          { key: "arte", label: "Fase Arte", count: arteCount, style: "border-blue-200/60 bg-blue-50/10 text-blue-755 dark:border-blue-950 dark:text-blue-450 hover:bg-blue-50/30" },
          { key: "producao", label: "Produção", count: producaoCount, style: "border-orange-200/60 bg-orange-50/10 text-orange-755 dark:border-orange-950 dark:text-orange-400 hover:bg-orange-50/30" },
          { key: "expedicao", label: "Expedição", count: expedicaoCount, style: "border-teal-200/60 bg-teal-50/10 text-teal-755 dark:border-teal-950 dark:text-teal-400 hover:bg-teal-50/30" },
          { key: "aguardando_cliente", label: "Aguardando Clie.", count: aguardandoClienteCount, style: "border-blue-200/60 bg-blue-50/10 text-blue-755 dark:border-blue-950 dark:text-blue-400 hover:bg-blue-50/30" },
          { key: "bloqueado", label: "Bloqueados", count: bloqueadosCount, style: "border-amber-200/60 bg-amber-50/10 text-amber-755 dark:border-amber-950 dark:text-amber-400 hover:bg-amber-50/30" },
          { key: "hoje", label: "Prazo Hoje", count: hojeCount, style: "border-slate-200/60 bg-slate-50 text-slate-800 dark:border-slate-750 dark:text-slate-200 hover:bg-slate-100/50" },
          { key: "semana", label: "Esta Semana", count: semanaCount, style: "border-purple-200/60 bg-purple-50/10 text-purple-755 dark:border-purple-950 dark:text-purple-400 hover:bg-purple-50/30" }
        ].map((btn) => (
          <button
            key={btn.key}
            type="button"
            onClick={() => setActiveFilter(btn.key as any)}
            className={`p-2 border rounded-xl flex flex-col justify-between text-left transition select-none ${
              activeFilter === btn.key 
                ? "bg-[#0b2f4a] border-[#0b2f4a] text-white" 
                : btn.style
            }`}
          >
            <span className="text-[10px] font-black uppercase tracking-wider block truncate w-full">{btn.label}</span>
            <strong className={`font-mono mt-1 text-sm ${activeFilter === btn.key ? "text-white" : ""}`}>
              {btn.count}
            </strong>
          </button>
        ))}
      </div>

      {/* Caixa de Busca e Filtros Avançados */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-xs grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        {/* Campo Busca */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por OS, Cliente, Vendedor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs focus:outline-none text-slate-800 dark:text-slate-200"
          />
        </div>

        {/* Empresa dropdown */}
        <div>
          <select
            value={filterEmpresa}
            onChange={(e) => setFilterEmpresa(e.target.value)}
            className="w-full h-9 px-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
          >
            <option value="all">Todas as Empresas</option>
            <option value="Ideal Grafica">Ideal Gráfica</option>
            <option value="Ideal Biro">Ideal Birô</option>
            <option value="E3 Brindes">E3 Brindes</option>
          </select>
        </div>

        {/* Ordenação dropdown */}
        <div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-full h-9 px-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
          >
            <option value="recente">Ordem: Recentes</option>
            <option value="antigo">Ordem: FIFO (Antigos)</option>
            <option value="valor">Ordem: Maior Valor Financeiro</option>
            <option value="urgente">Ordem: Urgentes Primeiro</option>
          </select>
        </div>

        {/* Modo Compacto toggle */}
        <div className="flex items-center justify-end">
          <button
            onClick={() => setIsCompact(!isCompact)}
            className={`w-full h-9 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              isCompact
                ? "bg-[#0b2f4a] border-[#0b2f4a] text-white"
                : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-800 dark:text-slate-355"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>{isCompact ? "Card Compacto: Ligado" : "Card Compacto: Desligado"}</span>
          </button>
        </div>
      </div>

      {/* Main Kanban Board View */}
      {pedidos.length > 0 ? (
        renderKanbanBoard(false)
      ) : (
        <EmptyState
          title="Nenhum pedido em produção"
          description="Os pedidos aparecerão aqui quando forem liberados pelo boletim finalizado."
        />
      )}

      {/* FULLSCREEN overlay / TV MODE */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-950 p-6 flex flex-col space-y-4 text-slate-100 overflow-hidden">
          <div className="flex justify-between items-center border-b border-slate-800 pb-3">
            <div className="space-y-1">
              <h2 className="text-xl font-black tracking-wide text-white uppercase flex items-center gap-2">
                <Tv className="h-5 w-5 text-red-500 animate-pulse" />
                <span>PAINEL LOGÍSTICO TV — FLUXO KANBAN DE PRODUÇÃO</span>
              </h2>
              <p className="text-xs text-slate-400">
                Pressione <strong className="font-extrabold text-slate-200">ESC</strong> para fechar ou clique no botão de saída.
              </p>
            </div>
            <button
              onClick={() => setIsFullscreen(false)}
              className="h-9 px-4 bg-slate-800 hover:bg-slate-750 text-slate-100 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
            >
              <Minimize2 className="h-4 w-4" />
              <span>Sair do Modo TV</span>
            </button>
          </div>

          {/* Render the Kanban board in dark TV styling */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {renderKanbanBoard(true)}
          </div>
        </div>
      )}

      {/* Pause Operational Modal */}
      {isPauseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 space-y-4 shadow-xl">
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Registrar Ocorrência / Pausa de OS</h3>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-650 dark:text-slate-400">
                Justificativa / Motivo de Parada:
              </label>
              <textarea
                placeholder="Ex: Falha mecânica na guilhotina de corte, aguardando bobina holográfica, etc."
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                className="w-full h-24 p-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs rounded-xl focus:outline-none resize-none text-slate-800 dark:text-slate-200"
              />
            </div>
            <div className="flex gap-2 text-xs">
              <button
                onClick={submitPausa}
                disabled={!pauseReason.trim()}
                className="flex-1 h-9 bg-red-655 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl transition"
              >
                Pausar OS
              </button>
              <button
                onClick={() => {
                  setIsPauseModalOpen(false);
                  setSelectedPedidoId(null);
                }}
                className="h-9 px-4 border border-slate-200 dark:border-slate-855 rounded-xl font-semibold text-slate-600 dark:text-slate-300"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
