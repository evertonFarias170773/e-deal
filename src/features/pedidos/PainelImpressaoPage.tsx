"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PedidoProducaoListItem, ModeloMock, ProducaoStatus } from "./types";
import { listarPedidosOperacionais, listarModelosImpressao } from "./services/pedidos-producao.service";
import { useAppToast } from "@/components/common/AppToast";
import type { PedidoModelo } from "@/features/producao/types";
import {
  Flame,
  AlertCircle,
  Tv,
  Minimize2,
  Clock,
  Printer,
  Lock,
  Layers,
  RefreshCw
} from "lucide-react";

export function PainelImpressaoPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [pedidos, setPedidos] = useState<PedidoProducaoListItem[]>([]);
  const [modelos, setModelos] = useState<PedidoModelo[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [pedidosData, modelosData] = await Promise.all([
          listarPedidosOperacionais(),
          listarModelosImpressao()
        ]);
        setPedidos(pedidosData);
        setModelos(modelosData);
      } catch (err) {
        console.error("Erro ao carregar fila de impressão:", err);
      } finally {
        setIsLoaded(true);
      }
    }
    void load();
  }, []);

  const [currentTime, setCurrentTime] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filterUrgente, setFilterUrgente] = useState(false);
  const [isPauseModalOpen, setIsPauseModalOpen] = useState(false);
  const [selectedPedidoId, setSelectedPedidoId] = useState<number | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [isCompact, setIsCompact] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"todos" | "prontos" | "rodando" | "aguardando_arte" | "bloqueados" | "atrasados">("todos");
  const [filterSetor, setFilterSetor] = useState<string>("todos");
  const [filterMaterial, setFilterMaterial] = useState<string>("todos");

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

  // Tick Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("pt-BR"));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard Navigation & Shortcuts
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
      } else if (key === "u") {
        setFilterUrgente((prev) => !prev);
        showToast({
          type: "info",
          title: "Filtro de Urgência",
          description: "Painel de Impressão filtrado por urgentes via teclado."
        });
      } else if (key === "escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router, isFullscreen, showToast]);

  const handleStartPrint = (_idInt: number, _modeloId: string) => {};
  const handleFinishPrint = (_idInt: number, _modeloId: string) => {};
  const handlePausePrint = (_idInt: number) => {};
  const submitPausa = () => {};
  const handleResumePrint = (_idInt: number) => {};

  if (!isLoaded) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-900 dark:border-slate-50 border-t-transparent mx-auto"></div>
          <p className="text-slate-500 font-semibold text-sm">Carregando fila de impressoras...</p>
        </div>
      </div>
    );
  }

  // Type definitions
  interface PrintItem {
    pedido: PedidoProducaoListItem;
    modelo: ModeloMock;
  }

  // Gather all items from models
  const allItems: PrintItem[] = [];
  modelos.forEach((m) => {
    const p = pedidos.find(o => o.id_int === m.id_int);
    if (p) {
      allItems.push({
        pedido: p,
        modelo: {
          id: m.id,
          nomeModelo: m.nome_modelo,
          quantidade: m.quantidade,
          statusArte: m.status_arte,
          statusProducao: m.status_producao as ProducaoStatus,
          obsImpressao: m.obs_impressao || undefined,
          setor: "Digital",
          configImpressao: {
            tipoNumeracao: m.tipo_numeracao || "Sem Numeração",
            qrCode: false,
            codBarras: false
          },
          historicoArtes: [],
          tokenAprovacao: ""
        }
      });
    }
  });

  const getItemStatus = (p: PedidoProducaoListItem, m: ModeloMock) => {
    if (p.financialBlock) return "BLOQUEADO FINANCEIRO";
    if (p.blockReason) return "PAUSADO OPERACIONAL";
    if (m.statusProducao === "EM_ACABAMENTO" || m.statusProducao === "CONCLUIDA") return "CONCLUÍDO";
    if (m.statusArte !== "LIBERADA" && m.statusArte !== "NAO_NECESSARIA") return "AGUARDANDO ARTE";
    if (m.statusProducao === "EM_IMPRESSAO") return "EM IMPRESSÃO";
    return "PRONTO PARA IMPRIMIR";
  };

  // Dynamic filter collections
  const sectors = Array.from(new Set(allItems.map(i => i.modelo.setor))).filter(Boolean);
  const materials = Array.from(new Set(allItems.map(i => i.modelo.corMaterial))).filter(Boolean);

  // Filter items
  const filteredItems = allItems.filter(({ pedido: p, modelo: m }) => {
    const itemStatus = getItemStatus(p, m);

    if (filterStatus === "prontos" && itemStatus !== "PRONTO PARA IMPRIMIR") return false;
    if (filterStatus === "rodando" && itemStatus !== "EM IMPRESSÃO") return false;
    if (filterStatus === "aguardando_arte" && itemStatus !== "AGUARDANDO ARTE") return false;
    if (filterStatus === "bloqueados" && itemStatus !== "BLOQUEADO FINANCEIRO" && itemStatus !== "PAUSADO OPERACIONAL") return false;
    if (filterStatus === "atrasados") {
      const isLate = new Date(p.dataPrevistaEntrega) < new Date() && itemStatus !== "CONCLUÍDO";
      if (!isLate) return false;
    }

    if (filterStatus === "todos" && itemStatus === "CONCLUÍDO") return false;
    if (filterUrgente && !p.urgente) return false;
    if (filterSetor !== "todos" && m.setor !== filterSetor) return false;
    if (filterMaterial !== "todos" && m.corMaterial !== filterMaterial) return false;

    return true;
  });

  const renderHeaderSelector = () => (
    <div className="flex justify-between items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 p-2.5 rounded-2xl shadow-sm text-xs">
      <div className="flex gap-2">
        <Link
          href="/pedidos"
          className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition"
        >
          Fila Geral
        </Link>
        <Link
          href="/pedidos/kanban"
          className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition"
        >
          Kanban Board
        </Link>
        <Link
          href="/pedidos/impressao"
          className="px-3.5 py-2 font-bold rounded-xl bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 transition"
        >
          Fila de Impressão
        </Link>
        <Link
          href="/expedicao"
          className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition"
        >
          Expedição
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <span className="bg-slate-100 text-slate-800 text-[10px] font-bold px-2 py-1 rounded dark:bg-slate-850 dark:text-slate-350">PREVIEW UX</span>
        {currentTime && (
          <div className="h-8 px-3.5 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl font-mono font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 shadow-sm text-xs">
            <Clock className="h-3.5 w-3.5 text-blue-600 animate-pulse" />
            <span>{currentTime}</span>
          </div>
        )}
        <button
          onClick={() => setIsFullscreen(true)}
          className="h-8 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-750 dark:text-slate-200 rounded-xl font-bold flex items-center gap-1 transition text-xs"
        >
          <Tv className="h-4 w-4" />
          <span>Modo TV</span>
        </button>
      </div>
    </div>
  );

  const renderKpis = () => {
    const activeItems = allItems.filter(i => getItemStatus(i.pedido, i.modelo) !== "CONCLUÍDO");
    const rodandoCount = allItems.filter(i => getItemStatus(i.pedido, i.modelo) === "EM IMPRESSÃO").length;
    const prontosCount = allItems.filter(i => getItemStatus(i.pedido, i.modelo) === "PRONTO PARA IMPRIMIR").length;
    const bloqueadosCount = allItems.filter(i => {
      const s = getItemStatus(i.pedido, i.modelo);
      return s === "BLOQUEADO FINANCEIRO" || s === "PAUSADO OPERACIONAL";
    }).length;
    const atrasadosCount = allItems.filter(i => {
      const s = getItemStatus(i.pedido, i.modelo);
      return new Date(i.pedido.dataPrevistaEntrega) < new Date() && s !== "CONCLUÍDO";
    }).length;

    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 p-2.5 rounded-xl flex flex-col justify-between shadow-xs">
          <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-wider">Fila Total Ativa</span>
          <strong className="text-base font-mono font-black mt-0.5 text-slate-900 dark:text-slate-200">
            {activeItems.length}
          </strong>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 p-2.5 rounded-xl flex flex-col justify-between border-l-4 border-l-blue-500 shadow-xs">
          <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-wider">Rodando Máquina</span>
          <strong className="text-base font-mono font-black mt-0.5 text-blue-600 dark:text-blue-450">
            {rodandoCount}
          </strong>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 p-2.5 rounded-xl flex flex-col justify-between border-l-4 border-l-emerald-500 shadow-xs">
          <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-wider">Prontos p/ Rodar</span>
          <strong className="text-base font-mono font-black mt-0.5 text-emerald-600 dark:text-emerald-450">
            {prontosCount}
          </strong>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 p-2.5 rounded-xl flex flex-col justify-between border-l-4 border-l-orange-500 shadow-xs">
          <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-wider">Bloqueados/Pausados</span>
          <strong className="text-base font-mono font-black mt-0.5 text-orange-600 dark:text-orange-400">
            {bloqueadosCount}
          </strong>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 p-2.5 rounded-xl flex flex-col justify-between border-l-4 border-l-red-500 shadow-sm">
          <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-wider">Prazo Atrasado</span>
          <strong className="text-base font-mono font-black mt-0.5 text-red-600 dark:text-red-400">
            {atrasadosCount}
          </strong>
        </div>
      </div>
    );
  };

  const renderDashboardContent = (isTv: boolean) => {
    const cellPadding = isCompact ? "py-1.5 px-3" : "py-2.5 px-3";
    const textBase = isCompact ? "text-[11px]" : "text-xs";
    const textSmall = isCompact ? "text-[9px]" : "text-[10px]";
    const btnHeight = isCompact ? "h-6.5 text-[9px] rounded-lg px-2" : "h-7.5 text-[10px] rounded-xl px-3";

    const sortedItems = [...filteredItems].sort((a, b) => {
      const statusA = getItemStatus(a.pedido, a.modelo);
      const statusB = getItemStatus(b.pedido, b.modelo);

      const getPriority = (status: string) => {
        if (status === "EM IMPRESSÃO") return 1;
        if (status === "PRONTO PARA IMPRIMIR") return 2;
        if (status === "PAUSADO OPERACIONAL" || status === "BLOQUEADO FINANCEIRO") return 3;
        if (status === "AGUARDANDO ARTE") return 4;
        return 5;
      };

      const prioA = getPriority(statusA);
      const prioB = getPriority(statusB);

      if (prioA !== prioB) {
        return prioA - prioB;
      }

      if (a.pedido.urgente !== b.pedido.urgente) {
        return a.pedido.urgente ? -1 : 1;
      }

      const dateA = new Date(a.pedido.dataPrevistaEntrega).getTime();
      const dateB = new Date(b.pedido.dataPrevistaEntrega).getTime();
      return dateA - dateB;
    });

    if (sortedItems.length === 0) {
      return (
        <div className="rounded-xl border p-12 text-center text-slate-400 dark:text-slate-600 bg-white dark:bg-slate-900 border-slate-200/40 dark:border-slate-800/30">
          <Printer className="h-8 w-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
          <p className="font-bold">Nenhum item liberado para impressão</p>
          <p className="text-[10px] mt-0.5">Os itens aparecerão aqui quando os modelos/lotes forem cadastrados no boletim.</p>
        </div>
      );
    }

    return (
      <div className={`overflow-x-auto max-h-[65vh] rounded-xl border transition-colors relative ${
        isTv 
          ? "bg-slate-950 border-slate-800 text-slate-100" 
          : "bg-white dark:bg-slate-900 border-slate-200/40 dark:border-slate-800/30 text-slate-800 dark:text-slate-200 shadow-sm"
      }`}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="font-bold uppercase tracking-wider text-[9px]">
              <th className={`py-2.5 px-3 w-[120px] sticky top-0 z-10 border-b ${isTv ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400"}`}>Status</th>
              <th className={`py-2.5 px-3 w-[110px] sticky top-0 z-10 border-b ${isTv ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400"}`}>OS / Cliente</th>
              <th className={`py-2.5 px-3 sticky top-0 z-10 border-b ${isTv ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400"}`}>Produto / Modelo</th>
              <th className={`py-2.5 px-3 text-right w-[80px] sticky top-0 z-10 border-b ${isTv ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400"}`}>Qtd</th>
              <th className={`py-2.5 px-3 sticky top-0 z-10 border-b ${isTv ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400"}`}>Especificações</th>
              <th className={`py-2.5 px-3 w-[120px] sticky top-0 z-10 border-b ${isTv ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400"}`}>Setor</th>
              <th className={`py-2.5 px-3 w-[90px] sticky top-0 z-10 border-b ${isTv ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400"}`}>Entrega</th>
              <th className={`py-2.5 px-3 text-right w-[140px] sticky top-0 z-10 border-b ${isTv ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 text-slate-400"}`}>Ações</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${
            isTv 
              ? "divide-slate-900" 
              : "divide-slate-100 dark:divide-slate-800/40"
          }`}>
            {sortedItems.map(({ pedido: p, modelo: m }) => {
              const itemStatus = getItemStatus(p, m);
              const isAwaiting = itemStatus === "AGUARDANDO ARTE";
              const isLate = new Date(p.dataPrevistaEntrega) < new Date() && itemStatus !== "CONCLUÍDO";
              let statusBadge = null;
              let rowHighlightClass = "";
              const isCriticalBlock = itemStatus === "BLOQUEADO FINANCEIRO" || itemStatus === "PAUSADO OPERACIONAL";
              const shouldGlow = isTv && (isCriticalBlock || (isLate && (itemStatus === "PRONTO PARA IMPRIMIR" || itemStatus === "EM IMPRESSÃO")));
              
              if (itemStatus === "EM IMPRESSÃO") {
                statusBadge = (
                  <span className="bg-blue-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[9px] uppercase">
                    EM IMPRESSÃO
                  </span>
                );
                rowHighlightClass = isTv 
                  ? "bg-blue-950/20" 
                  : "bg-blue-50/20 dark:bg-blue-950/10";
              } else if (itemStatus === "PRONTO PARA IMPRIMIR") {
                statusBadge = (
                  <span className="bg-emerald-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[9px] uppercase">
                    PRONTO P/ IMPRIMIR
                  </span>
                );
                rowHighlightClass = isTv 
                  ? "bg-slate-900/40 hover:bg-slate-900" 
                  : "hover:bg-slate-50/30 dark:hover:bg-slate-900/20";
              } else if (itemStatus === "PAUSADO OPERACIONAL") {
                statusBadge = (
                  <span className="bg-orange-500 text-white font-extrabold px-1.5 py-0.5 rounded text-[9px] uppercase">
                    PAUSADO OPERACIONAL
                  </span>
                );
                rowHighlightClass = isTv 
                  ? "bg-orange-900/20 border-l-4 border-l-orange-500" 
                  : "bg-orange-50/35 dark:bg-orange-950/10 hover:bg-orange-50/50";
              } else if (itemStatus === "BLOQUEADO FINANCEIRO") {
                statusBadge = (
                  <span className="bg-red-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[9px] uppercase">
                    BLOQUEADO FINANCEIRO
                  </span>
                );
                rowHighlightClass = isTv 
                  ? "bg-red-900/20 border-l-4 border-l-red-500" 
                  : "bg-red-50/35 dark:bg-red-950/10 hover:bg-red-50/50";
              } else if (isAwaiting) {
                statusBadge = (
                  <span className="bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 font-bold px-1.5 py-0.5 rounded text-[9px] uppercase">
                    AGUARDANDO ARTE
                  </span>
                );
                rowHighlightClass = "opacity-55 text-slate-400 dark:text-slate-500 bg-slate-50/20 dark:bg-slate-950/5 hover:opacity-85";
              } else {
                statusBadge = (
                  <span className="bg-slate-100 text-emerald-800 dark:bg-slate-900/60 dark:text-emerald-500 font-bold px-1.5 py-0.5 rounded text-[9px] uppercase">
                    CONCLUÍDO
                  </span>
                );
                rowHighlightClass = "opacity-75 hover:opacity-100";
              }

              if (shouldGlow) {
                if (itemStatus === "BLOQUEADO FINANCEIRO") {
                  rowHighlightClass += " border-l-4 border-l-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.25)] bg-red-900/30";
                } else if (itemStatus === "PAUSADO OPERACIONAL") {
                  rowHighlightClass += " border-l-4 border-l-orange-500 animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.25)] bg-orange-900/30";
                } else if (isLate) {
                  rowHighlightClass += " border-l-4 border-l-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.25)] bg-red-900/15";
                }
              } else if (isTv) {
                if (p.urgente) {
                  rowHighlightClass += " border-l-4 border-l-red-600 shadow-sm";
                }
              } else {
                if (p.urgente && !isAwaiting) {
                  rowHighlightClass += " border-l-2 border-l-red-500";
                }
              }

              return (
                <tr 
                  key={`${p.id_int}-${m.id}`} 
                  className={`transition duration-150 ${rowHighlightClass} ${isTv ? "hover:bg-slate-900/60" : ""}`}
                >
                  <td className={`${cellPadding} font-bold align-middle`}>
                    {statusBadge}
                  </td>
                  <td className={`${cellPadding} align-middle font-medium`}>
                    <div className={`font-mono font-black ${
                      isAwaiting 
                        ? "text-slate-400 dark:text-slate-600 font-normal" 
                        : "text-blue-700 dark:text-blue-400"
                    }`}>
                      OS-{p.id_int}
                      {p.urgente && !isAwaiting && <span className="ml-1 text-red-500 text-[10px]" title="Urgente">⚡</span>}
                    </div>
                    <div className={`truncate max-w-[100px] ${
                      isAwaiting ? "text-slate-400 dark:text-slate-600" : "text-slate-500"
                    } ${textSmall}`} title={p.clienteNome}>
                      {p.clienteNome}
                    </div>
                  </td>
                  <td className={`${cellPadding} align-middle font-medium`}>
                    <div className={`font-bold ${
                      isAwaiting 
                        ? "text-slate-400 dark:text-slate-600 font-normal" 
                        : isTv 
                          ? "text-white" 
                          : "text-slate-900 dark:text-slate-100"
                    } ${textBase}`}>
                      {m.nomeModelo}
                    </div>
                    <div className={`text-slate-400 dark:text-slate-500 truncate max-w-[220px] ${textSmall}`}>
                      {p.produtos?.find(prod => prod.modelos.some(mod => mod.id === m.id))?.nome || "Produto"}
                      {p.dadosEvento?.nome && ` • ${p.dadosEvento.nome}`}
                    </div>
                  </td>
                  <td className={`${cellPadding} align-middle font-mono font-bold text-right ${textBase}`}>
                    {m.quantidade.toLocaleString("pt-BR")}
                  </td>
                  <td className={`${cellPadding} align-middle`}>
                    <div className={`flex flex-wrap gap-1 items-center ${textSmall}`}>
                      {m.corMaterial && (
                        <span className={`px-1.5 py-0.2 rounded font-bold border ${
                          isAwaiting
                            ? "bg-slate-50/50 dark:bg-slate-900/30 text-slate-400 dark:text-slate-600 border-slate-200/20 dark:border-slate-800/20"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/35"
                        }`}>
                          {m.corMaterial}
                        </span>
                      )}
                      {m.verso && (
                        <span className={`px-1.5 py-0.2 rounded border font-bold ${
                          isAwaiting
                            ? "bg-purple-50/30 text-purple-400 dark:bg-purple-950/5 dark:text-purple-600 border-purple-100/20 dark:border-purple-900/20"
                            : "bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400 border-purple-100 dark:border-purple-900/35"
                        }`}>
                          F+V
                        </span>
                      )}
                      {(m.configImpressao.qrCode || m.configImpressao.codBarras) && (
                        <span className={`px-1.5 py-0.2 rounded font-bold ${
                          isAwaiting
                            ? "bg-blue-50/30 text-blue-400 dark:bg-blue-950/5 dark:text-blue-600"
                            : "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400"
                        }`}>
                          VDP
                        </span>
                      )}
                    </div>
                    {m.comentarioInterno && (
                      <p className={`text-slate-450 dark:text-slate-500 italic mt-0.5 truncate max-w-[200px] ${textSmall}`} title={m.comentarioInterno}>
                        &quot;{m.comentarioInterno}&quot;
                      </p>
                    )}
                  </td>
                  <td className={`${cellPadding} align-middle`}>
                    <span className="font-extrabold uppercase text-[9px] text-slate-500">
                      {m.setor}
                    </span>
                  </td>
                  <td className={`${cellPadding} align-middle font-mono font-bold`}>
                    <span className={isLate ? "text-red-600 dark:text-red-400 font-black animate-pulse" : "text-slate-600 dark:text-slate-400"}>
                      {new Date(p.dataPrevistaEntrega).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    </span>
                  </td>
                  <td className={`${cellPadding} align-middle text-right`}>
                    <div className="flex gap-1 justify-end items-center">
                      {itemStatus === "PRONTO PARA IMPRIMIR" && (
                        <button
                          type="button"
                          onClick={() => handleStartPrint(p.id_int, m.id)}
                          className={`bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold transition shadow-sm ${btnHeight}`}
                        >
                          Iniciar
                        </button>
                      )}

                      {itemStatus === "EM IMPRESSÃO" && (
                        <>
                          <button
                            type="button"
                            onClick={() => handlePausePrint(p.id_int)}
                            className={`border border-orange-500 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20 font-bold transition ${btnHeight}`}
                          >
                            Pausar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFinishPrint(p.id_int, m.id)}
                            className={`bg-teal-600 hover:bg-teal-700 text-white font-extrabold transition shadow-sm ${btnHeight}`}
                          >
                            Concluir
                          </button>
                        </>
                      )}

                      {itemStatus === "PAUSADO OPERACIONAL" && (
                        <button
                          type="button"
                          onClick={() => handleResumePrint(p.id_int)}
                          className={`bg-teal-600 hover:bg-teal-700 text-white font-extrabold transition shadow-sm ${btnHeight}`}
                        >
                          Retomar
                        </button>
                      )}

                      {itemStatus === "BLOQUEADO FINANCEIRO" && (
                        <span className="text-[10px] text-red-500/80 font-bold flex items-center gap-0.5 select-none" title="Aguardando liberação do faturamento">
                          <Lock className="h-3 w-3" />
                          <span>Retido Fin.</span>
                        </span>
                      )}

                      {isAwaiting && (
                        <span className="text-slate-300 dark:text-slate-700">—</span>
                      )}

                      {itemStatus === "CONCLUÍDO" && (
                        <span className="text-slate-300 dark:text-slate-700">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Banner de Fila de Impressão */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-blue-900 flex items-start gap-3 text-xs">
        <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-bold text-sm">PCP - Fila de Impressão</h4>
          <p className="text-xs text-blue-700 mt-1">
            Fila priorizada de PCP. Atalhos ativos: <strong className="font-extrabold">U</strong> (Alternar Urgência),{" "}
            <strong className="font-extrabold">L</strong> (Fila Geral) e <strong className="font-extrabold">K</strong>{" "}
            (Kanban). Conectado ao Supabase.
          </p>
        </div>
      </div>

      {renderHeaderSelector()}

      {/* KPI Summary Block */}
      {renderKpis()}

      {/* Filtros Operacionais */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 p-4 rounded-xl shadow-sm space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status buttons */}
          <div className="flex flex-wrap gap-1">
            {(["todos", "prontos", "rodando", "aguardando_arte", "bloqueados", "atrasados"] as const).map((st) => {
              const label = {
                todos: "Todos Ativos",
                prontos: "Prontos para Imprimir",
                rodando: "Em Impressão (Rodando)",
                aguardando_arte: "Aguardando Arte",
                bloqueados: "Bloqueados / Pausados",
                atrasados: "Atrasados"
              }[st];

              const count = allItems.filter(i => {
                const itemStatus = getItemStatus(i.pedido, i.modelo);
                if (st === "todos") return itemStatus !== "CONCLUÍDO";
                if (st === "prontos") return itemStatus === "PRONTO PARA IMPRIMIR";
                if (st === "rodando") return itemStatus === "EM IMPRESSÃO";
                if (st === "aguardando_arte") return itemStatus === "AGUARDANDO ARTE";
                if (st === "bloqueados") return itemStatus === "BLOQUEADO FINANCEIRO" || itemStatus === "PAUSADO OPERACIONAL";
                if (st === "atrasados") return new Date(i.pedido.dataPrevistaEntrega) < new Date() && itemStatus !== "CONCLUÍDO";
                return true;
              }).length;

              const isActive = filterStatus === st;

              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilterStatus(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border ${
                    isActive
                      ? "bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 border-slate-900"
                      : "bg-white hover:bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-950 dark:hover:bg-slate-800 dark:border-slate-800 dark:text-slate-400"
                  }`}
                >
                  <span>{label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-850 text-slate-500"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider text-[10px]">
            HP Indigo 7K Digital • Status: <span className="text-emerald-600 font-black">Operando</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/40">
          <div className="flex flex-wrap items-center gap-3">
            {/* Setor Dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-bold uppercase text-[9px]">Setor:</span>
              <select
                value={filterSetor}
                onChange={(e) => setFilterSetor(e.target.value)}
                className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-700 dark:text-slate-350 focus:outline-none"
              >
                <option value="todos">Todos os Setores</option>
                {sectors.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Material Dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-bold uppercase text-[9px]">Material:</span>
              <select
                value={filterMaterial}
                onChange={(e) => setFilterMaterial(e.target.value)}
                className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-955 text-xs font-bold text-slate-700 dark:text-slate-350 focus:outline-none"
              >
                <option value="todos">Todos os Materiais</option>
                {materials.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Urgent checkbox */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={filterUrgente}
                onChange={(e) => setFilterUrgente(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-800 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-950"
              />
              <Flame className="h-4 w-4 text-red-500" />
              <span>Priorizar Urgentes</span>
            </label>

            {/* Compact mode toggle */}
            <button
              onClick={() => setIsCompact(prev => !prev)}
              className={`h-8 px-3 rounded-xl border text-[10px] font-bold transition flex items-center gap-1 ${
                isCompact
                  ? "bg-[#0b2f4a] border-[#0b2f4a] text-white"
                  : "border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{isCompact ? "Compacto: Ligado" : "Compacto: Desligado"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-1 gap-2 pt-2">
        <div>
          <h2 className="text-sm font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
            <Printer className="h-4 w-4 text-[#0b2f4a] dark:text-blue-450" />
            <span>Fila PCP: O que imprimir agora?</span>
          </h2>
          <p className="text-[10px] text-slate-455 dark:text-slate-500 font-semibold">
            Lista priorizada em tempo real para os operadores de máquina.
          </p>
        </div>
        <span className="text-[10px] text-slate-500 dark:text-slate-450 bg-slate-50 dark:bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-200/30 dark:border-slate-800/30 font-bold select-none">
          Ordem de Máquina: Em Impressão &gt; Prontos &gt; Pausados/Bloqueados &gt; Aguardando Arte
        </span>
      </div>

      {/* Dashboard Content */}
      {renderDashboardContent(false)}

      {/* FULLSCREEN overlay / TV MODE */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-955 p-6 flex flex-col space-y-5 text-slate-100 overflow-hidden">
          <div className="flex justify-between items-center border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black tracking-wide text-white uppercase flex items-center gap-1.5">
                <Printer className="h-5 w-5 text-blue-500" />
                HP INDIGO 7K — FILA DE IMPRESSÃO
              </h2>
              {currentTime && (
                <div className="px-3.5 py-1 bg-slate-900 border border-slate-800 rounded-xl font-mono font-extrabold text-blue-400 flex items-center gap-1 text-sm">
                  <Clock className="h-4 w-4 animate-pulse" />
                  <span>{currentTime}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setIsFullscreen(false)}
              className="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
            >
              <Minimize2 className="h-4 w-4" />
              <span>Sair da TV</span>
            </button>
          </div>

          <div className="flex-grow overflow-y-auto dark">
            {renderDashboardContent(true)}
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {isPauseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 space-y-4 shadow-xl">
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Registrar Pausa na Impressão</h3>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Qual o motivo da interrupção?
              </label>
              <textarea
                placeholder="Ex: Falha de papel, ajuste de cor necessário, falta de bobina..."
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                className="w-full h-20 px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 resize-none focus:outline-none"
              />
            </div>
            <div className="flex gap-2 text-xs">
              <button
                onClick={submitPausa}
                disabled={!pauseReason.trim()}
                className="flex-1 h-9 bg-red-600 disabled:opacity-50 text-white font-bold rounded-xl hover:bg-red-700 transition"
              >
                Confirmar Pausa
              </button>
              <button
                onClick={() => {
                  setIsPauseModalOpen(false);
                  setSelectedPedidoId(null);
                }}
                className="h-9 px-4 border border-slate-200 dark:border-slate-800 rounded-xl font-semibold text-slate-600 dark:text-slate-350 bg-white dark:bg-slate-900"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
