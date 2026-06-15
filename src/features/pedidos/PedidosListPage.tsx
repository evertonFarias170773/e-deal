"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useAppToast } from "@/components/common/AppToast";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { Search, Flame, AlertCircle, RefreshCw, MessageSquare, Clipboard, Layers, CheckCircle2, AlertTriangle, ShieldAlert, Plus } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { listarPedidosOperacionais } from "./services/pedidos-producao.service";
import type { PedidoProducaoListItem, ProdutoMock, ModeloMock } from "./types";

export function PedidosListPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { openChat } = useGlobalChat();
  const [pedidos, setPedidos] = useState<PedidoProducaoListItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const data = await listarPedidosOperacionais();
      setPedidos(data);
      setIsLoaded(true);
    }
    void load();
  }, []);

  // Search & Filter State
  const [search, setSearch] = useState("");
  const [filterEmpresa, setFilterEmpresa] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isCompact, setIsCompact] = useState(false);
  const [sortBy, setSortBy] = useState<"recente" | "antigo" | "urgente" | "atrasado" | "prazo" | "valor" | "parada">("recente");
  const [activeFilter, setActiveFilter] = useState<"all" | "atrasado" | "urgente" | "producao" | "expedicao" | "aguardando_cliente" | "bloqueado" | "hoje" | "semana">("all");

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
      if (key === "k") {
        router.push("/pedidos/kanban");
      } else if (key === "i") {
        router.push("/pedidos/impressao");
      } else if (key === "u") {
        setActiveFilter(prev => prev === "urgente" ? "all" : "urgente");
        showToast({
          type: "info",
          title: "Filtro Rápido",
          description: "Filtro de urgência alternado via atalho de teclado."
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router, showToast]);

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

  const getStatusTone = (status: string) => {
    if (status === "BOLETIM_FINALIZADO") return "info";
    if (status === "APROVADO") return "success";
    if (status === "PENDENTE") return "warning";
    if (status === "BLOQUEADO") return "danger";
    if (status === "NOVO") return "info";
    if (status === "ARTE_EM_ANDAMENTO") return "info";
    if (status === "AGUARDANDO_APROVACAO_CLIENTE" || status === "AGUARDANDO_APROVACAO_ATENDENTE") return "warning";
    if (status === "AGUARDANDO_OS") return "special";
    if (status === "EM_IMPRESSAO" || status === "EM_ACABAMENTO" || status === "REVISAO_FINAL") return "info";
    if (status === "PRONTO_EXPEDICAO" || status === "EXPEDIDO") return "success";
    return "neutral";
  };

  const getArteBadgeColor = (status: string) => {
    if (status === "LIBERADA") return "bg-teal-100 text-teal-850 border-teal-200 dark:bg-teal-955 dark:text-teal-400 dark:border-teal-900";
    if (status === "REPROVADA_CLIENTE") return "bg-red-100 text-red-855 border-red-200 dark:bg-red-955 dark:text-red-400 dark:border-red-900";
    if (status === "PENDENTE") return "bg-slate-100 text-slate-700 border-slate-205 dark:bg-slate-800 dark:text-slate-450 dark:border-slate-700";
    return "bg-amber-100 text-amber-855 border-amber-200 dark:bg-amber-955 dark:text-amber-400 dark:border-amber-905"; // AGUARDANDO_CLIENTE, EM_REVISAO_INTERNA
  };

  const calculateArteProgress = (pedido: PedidoProducaoListItem) => {
    const modelosList = pedido.produtos ? pedido.produtos.flatMap((p: ProdutoMock) => p.modelos) : pedido.modelos || [];
    if (!modelosList.length) return 0;
    const aprovadas = modelosList.filter((m: ModeloMock) => m.statusArte === "LIBERADA" || m.statusArte === "NAO_NECESSARIA").length;
    return Math.round((aprovadas / modelosList.length) * 100);
  };

  const calculateProducaoProgress = (pedido: PedidoProducaoListItem) => {
    if (pedido.statusPedido === "PRONTO_EXPEDICAO" || pedido.statusPedido === "EXPEDIDO") return 100;
    if (pedido.statusPedido === "REVISAO_FINAL") return 80;
    if (pedido.statusPedido === "EM_ACABAMENTO") return 60;
    if (pedido.statusPedido === "EM_IMPRESSAO") return 30;
    return 0;
  };

  const isPedidoAtrasado = (p: PedidoProducaoListItem) => {
    if (p.statusPedido === "EXPEDIDO" || p.statusPedido === "CANCELADO") return false;
    const deliveryDate = new Date(p.dataPrevistaEntrega);
    const today = new Date("2026-06-02");
    return deliveryDate < today;
  };

  const isPedidoBloqueado = (p: PedidoProducaoListItem) => {
    return p.financialBlock || Boolean(p.blockReason) || p.status_producao === "BLOQUEADO" || p.status_expedicao === "BLOQUEADO";
  };

  // Filter calculations
  const totalCount = pedidos.length;
  const atrasadosCount = pedidos.filter(p => isPedidoAtrasado(p)).length;
  const urgentesCount = pedidos.filter(p => p.urgente).length;
  const producaoCount = pedidos.filter(p => 
    ["EM_IMPRESSAO", "EM_ACABAMENTO", "REVISAO_FINAL"].includes(p.statusPedido) ||
    ["EM_IMPRESSAO", "EM_ACABAMENTO", "REVISAO_FINAL", "PRODUCAO"].includes(p.status_producao || "")
  ).length;
  const expedicaoCount = pedidos.filter(p => 
    ["PRONTO_EXPEDICAO", "EXPEDIDO"].includes(p.statusPedido) ||
    ["PRONTO_EXPEDICAO", "EXPEDIDO", "PRONTO", "EXPEDICAO"].includes(p.status_expedicao || "")
  ).length;
  const aguardandoClienteCount = pedidos.filter(p => 
    p.statusPedido === "AGUARDANDO_APROVACAO_CLIENTE" ||
    p.status_arte === "AGUARDANDO_CLIENTE"
  ).length;
  const bloqueadosCount = pedidos.filter(p => isPedidoBloqueado(p)).length;
  const hojeCount = pedidos.filter(p => p.dataPrevistaEntrega === "2026-06-02" && p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO").length;
  const semanaCount = pedidos.filter(p => {
    const t = new Date(p.dataPrevistaEntrega).getTime();
    const todayTime = new Date("2026-06-02").getTime();
    return t >= todayTime && t <= todayTime + 7 * 24 * 60 * 60 * 1000 && p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO";
  }).length;

  // Filter logic
  const filteredPedidos = pedidos.filter((p) => {
    const matchesSearch =
      search === "" ||
      p.clienteNome.toLowerCase().includes(search.toLowerCase()) ||
      String(p.id_int).includes(search) ||
      p.vendedor.toLowerCase().includes(search.toLowerCase()) ||
      p.empresa.toLowerCase().includes(search.toLowerCase()) ||
      (p.dadosEvento?.nome && p.dadosEvento.nome.toLowerCase().includes(search.toLowerCase())) ||
      (p.obs && p.obs.toLowerCase().includes(search.toLowerCase())) ||
      (p.briefingOperacional && p.briefingOperacional.toLowerCase().includes(search.toLowerCase())) ||
      (p.produtos && p.produtos.some((prod: ProdutoMock) => 
        prod.nome.toLowerCase().includes(search.toLowerCase()) ||
        prod.modelos.some((m: ModeloMock) => m.nomeModelo.toLowerCase().includes(search.toLowerCase()))
      ));

    const matchesEmpresa =
      filterEmpresa === "all" ||
      p.empresa.toLowerCase().replace(" ", "") === filterEmpresa.toLowerCase().replace(" ", "");

    const matchesStatus = filterStatus === "all" || p.statusPedido === filterStatus;

    let matchesQuickFilter = true;
    if (activeFilter === "atrasado") {
      matchesQuickFilter = isPedidoAtrasado(p);
    } else if (activeFilter === "urgente") {
      matchesQuickFilter = p.urgente;
    } else if (activeFilter === "producao") {
      matchesQuickFilter = ["EM_IMPRESSAO", "EM_ACABAMENTO", "REVISAO_FINAL"].includes(p.statusPedido) || ["EM_IMPRESSAO", "EM_ACABAMENTO", "REVISAO_FINAL", "PRODUCAO"].includes(p.status_producao || "");
    } else if (activeFilter === "expedicao") {
      matchesQuickFilter = ["PRONTO_EXPEDICAO", "EXPEDIDO"].includes(p.statusPedido) || ["PRONTO_EXPEDICAO", "EXPEDIDO", "PRONTO", "EXPEDICAO"].includes(p.status_expedicao || "");
    } else if (activeFilter === "aguardando_cliente") {
      matchesQuickFilter = p.statusPedido === "AGUARDANDO_APROVACAO_CLIENTE" || p.status_arte === "AGUARDANDO_CLIENTE";
    } else if (activeFilter === "bloqueado") {
      matchesQuickFilter = isPedidoBloqueado(p);
    } else if (activeFilter === "hoje") {
      matchesQuickFilter = p.dataPrevistaEntrega === "2026-06-02" && p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO";
    } else if (activeFilter === "semana") {
      const t = new Date(p.dataPrevistaEntrega).getTime();
      const todayTime = new Date("2026-06-02").getTime();
      matchesQuickFilter = t >= todayTime && t <= todayTime + 7 * 24 * 60 * 60 * 1000 && p.statusPedido !== "EXPEDIDO" && p.statusPedido !== "CANCELADO";
    }

    return matchesSearch && matchesEmpresa && matchesStatus && matchesQuickFilter;
  });

  // Sort logic
  const sortedPedidos = [...filteredPedidos].sort((a, b) => {
    if (sortBy === "urgente") {
      if (a.urgente && !b.urgente) return -1;
      if (!a.urgente && b.urgente) return 1;
      return b.id_int - a.id_int;
    }
    if (sortBy === "atrasado") {
      const aTime = new Date(a.dataPrevistaEntrega).getTime();
      const bTime = new Date(b.dataPrevistaEntrega).getTime();
      return aTime - bTime;
    }
    if (sortBy === "prazo") {
      const aTime = new Date(a.dataPrevistaEntrega).getTime();
      const bTime = new Date(b.dataPrevistaEntrega).getTime();
      return aTime - bTime;
    }
    if (sortBy === "valor") {
      return b.valorTotal - a.valorTotal;
    }
    if (sortBy === "parada") {
      const aParado = a.blockReason ? 1 : 0;
      const bParado = b.blockReason ? 1 : 0;
      if (aParado !== bParado) return bParado - aParado;
      return b.id_int - a.id_int;
    }
    if (sortBy === "antigo") {
      return a.id_int - b.id_int;
    }
    // "recente"
    return b.id_int - a.id_int;
  });

  if (!isLoaded) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent mx-auto"></div>
          <p className="text-slate-500 font-semibold text-sm">Carregando lista de pedidos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 font-sans">
      {/* Banner de Protótipo UX */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3.5 text-blue-900 flex items-start justify-between gap-4 text-xs">
        <div className="flex gap-2">
          <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold uppercase tracking-wider text-xs">PCP / Fila Operacional Gráfica</h4>
            <p className="text-[11px] text-blue-700 mt-0.5 leading-relaxed">
              Fila estruturada de alta densidade para gestão rápida do fluxo gráfico. Sincronizado com o banco de dados Supabase.
            </p>
          </div>
        </div>
      </div>

      {/* Header compact */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/40 dark:border-slate-800/30 pb-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Clipboard className="h-5 w-5 text-[#0b2f4a]" />
            <span>Fila Operacional de OS</span>
          </h2>
          <p className="text-xs text-slate-500 font-semibold">Controle integrado de ordens de serviço por produto e modelo</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/pedidos/novo"
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
          >
            <Plus className="h-4 w-4" />
            <span>Novo Boletim (Abertura OS)</span>
          </Link>
          <button
            onClick={() => setIsCompact(!isCompact)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition flex items-center gap-1.5 ${
              isCompact
                ? "bg-[#0b2f4a] border-[#0b2f4a] text-white"
                : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-800 dark:text-slate-355"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>{isCompact ? "Modo Tabela PCP" : "Modo Planilha Super Densa"}</span>
          </button>
        </div>
      </div>

      {/* Navegação de Modos */}
      <div className="flex justify-between items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 p-1.5 rounded-xl text-xs">
        <div className="flex flex-wrap gap-1">
          <Link
            href="/pedidos"
            className="px-3 py-1.5 font-bold rounded-lg bg-[#0b2f4a] text-white transition"
          >
            Fila Geral
          </Link>
          <Link
            href="/pedidos/kanban"
            className="px-3 py-1.5 font-bold rounded-lg text-slate-650 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Kanban Board
          </Link>
          <Link
            href="/pedidos/impressao"
            className="px-3 py-1.5 font-bold rounded-lg text-slate-650 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Fila de Impressão
          </Link>
          <Link
            href="/expedicao"
            className="px-3 py-1.5 font-bold rounded-lg text-slate-650 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Painel Expedição
          </Link>
        </div>
        <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-mono font-bold px-2 py-1 rounded hidden sm:inline">
          PCP Fila Geral ({filteredPedidos.length} / {totalCount})
        </span>
      </div>

      {/* Filtros Rápidos (Barra de Badges) */}
      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1.5">
        {[
          { key: "all", label: "Tudo", count: totalCount, style: "border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-400" },
          { key: "atrasado", label: "Atrasados", count: atrasadosCount, style: "border-red-200 bg-red-50/20 text-red-700 dark:border-red-950 dark:text-red-400 hover:bg-red-50/50" },
          { key: "urgente", label: "Urgentes", count: urgentesCount, style: "border-red-250 bg-red-50 text-red-800 dark:border-red-900/50 dark:text-red-400 hover:bg-red-100/40 animate-pulse" },
          { key: "producao", label: "Produção", count: producaoCount, style: "border-orange-200 bg-orange-50/20 text-orange-700 dark:border-orange-900 dark:text-orange-400 hover:bg-orange-50/50" },
          { key: "expedicao", label: "Expedição", count: expedicaoCount, style: "border-teal-200 bg-teal-50/15 text-teal-700 dark:border-teal-900 dark:text-teal-400 hover:bg-teal-50/50" },
          { key: "aguardando_cliente", label: "Aguardando Clie.", count: aguardandoClienteCount, style: "border-blue-200 bg-blue-50/10 text-blue-700 dark:border-blue-900 dark:text-blue-400 hover:bg-blue-50/50" },
          { key: "bloqueado", label: "Bloqueados", count: bloqueadosCount, style: "border-amber-200 bg-amber-50/20 text-amber-700 dark:border-amber-900 dark:text-amber-450 hover:bg-amber-50/50" },
          { key: "hoje", label: "Prazo Hoje", count: hojeCount, style: "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:text-slate-200 hover:bg-slate-200/55" },
          { key: "semana", label: "Esta Semana", count: semanaCount, style: "border-purple-200 bg-purple-50/10 text-purple-700 dark:border-purple-900 dark:text-purple-400 hover:bg-purple-50/50" }
        ].map((btn) => (
          <button
            key={btn.key}
            type="button"
            onClick={() => setActiveFilter(btn.key as typeof activeFilter)}
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
      <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 p-4 rounded-xl shadow-xs grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        {/* Campo Busca */}
        <div className="relative col-span-1 md:col-span-1">
          <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por OS, Cliente, Vendedor, Modelo..."
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

        {/* Status dropdown */}
        <div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full h-9 px-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
          >
            <option value="all">Fase do Pedido: Todos</option>
            <option value="BOLETIM_FINALIZADO">Boletim Finalizado</option>
            <option value="BLOQUEADO">Bloqueado/Bloqueio</option>
            <option value="NOVO">Novo</option>
            <option value="ARTE_EM_ANDAMENTO">Arte em Desenvolvimento</option>
            <option value="AGUARDANDO_APROVACAO_CLIENTE">Prova Digital no Cliente</option>
            <option value="AGUARDANDO_APROVACAO_ATENDENTE">Aguardando Atendente</option>
            <option value="AGUARDANDO_OS">OS Aguardando Emissão</option>
            <option value="EM_IMPRESSAO">Chão de Fábrica: Impressão</option>
            <option value="EM_ACABAMENTO">Chão de Fábrica: Acabamento</option>
            <option value="REVISAO_FINAL">Controle de Qualidade (Revisão)</option>
            <option value="PRONTO_EXPEDICAO">Pronto para Expedição / Balança</option>
            <option value="EXPEDIDO">Expedido / Entregue</option>
            <option value="CANCELADO">Cancelado</option>
          </select>
        </div>

        {/* Ordenação dropdown */}
        <div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="w-full h-9 px-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
          >
            <option value="recente">Ordem: Recentes</option>
            <option value="antigo">Ordem: FIFO (Antigos)</option>
            <option value="urgente">Ordem: Urgentes Primeiro</option>
            <option value="atrasado">Ordem: Mais Atrasado</option>
            <option value="prazo">Ordem: Prazo mais próximo</option>
            <option value="valor">Ordem: Maior Valor Financeiro</option>
            <option value="parada">Ordem: Paradas / Pausas de OS</option>
          </select>
        </div>
      </div>

      {/* Grid de Pedidos */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 rounded-xl overflow-hidden shadow-xs">
        {pedidos.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nenhum pedido em produção"
              description="Os pedidos aparecerão aqui quando forem liberados pelo boletim finalizado."
            />
          </div>
        ) : sortedPedidos.length > 0 ? (
          !isCompact ? (
            /* VISUAL PRINCIPAL PCP: TABELA INDUSTRIAL */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 uppercase text-[9px] font-black tracking-wider border-b border-slate-200/40 dark:border-slate-800/30">
                    <th className="py-2.5 px-4 w-28">Nº OS / Empresa</th>
                    <th className="py-2.5 px-3">Cliente</th>
                    <th className="py-2.5 px-3">Fase & Status</th>
                    <th className="py-2.5 px-3 w-40">Progresso Geral</th>
                    <th className="py-2.5 px-3">Modelos (Lotes)</th>
                    <th className="py-2.5 px-3">Alertas Logístico-Operacionais</th>
                    <th className="py-2.5 px-3 w-28">Prazo / Entrega</th>
                    <th className="py-2.5 px-3 w-24">Valor OS</th>
                    <th className="py-2.5 px-4 text-right w-24">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-850/50">
                  {sortedPedidos.map((p) => {
                    const models = p.produtos ? p.produtos.flatMap(prod => prod.modelos) : p.modelos || [];
                    const arteProgress = calculateArteProgress(p);
                    const prodProgress = calculateProducaoProgress(p);
                    const atrasado = isPedidoAtrasado(p);
                    const bloqueado = isPedidoBloqueado(p);
                    const hasReproved = models.some(m => m.statusArte === "REPROVADA_CLIENTE");
                    const hasPendingArte = models.some(m => m.statusArte === "PENDENTE");

                    return (
                      <tr
                        key={p.id_int}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-950/20 font-medium ${
                          p.urgente ? "bg-red-50/10 dark:bg-red-950/5" : ""
                        } ${atrasado ? "bg-red-500/5 dark:bg-red-550/5 border-l-4 border-l-red-550" : ""}`}
                      >
                        {/* OS / Empresa */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col">
                            <span className="font-black text-[#0b2f4a] dark:text-blue-400 text-sm flex items-center gap-1">
                              #{p.id_int}
                              {p.urgente && (
                                <span title="URGENTE"><Flame className="h-3.5 w-3.5 text-red-500 animate-pulse shrink-0" /></span>
                              )}
                            </span>
                            <span className="text-[10px] text-slate-400 font-bold uppercase truncate tracking-tight">{p.empresa}</span>
                          </div>
                        </td>

                        {/* Cliente */}
                        <td className="py-3.5 px-3">
                          <div className="flex flex-col">
                            <strong className="text-slate-900 dark:text-slate-100 text-xs truncate max-w-[150px]">{p.clienteNome}</strong>
                            <span className="text-[10px] text-slate-450 truncate">Vendedor: {p.vendedor}</span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-3">
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={p.statusPedido} tone={getStatusTone(p.statusPedido)} />
                          </div>
                        </td>

                        {/* Progresso */}
                        <td className="py-3.5 px-3">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] text-slate-500 font-bold">
                              <span>Arte: {arteProgress}%</span>
                              <span>Fábrica: {prodProgress}%</span>
                            </div>
                            <div className="flex gap-1">
                              <div className="w-1/2 bg-slate-100 dark:bg-slate-800 rounded-full h-1 overflow-hidden">
                                <div className="bg-blue-600 h-1 rounded-full" style={{ width: `${arteProgress}%` }}></div>
                              </div>
                              <div className="w-1/2 bg-slate-100 dark:bg-slate-800 rounded-full h-1 overflow-hidden">
                                <div className="bg-teal-600 h-1 rounded-full" style={{ width: `${prodProgress}%` }}></div>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Modelos pills */}
                        <td className="py-3.5 px-3">
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {models.length === 0 ? (
                              <span className="text-slate-400 text-[10px] italic">Ainda sem modelos</span>
                            ) : (
                              <>
                                {models.slice(0, 3).map((m) => (
                                  <span
                                    key={m.id}
                                    className={`text-[9px] font-bold border rounded-md px-1.5 py-0.2 uppercase tracking-wide truncate max-w-[100px] ${getArteBadgeColor(
                                      m.statusArte
                                    )}`}
                                    title={`${m.nomeModelo} - ${m.statusArte}`}
                                  >
                                    {m.nomeModelo.split(" (")[0]}
                                  </span>
                                ))}
                                {models.length > 3 && (
                                  <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 p-0.5 px-1 rounded-md">
                                    +{models.length - 3}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </td>

                        {/* Alertas */}
                        <td className="py-3.5 px-3">
                          <div className="flex flex-col gap-1 max-w-[200px]">
                            {p.financialBlock && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-[9px] font-black uppercase tracking-wider">
                                <ShieldAlert className="h-3 w-3 shrink-0" />
                                <span>🔒 Bloqueio Financeiro</span>
                              </span>
                            )}
                            {p.blockReason && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 text-[9px] font-black uppercase tracking-wider animate-pulse">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span>⚠️ Pausa: {p.blockReason}</span>
                              </span>
                            )}
                            {hasReproved && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-[9px] font-black uppercase tracking-wider">
                                <span>❌ Arte Reprovada</span>
                              </span>
                            )}
                            {hasPendingArte && !hasReproved && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-black uppercase tracking-wider">
                                <span>🎨 Arte Pendente</span>
                              </span>
                            )}
                            {!bloqueado && !hasReproved && !hasPendingArte && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-black uppercase tracking-wider">
                                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                <span>Lote Ok</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Prazo */}
                        <td className="py-3.5 px-3">
                          <div className="flex flex-col">
                            <span className={`font-bold font-mono ${atrasado ? "text-red-600 dark:text-red-400 font-extrabold flex items-center gap-0.5" : "text-slate-700 dark:text-slate-300"}`}>
                              {formatDate(p.dataPrevistaEntrega)}
                            </span>
                            {atrasado && (
                              <span className="text-[9px] text-red-600 font-black uppercase tracking-wide animate-pulse">
                                Atrasado
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Valor */}
                        <td className="py-3.5 px-3">
                          <strong className="text-slate-800 dark:text-slate-200 font-mono text-xs">{formatCurrency(p.valorTotal)}</strong>
                        </td>

                        {/* Ações */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openChat(p.id_int, { clienteNome: p.clienteNome, idCliente: p.idCliente })}
                              className="h-7 w-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-850 flex items-center justify-center transition shrink-0"
                              title="Chat OS"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </button>
                            <Link
                              href={`/pedidos/${p.id_int}`}
                              className="h-7 px-2.5 bg-[#0b2f4a] hover:bg-[#123f61] text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition"
                              title="Abrir Ficha"
                            >
                              <Clipboard className="h-3 w-3" />
                              <span>Ficha</span>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* MODO COMPACTO REAL: PLANILHA SUPER DENSA */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse font-mono">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 uppercase text-[9px] font-black border-b border-slate-200/40 dark:border-slate-800/30">
                    <th className="py-1 px-3 w-20">OS</th>
                    <th className="py-1 px-2">Cliente & Empresa</th>
                    <th className="py-1 px-2">Fase</th>
                    <th className="py-1 px-2">Progresso</th>
                    <th className="py-1 px-2 w-28">Entrega</th>
                    <th className="py-1 px-2">Ocorrências / Alertas</th>
                    <th className="py-1 px-2 w-20">Valor</th>
                    <th className="py-1 px-2 w-16">Vend.</th>
                    <th className="py-1 px-3 text-right w-16">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/45">
                  {sortedPedidos.map((p) => {
                    const models = p.produtos ? p.produtos.flatMap(prod => prod.modelos) : p.modelos || [];
                    const arteProgress = calculateArteProgress(p);
                    const prodProgress = calculateProducaoProgress(p);
                    const atrasado = isPedidoAtrasado(p);
                    const bloqueado = isPedidoBloqueado(p);

                    return (
                      <tr
                        key={p.id_int}
                        className={`hover:bg-slate-100/70 dark:hover:bg-slate-850/40 h-8 ${
                          p.urgente ? "bg-red-50/20 dark:bg-red-950/10 font-bold" : ""
                        } ${atrasado ? "bg-red-500/10 dark:bg-red-550/10" : ""}`}
                      >
                        {/* ID */}
                        <td className="py-1 px-3">
                          <span className={`font-black ${p.urgente ? "text-red-600 dark:text-red-400 animate-pulse" : "text-slate-800 dark:text-slate-200"}`}>
                            #{p.id_int}
                          </span>
                          {p.urgente && <span className="text-[8px] text-red-550 ml-1">🔥</span>}
                        </td>

                        {/* Cliente */}
                        <td className="py-1 px-2 truncate max-w-[200px]" title={`${p.clienteNome} (${p.empresa})`}>
                          <span className="text-slate-900 dark:text-slate-100 font-extrabold">{p.clienteNome}</span>
                          <span className="text-[9px] text-slate-400 ml-1">({p.empresa})</span>
                        </td>

                        {/* Status */}
                        <td className="py-1 px-2">
                          <span className="text-[9px] font-black uppercase text-slate-700 dark:text-slate-300">
                            {p.statusPedido.replace(/_/g, " ")}
                          </span>
                        </td>

                        {/* Progresso */}
                        <td className="py-1 px-2 text-slate-600 dark:text-slate-400">
                          A:{arteProgress}%|F:{prodProgress}%
                        </td>

                        {/* Prazo */}
                        <td className={`py-1 px-2 ${atrasado ? "bg-red-100 dark:bg-red-950/40 text-red-700 font-black" : "text-slate-700 dark:text-slate-300"}`}>
                          {p.dataPrevistaEntrega} {atrasado ? "⚠️" : ""}
                        </td>

                        {/* Alertas */}
                        <td className="py-1 px-2 truncate max-w-[240px]">
                          {p.financialBlock && (
                            <span className="text-red-600 dark:text-red-400 font-black mr-2">🔒 FINANCIERO BLOQ.</span>
                          )}
                          {p.blockReason && (
                            <span className="text-amber-600 dark:text-amber-400 font-black mr-2">⚠️ PAUSA: {p.blockReason}</span>
                          )}
                          {models.some(m => m.statusArte === "REPROVADA_CLIENTE") && (
                            <span className="text-red-500 font-black mr-2">❌ ARTE REPROVADA</span>
                          )}
                          {!bloqueado && !models.some(m => m.statusArte === "REPROVADA_CLIENTE") && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ OS NORMAL</span>
                          )}
                        </td>

                        {/* Valor */}
                        <td className="py-1 px-2 font-bold text-slate-800 dark:text-slate-200">
                          {formatCurrency(p.valorTotal)}
                        </td>

                        {/* Vendedor */}
                        <td className="py-1 px-2 text-slate-450">
                          {p.vendedor.split(" ")[0]}
                        </td>

                        {/* Ações */}
                        <td className="py-1 px-3 text-right">
                          <div className="flex justify-end gap-1 font-bold">
                            <button
                              onClick={() => openChat(p.id_int, { clienteNome: p.clienteNome, idCliente: p.idCliente })}
                              className="text-blue-600 hover:text-blue-800 px-1 hover:underline text-[10px]"
                            >
                              Chat
                            </button>
                            <span className="text-slate-300">|</span>
                            <Link
                              href={`/pedidos/${p.id_int}`}
                              className="text-slate-800 dark:text-slate-300 hover:text-slate-950 px-1 hover:underline text-[10px]"
                            >
                              Ficha
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-slate-500">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-slate-400" />
            <p className="font-bold text-sm">Nenhum pedido atende a estes filtros de busca.</p>
            <button
              onClick={() => {
                setSearch("");
                setFilterEmpresa("all");
                setFilterStatus("all");
                setActiveFilter("all");
              }}
              className="mt-3 inline-flex items-center gap-1 px-4 py-2 bg-[#0b2f4a] hover:bg-[#123f61] text-white rounded-xl text-xs font-bold transition"
            >
              <span>Limpar Filtros</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
