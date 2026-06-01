"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import {
  listAllPropostasPendencias,
  updatePropostaPendenciaStatus,
  type PropostaPendenciaJoined
} from "@/features/orcamentos/services/propostas-pendencias.service";
import { listAllUsuarios, type ChatUsuario } from "@/features/orcamentos/services/orcamentos.service";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { PageHeader } from "@/components/common/PageHeader";
import { SummaryCard } from "@/components/common/SummaryCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { cn } from "@/lib/utils";
import {
  Search,
  Calendar,
  User,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  ChevronDown,
  SlidersHorizontal,
  RefreshCw,
  Play,
  Check,
  X,
  Users,
  CheckSquare,
  AlertCircle,
  Eye,
  Loader2
} from "lucide-react";
import Link from "next/link";

const CATEGORIES = [
  { value: "CREDITO", label: "Crédito e Cadastro", tone: "warning" as const },
  { value: "DOCUMENTO", label: "Falta de Documentos", tone: "info" as const },
  { value: "PAGAMENTO", label: "Pagamento e Checkout", tone: "special" as const },
  { value: "COMERCIAL", label: "Ajuste Comercial / Frete", tone: "success" as const },
  { value: "PRODUCAO", label: "Arquivos / Produção", tone: "neutral" as const },
  { value: "FISCAL", label: "Divergência Fiscal", tone: "danger" as const },
  { value: "OUTRO", label: "Outro Motivo", tone: "neutral" as const }
];

const PRIORITIES = [
  { value: "BAIXA", label: "Baixa", tone: "neutral" as const },
  { value: "MEDIA", label: "Média", tone: "info" as const },
  { value: "ALTA", label: "Alta", tone: "warning" as const },
  { value: "URGENTE", label: "Urgente", tone: "danger" as const }
];

const SECTORS = [
  { value: "COMERCIAL", label: "Comercial" },
  { value: "CREDITO", label: "Crédito / Análise" },
  { value: "FINANCEIRO", label: "Financeiro / Faturamento" },
  { value: "PRODUCAO", label: "Produção / Layout" },
  { value: "FISCAL", label: "Fiscal" },
  { value: "EXPEDICAO", label: "Expedição / Logística" }
];

export default function PendenciasPage() {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const { openChat } = useGlobalChat();

  const [rawPendencias, setRawPendencias] = useState<PropostaPendenciaJoined[]>([]);
  const [users, setUsers] = useState<ChatUsuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("TODOS");
  const [selectedPriority, setSelectedPriority] = useState("TODOS");
  const [selectedCategory, setSelectedCategory] = useState("TODOS");
  const [selectedSector, setSelectedSector] = useState("TODOS");
  const [selectedCompany, setSelectedCompany] = useState("TODAS");
  const [quickTab, setQuickTab] = useState<"todas" | "minhas" | "setor" | "sem_responsavel" | "urgentes" | "atrasadas" | "concluidas_hoje">("todas");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Pagination State
  const [limit, setLimit] = useState(25);

  const triggerRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
    // Dispatch custom event to notify Topbar to update count
    window.dispatchEvent(new Event("pendencias-updated"));
  }, []);

  // Listen to realtime updates propagated from Topbar
  useEffect(() => {
    const handleRealtime = () => {
      console.log("[PendenciasPage] Realtime update captured.");
      triggerRefresh();
    };
    window.addEventListener("propostas-pendencias-realtime", handleRealtime);
    return () => {
      window.removeEventListener("propostas-pendencias-realtime", handleRealtime);
    };
  }, [triggerRefresh]);

  // Fetch users list only once on mount
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const usersRes = await listAllUsuarios();
        if (active) {
          setUsers(usersRes);
        }
      } catch (err) {
        console.error("[PendenciasPage] Erro ao carregar usuários:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Fetch initial pendencias data and update on refresh
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const pendenciasRes = await listAllPropostasPendencias({ limit: 1000 });

        if (!active) return;

        if (pendenciasRes.success) {
          setRawPendencias(pendenciasRes.data);
        } else {
          setErrorMsg(pendenciasRes.errorMessage || "Não foi possível buscar as pendências.");
        }
      } catch (err) {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : "Erro inesperado ao carregar dados.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [refreshTrigger]);

  const handleUpdateStatus = async (
    id: number,
    idInt: number,
    idCliente: number | null,
    status: "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA",
    titulo: string
  ) => {
    if (!user) return;
    setActionLoadingId(id);
    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      sector: user.sector || null
    };

    try {
      const res = await updatePropostaPendenciaStatus(id, idInt, idCliente, status, titulo, userPayload);
      if (res.success) {
        showToast({
          title: "Status Atualizado",
          description: `Pendência marcada como ${status} e timeline registrada.`,
          type: "success"
        });
        triggerRefresh();
      } else {
        showToast({
          title: "Falha de RLS / Permissão",
          description: res.errorMessage || "Você não tem autorização para atualizar esta pendência.",
          type: "error"
        });
      }
    } catch (err) {
      showToast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro ao atualizar status.",
        type: "error"
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const getUsernameFromId = (userId: string | null) => {
    if (!userId) return "Não designado";
    const found = users.find((u) => u.user_id === userId);
    return found ? found.nome_usuario : "Usuário desconhecido";
  };

  const getCategoryLabel = (cat: string) => {
    return CATEGORIES.find((c) => c.value === cat)?.label || cat;
  };

  const getPriorityTone = (prio: string) => {
    return PRIORITIES.find((p) => p.value === prio)?.tone || "neutral";
  };

  // Helper date strings
  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Compute metric counts strictly avoiding redundant query calls
  const metrics = useMemo(() => {
    const stats = {
      minhas: 0,
      setor: 0,
      semResponsavel: 0,
      urgentes: 0,
      atrasadas: 0,
      concluidasHoje: 0
    };

    rawPendencias.forEach((item) => {
      const isActive = item.status === "ABERTA" || item.status === "EM_ANDAMENTO";

      if (isActive) {
        // Minhas Pendências
        if (user && item.responsavel_user_id === user.id) {
          stats.minhas++;
        }
        // Pendências do meu setor (priorizando sem responsável individual para evitar ruído)
        if (user && item.responsavel_setor === user.sector && !item.responsavel_user_id) {
          stats.setor++;
        }
        // Sem responsável
        if (!item.responsavel_user_id) {
          stats.semResponsavel++;
        }
        // Urgentes
        if (item.prioridade === "URGENTE") {
          stats.urgentes++;
        }
        // Atrasadas
        if (item.data_limite && item.data_limite < todayStr) {
          stats.atrasadas++;
        }
      }

      // Concluídas hoje
      if (item.status === "CONCLUIDA" && item.concluido_at) {
        if (item.concluido_at.split("T")[0] === todayStr) {
          stats.concluidasHoje++;
        }
      }
    });

    return stats;
  }, [rawPendencias, user, todayStr]);

  // Compute unique companies dynamically from data
  const companiesList = useMemo(() => {
    const unique = new Set<string>();
    rawPendencias.forEach((item) => {
      if (item.propostas?.empresa) {
        unique.add(item.propostas.empresa);
      }
    });
    return Array.from(unique).sort();
  }, [rawPendencias]);

  // In-Memory filtering for fast UI updates
  const filteredPendencias = useMemo(() => {
    return rawPendencias.filter((item) => {
      const isActive = item.status === "ABERTA" || item.status === "EM_ANDAMENTO";

      // 1. Text Search Filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        const matchesText =
          item.titulo.toLowerCase().includes(term) ||
          item.descricao.toLowerCase().includes(term) ||
          String(item.id_int).includes(term) ||
          (item.propostas?.cliente && item.propostas.cliente.toLowerCase().includes(term));
        
        if (!matchesText) return false;
      }

      // 2. Dropdown Filters
      if (selectedStatus !== "TODOS" && item.status !== selectedStatus) return false;
      if (selectedPriority !== "TODOS" && item.prioridade !== selectedPriority) return false;
      if (selectedCategory !== "TODOS" && item.categoria !== selectedCategory) return false;
      if (selectedSector !== "TODOS" && item.responsavel_setor !== selectedSector) return false;
      if (selectedCompany !== "TODAS" && item.propostas?.empresa !== selectedCompany) return false;

      // 3. Quick Tabs Filter
      if (quickTab === "minhas") {
        if (item.responsavel_user_id !== user?.id || !isActive) return false;
      } else if (quickTab === "setor") {
        if (item.responsavel_setor !== user?.sector || item.responsavel_user_id || !isActive) return false;
      } else if (quickTab === "sem_responsavel") {
        if (item.responsavel_user_id || !isActive) return false;
      } else if (quickTab === "urgentes") {
        if (item.prioridade !== "URGENTE" || !isActive) return false;
      } else if (quickTab === "atrasadas") {
        if (!item.data_limite || item.data_limite >= todayStr || !isActive) return false;
      } else if (quickTab === "concluidas_hoje") {
        if (item.status !== "CONCLUIDA" || !item.concluido_at || item.concluido_at.split("T")[0] !== todayStr) return false;
      }

      return true;
    });
  }, [rawPendencias, searchTerm, selectedStatus, selectedPriority, selectedCategory, selectedSector, selectedCompany, quickTab, user, todayStr]);

  // Paginated/Limited view
  const displayedPendencias = useMemo(() => {
    return filteredPendencias.slice(0, limit);
  }, [filteredPendencias, limit]);

  return (
    <div className="space-y-6 p-4 lg:p-6" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {/* Header */}
      <PageHeader
        title="Central de Pendências"
        subtitle="Monitore, organize e resolva impedimentos operacionais vinculados às propostas comerciais."
        context="Visão Geral"
        action={
          <button
            type="button"
            onClick={triggerRefresh}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white px-4 py-2.5 text-xs font-bold transition shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 ${loading && "animate-spin"}`} />
            Atualizar Painel
          </button>
        }
      />

      {/* Summary Cards Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div onClick={() => setQuickTab("minhas")} className="cursor-pointer">
          <SummaryCard
            title="Minhas Pendências"
            value={String(metrics.minhas)}
            tone={quickTab === "minhas" ? "info" : "neutral"}
            icon={User}
            description={
              <span className="text-[11px] leading-tight block">
                Ativas atribuídas a mim
              </span>
            }
          />
        </div>

        <div onClick={() => setQuickTab("setor")} className="cursor-pointer">
          <SummaryCard
            title="Do Meu Setor"
            value={String(metrics.setor)}
            tone={quickTab === "setor" ? "special" : "neutral"}
            icon={Users}
            description={
              <span className="text-[11px] leading-tight block">
                Sem responsável individual ({user?.sector || "Sem Setor"})
              </span>
            }
          />
        </div>

        <div onClick={() => setQuickTab("sem_responsavel")} className="cursor-pointer">
          <SummaryCard
            title="Sem Responsável"
            value={String(metrics.semResponsavel)}
            tone={quickTab === "sem_responsavel" ? "warning" : "neutral"}
            icon={CheckSquare}
            description={
              <span className="text-[11px] leading-tight block">
                Aguardando operador
              </span>
            }
          />
        </div>

        <div onClick={() => setQuickTab("urgentes")} className="cursor-pointer">
          <SummaryCard
            title="Urgentes"
            value={String(metrics.urgentes)}
            tone={quickTab === "urgentes" ? "danger" : "neutral"}
            icon={AlertCircle}
            description={
              <span className="text-[11px] leading-tight block">
                Prioridade Urgente ativas
              </span>
            }
          />
        </div>

        <div onClick={() => setQuickTab("atrasadas")} className="cursor-pointer">
          <SummaryCard
            title="Atrasadas"
            value={String(metrics.atrasadas)}
            tone={quickTab === "atrasadas" ? "danger" : "neutral"}
            icon={AlertTriangle}
            description={
              <span className="text-[11px] leading-tight block text-red-500 dark:text-red-400 font-bold">
                Prazo vencido ativas
              </span>
            }
          />
        </div>

        <div onClick={() => setQuickTab("concluidas_hoje")} className="cursor-pointer">
          <SummaryCard
            title="Concluídas Hoje"
            value={String(metrics.concluidasHoje)}
            tone={quickTab === "concluidas_hoje" ? "success" : "neutral"}
            icon={CheckCircle2}
            description={
              <span className="text-[11px] leading-tight block">
                Finalizadas na data atual
              </span>
            }
          />
        </div>
      </div>

      {/* Filter panel */}
      <div
        className="rounded-2xl p-4 shadow-sm space-y-4"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)"
        }}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          {/* Text Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por título, descrição, cliente ou ID da proposta..."
              className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none transition"
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)"
              }}
            />
          </div>

          {/* Quick Filters Toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition"
              style={{
                background: showAdvancedFilters ? "var(--accent-hover)" : "var(--background)",
                border: "1px solid var(--border)",
                color: "var(--foreground)"
              }}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros Avançados
              <ChevronDown className={`h-3 w-3 transition-transform ${showAdvancedFilters && "rotate-180"}`} />
            </button>

            {quickTab !== "todas" && (
              <button
                type="button"
                onClick={() => setQuickTab("todas")}
                className="rounded-xl px-3 py-2.5 text-xs font-bold text-red-500 hover:text-red-600 transition"
              >
                Limpar Abas
              </button>
            )}
          </div>
        </div>

        {/* Quick Filter Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b pb-2" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setQuickTab("todas")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              quickTab === "todas"
                ? "bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            }`}
          >
            Todas ({rawPendencias.length})
          </button>
          <button
            onClick={() => setQuickTab("minhas")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              quickTab === "minhas"
                ? "bg-[#0b2f4a] text-white"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            }`}
          >
            Minhas ({metrics.minhas})
          </button>
          <button
            onClick={() => setQuickTab("setor")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              quickTab === "setor"
                ? "bg-[#0b2f4a] text-white"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            }`}
          >
            Meu Setor ({metrics.setor})
          </button>
          <button
            onClick={() => setQuickTab("sem_responsavel")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              quickTab === "sem_responsavel"
                ? "bg-[#0b2f4a] text-white"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            }`}
          >
            Sem Responsável ({metrics.semResponsavel})
          </button>
          <button
            onClick={() => setQuickTab("urgentes")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              quickTab === "urgentes"
                ? "bg-red-600 text-white"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            }`}
          >
            Urgentes ({metrics.urgentes})
          </button>
          <button
            onClick={() => setQuickTab("atrasadas")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              quickTab === "atrasadas"
                ? "bg-amber-600 text-white"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            }`}
          >
            Atrasadas ({metrics.atrasadas})
          </button>
          <button
            onClick={() => setQuickTab("concluidas_hoje")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              quickTab === "concluidas_hoje"
                ? "bg-green-600 text-white"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            }`}
          >
            Concluídas Hoje ({metrics.concluidasHoje})
          </button>
        </div>

        {/* Advanced Select Filters */}
        {showAdvancedFilters && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5 pt-2">
            {/* Status Filter */}
            <div>
              <label htmlFor="filter_status" className="block text-xs font-bold mb-1.5 text-slate-500">
                Status
              </label>
              <select
                id="filter_status"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              >
                <option value="TODOS">Todos os Status</option>
                <option value="ABERTA">Aberta</option>
                <option value="EM_ANDAMENTO">Em Resolução</option>
                <option value="CONCLUIDA">Concluída</option>
                <option value="CANCELADA">Cancelada</option>
              </select>
            </div>

            {/* Priority Filter */}
            <div>
              <label htmlFor="filter_prio" className="block text-xs font-bold mb-1.5 text-slate-500">
                Prioridade
              </label>
              <select
                id="filter_prio"
                value={selectedPriority}
                onChange={(e) => setSelectedPriority(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              >
                <option value="TODOS">Todas as Prioridades</option>
                <option value="BAIXA">Baixa</option>
                <option value="MEDIA">Média</option>
                <option value="ALTA">Alta</option>
                <option value="URGENTE">Urgente</option>
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <label htmlFor="filter_cat" className="block text-xs font-bold mb-1.5 text-slate-500">
                Categoria
              </label>
              <select
                id="filter_cat"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              >
                <option value="TODOS">Todas as Categorias</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Sector Filter */}
            <div>
              <label htmlFor="filter_sector" className="block text-xs font-bold mb-1.5 text-slate-500">
                Setor Responsável
              </label>
              <select
                id="filter_sector"
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              >
                <option value="TODOS">Todos os Setores</option>
                {SECTORS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Company Filter (Naturally restricted by RLS on supabase query side) */}
            <div>
              <label htmlFor="filter_company" className="block text-xs font-bold mb-1.5 text-slate-500">
                Empresa
              </label>
              <select
                id="filter_company"
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              >
                <option value="TODAS">Todas as Empresas</option>
                {companiesList.map((comp) => (
                  <option key={comp} value={comp}>
                    {comp}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Main List Layout */}
      <div>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-slate-500" />
            <span className="text-sm font-semibold text-slate-400">Carregando pendências de propostas...</span>
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-6 text-center max-w-xl mx-auto my-10">
            <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Falha ao buscar dados</h3>
            <p className="text-sm text-slate-500 mt-2">{errorMsg}</p>
            <button
              type="button"
              onClick={triggerRefresh}
              className="mt-4 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 px-4 py-2 text-xs font-bold transition"
            >
              Recarregar Página
            </button>
          </div>
        ) : filteredPendencias.length === 0 ? (
          /* Empty State */
          <div
            className="rounded-2xl p-16 text-center shadow-sm max-w-xl mx-auto border"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)"
            }}
          >
            <CheckSquare className="h-12 w-12 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Nenhuma pendência encontrada</h3>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              Não existem registros que coincidam com a busca ou filtros selecionados. Tente ajustar os parâmetros.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchTerm("");
                setSelectedStatus("TODOS");
                setSelectedPriority("TODOS");
                setSelectedCategory("TODOS");
                setSelectedSector("TODOS");
                setSelectedCompany("TODAS");
                setQuickTab("todas");
              }}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border hover:bg-slate-200 px-4 py-2.5 text-xs font-bold transition"
            >
              Resetar Filtros
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Desktop View (Table) */}
            <div
              className="hidden lg:block overflow-x-auto rounded-2xl shadow-sm border"
              style={{
                background: "var(--card)",
                borderColor: "var(--border)"
              }}
            >
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr
                    className="border-b text-xs font-bold uppercase tracking-wider text-slate-500"
                    style={{ borderColor: "var(--border)", background: "var(--background)" }}
                  >
                    <th className="px-6 py-4">Proposta</th>
                    <th className="px-6 py-4">Empresa</th>
                    <th className="px-6 py-4">Cliente</th>
                    <th className="px-6 py-4">Categoria / Causa</th>
                    <th className="px-6 py-4">Título / Problema</th>
                    <th className="px-6 py-4">Prazo Limite</th>
                    <th className="px-6 py-4">Responsável</th>
                    <th className="px-6 py-4">Prioridade</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Ações Rápidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayedPendencias.map((item) => {
                    const isUrgent = item.prioridade === "URGENTE";
                    const isOverdue = item.data_limite && item.data_limite < todayStr && item.status !== "CONCLUIDA" && item.status !== "CANCELADA";

                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-all duration-150 border-l-2",
                          isUrgent ? "border-l-red-500 bg-red-500/5 dark:bg-red-500/5" :
                          isOverdue ? "border-l-amber-500 bg-amber-500/5 dark:bg-amber-500/5" : "border-l-transparent"
                        )}
                        style={{ borderColor: "var(--border)" }}
                      >
                        {/* Proposta ID */}
                        <td className="px-6 py-4 font-semibold text-blue-600 dark:text-blue-400">
                          <Link href={`/orcamentos/${item.id_int}?chat=open`} className="hover:underline">
                            #{item.id_int}
                          </Link>
                        </td>

                        {/* Empresa */}
                        <td className="px-6 py-4 text-xs font-medium text-slate-600 dark:text-slate-400">
                          {item.propostas?.empresa || "—"}
                        </td>

                        {/* Cliente */}
                        <td className="px-6 py-4 font-medium text-slate-700 dark:text-slate-300 max-w-[150px] truncate" title={item.propostas?.cliente || undefined}>
                          {item.propostas?.cliente || "Cliente Avulso"}
                        </td>

                        {/* Categoria */}
                        <td className="px-6 py-4">
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                            {getCategoryLabel(item.categoria)}
                          </span>
                        </td>

                        {/* Título & Descrição resumida */}
                        <td className="px-6 py-4 max-w-[280px]">
                          <p className="font-bold text-slate-900 dark:text-slate-100 break-words">{item.titulo}</p>
                          <p className="text-xs text-slate-500 truncate mt-0.5" title={item.descricao}>
                            {item.descricao}
                          </p>
                        </td>

                        {/* Prazo Limite */}
                        <td className="px-6 py-4">
                          {item.data_limite ? (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-bold ${
                                isOverdue ? "text-red-500" : "text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <Calendar className="h-3.5 w-3.5" />
                              {new Date(item.data_limite + "T12:00:00").toLocaleDateString()}
                              {isOverdue && (
                                <span className="text-[9px] uppercase bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 px-1.5 py-0.5 rounded font-bold animate-pulse">
                                  Atrasado
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">Sem prazo</span>
                          )}
                        </td>

                        {/* Responsável / Setor */}
                        <td className="px-6 py-4">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            {getUsernameFromId(item.responsavel_user_id)}
                          </p>
                          <span className="text-[10px] uppercase font-semibold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                            {item.responsavel_setor}
                          </span>
                        </td>

                        {/* Prioridade */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={item.prioridade} tone={getPriorityTone(item.prioridade)} />
                            {isUrgent && (
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-6 py-4">
                          <StatusBadge status={item.status} />
                        </td>

                        {/* Ações */}
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Assumir */}
                            {item.status === "ABERTA" && (
                              <button
                                type="button"
                                disabled={actionLoadingId !== null}
                                onClick={() => handleUpdateStatus(item.id, item.id_int, item.id_cliente, "EM_ANDAMENTO", item.titulo)}
                                className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-900 dark:text-indigo-400 px-2 py-1.5 text-xs font-bold hover:bg-indigo-100 transition"
                                title="Assumir Pendência"
                              >
                                <Play className="h-3 w-3" />
                                Assumir
                              </button>
                            )}

                            {/* Concluir */}
                            {(item.status === "ABERTA" || item.status === "EM_ANDAMENTO") && (
                              <button
                                type="button"
                                disabled={actionLoadingId !== null}
                                onClick={() => handleUpdateStatus(item.id, item.id_int, item.id_cliente, "CONCLUIDA", item.titulo)}
                                className="inline-flex items-center gap-1 rounded-lg bg-green-50 border border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-900 dark:text-green-400 px-2 py-1.5 text-xs font-bold hover:bg-green-100 transition"
                                title="Marcar como Concluída"
                              >
                                <Check className="h-3.5 w-3.5" />
                                Concluir
                              </button>
                            )}

                            {/* Cancelar */}
                            {(item.status === "ABERTA" || item.status === "EM_ANDAMENTO") && (
                              <button
                                type="button"
                                disabled={actionLoadingId !== null}
                                onClick={() => handleUpdateStatus(item.id, item.id_int, item.id_cliente, "CANCELADA", item.titulo)}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 px-2 py-1.5 text-xs font-bold hover:bg-slate-200 transition"
                                title="Cancelar Pendência"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}

                            {/* Abrir Chat */}
                            <button
                              type="button"
                              onClick={() => openChat(item.id_int, { clienteNome: item.propostas?.cliente || null, idCliente: item.id_cliente })}
                              className="rounded-lg bg-slate-100 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 p-1.5 hover:bg-slate-200 transition"
                              title="Abrir Chat da Proposta"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </button>

                            {/* Ver Proposta */}
                            <Link
                              href={`/orcamentos/${item.id_int}?chat=open`}
                              className="rounded-lg bg-slate-100 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 p-1.5 hover:bg-slate-200 transition"
                              title="Ir para Orçamento"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile View (Cards) */}
            <div className="lg:hidden space-y-3">
              {displayedPendencias.map((item) => {
                const isUrgent = item.prioridade === "URGENTE";
                const isOverdue = item.data_limite && item.data_limite < todayStr && item.status !== "CONCLUIDA" && item.status !== "CANCELADA";

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-2xl p-4 space-y-3 border flex flex-col transition border-l-4",
                      isUrgent ? "border-l-red-500 bg-red-500/5 dark:bg-red-500/5" :
                      isOverdue ? "border-l-amber-500 bg-amber-500/5 dark:bg-amber-500/5" : "border-l-transparent"
                    )}
                    style={{
                      background: "var(--card)",
                      borderColor: "var(--border)"
                    }}
                  >
                    {/* Top Row: Proposal & Company */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-blue-600 dark:text-blue-400">
                        Proposta #{item.id_int}
                      </span>
                      <span className="text-slate-500 font-medium truncate max-w-[150px]">
                        {item.propostas?.empresa || "Empresa avulsa"}
                      </span>
                    </div>

                    {/* Middle Row: Title & Details */}
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">
                        {item.titulo}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed bg-slate-50 dark:bg-slate-950/20 p-2 rounded border border-slate-100 dark:border-slate-900">
                        {item.descricao}
                      </p>
                    </div>

                    {/* Badges Column */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                        Setor: {item.responsavel_setor}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-400">
                        {getCategoryLabel(item.categoria)}
                      </span>
                    </div>

                    {/* Meta info: Due date, Assignee, Badges */}
                    <div className="flex flex-col gap-1.5 border-t pt-2 text-xs" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Responsável:</span>
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          {getUsernameFromId(item.responsavel_user_id)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Prazo:</span>
                        {item.data_limite ? (
                          <span className={`font-bold inline-flex items-center gap-1 ${isOverdue ? "text-red-500" : "text-slate-700 dark:text-slate-300"}`}>
                            {new Date(item.data_limite + "T12:00:00").toLocaleDateString()}
                            {isOverdue && (
                              <span className="text-[9px] uppercase bg-red-55 dark:bg-red-950/40 text-red-600 dark:text-red-400 px-1 py-0.5 rounded font-bold animate-pulse">
                                Atrasado
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">Não definido</span>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={item.prioridade} tone={getPriorityTone(item.prioridade)} />
                          {isUrgent && (
                            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
                          )}
                        </div>
                        <StatusBadge status={item.status} />
                      </div>
                    </div>

                    {/* Bottom Action buttons */}
                    <div className="flex items-center justify-end gap-2 border-t pt-3 mt-1" style={{ borderColor: "var(--border)" }}>
                      {/* Mobile Buttons */}
                      <button
                        type="button"
                        onClick={() => openChat(item.id_int, { clienteNome: item.propostas?.cliente || null, idCliente: item.id_cliente })}
                        className="rounded-xl bg-slate-100 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 px-3 py-2 text-xs font-bold transition flex-1 flex items-center justify-center gap-1"
                      >
                        <MessageSquare className="h-4 w-4" />
                        Chat
                      </button>

                      <Link
                        href={`/orcamentos/${item.id_int}?chat=open`}
                        className="rounded-xl bg-slate-100 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 px-3 py-2 text-xs font-bold transition flex-1 text-center"
                      >
                        Ver Proposta
                      </Link>

                      {(item.status === "ABERTA" || item.status === "EM_ANDAMENTO") && (
                        <div className="flex gap-1 shrink-0">
                          {item.status === "ABERTA" && (
                            <button
                              type="button"
                              onClick={() => handleUpdateStatus(item.id, item.id_int, item.id_cliente, "EM_ANDAMENTO", item.titulo)}
                              className="rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-900 dark:text-indigo-400 px-3 py-2 text-xs font-bold transition"
                            >
                              Assumir
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(item.id, item.id_int, item.id_cliente, "CONCLUIDA", item.titulo)}
                            className="rounded-xl bg-green-50 border border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-900 dark:text-green-400 px-3 py-2 text-xs font-bold transition"
                          >
                            Concluir
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination / Limit control */}
            {filteredPendencias.length > limit && (
              <div className="flex items-center justify-between border-t pt-4 text-sm text-slate-500" style={{ borderColor: "var(--border)" }}>
                <span>
                  Exibindo {limit} de {filteredPendencias.length} pendências correspondentes
                </span>
                <button
                  type="button"
                  onClick={() => setLimit((prev) => prev + 25)}
                  className="rounded-xl bg-[#0b2f4a] hover:bg-[#163f5c] text-white px-4 py-2.5 text-xs font-bold transition shadow-sm"
                >
                  Carregar Mais (+25)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
