"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Search } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { CobrancaActionsMenu } from "@/features/cobrancas/CobrancaActionsMenu";
import { CobrancaStatusBadge } from "@/features/cobrancas/CobrancaStatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import {
  EMPRESAS_RECEBEDORAS_FIXAS,
  cobrancaMatchesSearch,
  getDataReferenciaCobranca,
  getDataHoraListaCobranca,
  getEmpresaExibicao,
  getEmpresaGrupoKey,
  getEmpresaRecebedoraFixaById,
  getLocalDateKey,
  getLocalMonthKey,
  getNumeroCobranca,
  getLiberacaoPedidoLabel,
  getLiberacaoPedidoStatus,
  getTipoCobrancaLabel,
  isPendenteAprovacao
} from "@/features/cobrancas/cobrancas-utils";
import type { Cobranca } from "@/features/cobrancas/types";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import { useDashboardFinanceiroSnapshot } from "@/features/cobrancas/hooks/useDashboardFinanceiroSnapshot";
import { updatePagamentoV2Empresa } from "@/features/cobrancas/services/pagamentos-v2.service";

type TipoFiltro = "PENDENTES_APROVACAO" | "CONFIRMADOS_DIA" | "EMITIR_BOLETOS" | "TODOS" | "PIX" | "BOLETO" | "FATURADO" | "CARTAO" | "CANCELADO";

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";
const tipoFiltroOptions: Array<{ value: TipoFiltro; label: string }> = [
  { value: "PENDENTES_APROVACAO", label: "Pendentes aprovação" },
  { value: "CONFIRMADOS_DIA", label: "Confirmados do dia" },
  { value: "EMITIR_BOLETOS", label: "Emitir Boletos" },
  { value: "PIX", label: "PIX" },
  { value: "BOLETO", label: "Boleto" },
  { value: "FATURADO", label: "Faturado" },
  { value: "CARTAO", label: "Cartão" },
  { value: "CANCELADO", label: "Cancelados" },
  { value: "TODOS", label: "Todos os tipos" }
];



function isEmpresaValida(cobranca: Pick<Cobranca, "id_empresa">) {
  const idEmpresa = Number(cobranca.id_empresa);
  return Number.isFinite(idEmpresa) && idEmpresa !== 0;
}

// Regra definitiva: status PAID/A_VENCER indica condição financeira. confirmado=false indica aguardando conferência humana. confirmado=true indica liberado para produção.
function isFilaPadrao(cobranca: Cobranca) {
  const status = (cobranca.status || "").trim().toUpperCase();

  if (status === "CANCELADO") return false;

  if (status === "PAID" && cobranca.confirmado === false) {
    return true;
  }

  if (status === "A_VENCER" && cobranca.confirmado === false) {
    return !isPendenteAprovacao(cobranca);
  }

  return false;
}

// confirmado=true em pagamentos_v2 representa liberação operacional da cobrança para os próximos fluxos. Não significa criação de pedido de produção nem geração de OS física.
function isBaseConfirmada(cobranca: Cobranca) {
  const status = (cobranca.status || "").trim().toUpperCase();

  if (status === "CANCELADO") return false;

  return (
    (status === "PAID" || status === "A_VENCER") &&
    cobranca.confirmado === true
  );
}

function isConfirmadoDia(cobranca: Cobranca) {
  if (!isBaseConfirmada(cobranca)) {
    return false;
  }
  const dateVal = cobranca.paid_at || cobranca.data_confirmacao;
  if (!dateVal) {
    return false;
  }
  const todayKey = getLocalDateKey(new Date());
  return getLocalDateKey(dateVal) === todayKey;
}

function getEmpresaLabelVisual(nome: string) {
  const upper = nome.toUpperCase();
  if (upper.includes("GRÁFICA") || upper.includes("GRAFICA EXPRESSA") || upper.includes("EIRELI")) {
    return "Ideal Gráfica";
  }
  if (upper.includes("BIRÔ") || upper.includes("BIRO")) {
    return "Ideal Birô";
  }
  if (upper.includes("E3") || upper.includes("BRINDES")) {
    return "E3 Brindes";
  }
  return nome;
}

function isEmitirBoletos(cobranca: Cobranca, existingBoletoIdInts?: Set<number>) {
  const tipo = (cobranca.tipo_cobranca || "").toUpperCase();
  const status = (cobranca.status || "").toUpperCase();
  
  const isEFaturado = tipo === "E-FATURADO";
  const isCorrectStatus = status === "A_RECEBER" || status === "A_VENCER";
  const isConfirmedIfAvencer = status !== "A_VENCER" || cobranca.confirmado === true;
  const isBoletoEnviadooFalse = cobranca.boleto_enviadoo === false;
  
  const hasNoMatchingBoleto = !existingBoletoIdInts || !cobranca.id_int || !existingBoletoIdInts.has(Number(cobranca.id_int));
  
  return (
    isEFaturado &&
    isCorrectStatus &&
    isConfirmedIfAvencer &&
    isBoletoEnviadooFalse &&
    hasNoMatchingBoleto &&
    isEmpresaValida(cobranca)
  );
}

function matchesTipoFiltro(cobranca: Cobranca, tipo: TipoFiltro, existingBoletoIdInts?: Set<number>) {
  if (tipo === "PENDENTES_APROVACAO") {
    return isPendenteAprovacao(cobranca);
  }

  if (tipo === "EMITIR_BOLETOS") {
    return isEmitirBoletos(cobranca, existingBoletoIdInts);
  }

  if (tipo === "TODOS") {
    return true;
  }

  if (tipo === "PIX") {
    return cobranca.tipo_cobranca === "PIX";
  }

  if (tipo === "BOLETO") {
    return cobranca.tipo_cobranca === "BOLETO";
  }

  if (tipo === "FATURADO") {
    const tipoNormalizado = String(cobranca.tipo_cobranca).trim().toUpperCase().replace(/_/g, "-");
    return tipoNormalizado === "E-FATURADO" || tipoNormalizado === "EFATURADO" || tipoNormalizado === "FATURADO";
  }

  if (tipo === "CANCELADO") {
    return cobranca.status === "CANCELADO";
  }

  return cobranca.tipo_cobranca === "CREDIT_CARD" || cobranca.tipo_cobranca === "CARD_PARCELADO";
}

function getInitialDates() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const format = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  return {
    start: format(firstDay),
    end: format(lastDay)
  };
}

export function CobrancasList() {
  const router = useRouter();
  const { cobrancasStats, source, refreshCobrancas, existingBoletoIdInts } = useCobrancas();
  const { showToast } = useAppToast();
  const [search, setSearch] = useState("");
  const [tipo, setTipo] = useState<TipoFiltro>("TODOS");
  const [empresa, setEmpresa] = useState("TODAS");
  const [statusFilter, setStatusFilter] = useState<"FILA" | "CONFIRMADOS">("FILA");
  
  const initialDates = useMemo(() => getInitialDates(), []);
  const [dataInicial, setDataInicial] = useState(initialDates.start);
  const [dataFinal, setDataFinal] = useState(initialDates.end);
  const [mesSelecionado, setMesSelecionado] = useState(getLocalMonthKey(new Date()));
  const [empresaEmEdicao, setEmpresaEmEdicao] = useState<Cobranca | null>(null);
  const [empresaDestinoId, setEmpresaDestinoId] = useState<number | null>(null);
  const [isSavingEmpresa, setIsSavingEmpresa] = useState(false);
  const dashboardFinanceiro = useDashboardFinanceiroSnapshot({
    cobrancasStats,
    mesSelecionado
  });

  const tipoOptions = useMemo(() => tipoFiltroOptions, []);

  const empresaOptions = useMemo(() => {
    const entries = new Map<string, string>();

    cobrancasStats.filter(isEmpresaValida).forEach((cobranca) => {
      const value = getEmpresaGrupoKey(cobranca);
      if (!value || entries.has(value)) {
        return;
      }

      entries.set(value, getEmpresaExibicao(cobranca));
    });

    return Array.from(entries.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
      .map(([value, label]) => ({ value, label }));
  }, [cobrancasStats]);



  const faturamentoPeriodoPorEmpresa = useMemo(() => {
    const groups = new Map<number, { id_empresa: number; empresa: string; total: number }>();
    
    // Initialize the three fixed companies
    groups.set(1, { id_empresa: 1, empresa: "IDEAL GRÁFICA EXPRESSA EIRELI", total: 0 });
    groups.set(2, { id_empresa: 2, empresa: "IDEAL BIRÔ SERV. GRAFICOS", total: 0 });
    groups.set(3, { id_empresa: 3, empresa: "E3 BRINDES LTDA", total: 0 });

    cobrancasStats.forEach((c) => {
      // Excluir: A_RECEBER, CANCELADO, confirmado = false
      if (c.status === "A_RECEBER" || c.status === "CANCELADO" || !c.confirmado) {
        return;
      }

      // Considerar apenas status in ('PAID', 'A_VENCER')
      if (c.status !== "PAID" && c.status !== "A_VENCER") {
        return;
      }

      // Preferência de data: paid_at ?? data_confirmacao ?? created_at
      const dateVal = c.paid_at || c.data_confirmacao || c.created_at;
      if (!dateVal) {
        return;
      }

      const faturamentoLocalDateKey = getLocalDateKey(dateVal);
      if (faturamentoLocalDateKey < dataInicial || faturamentoLocalDateKey > dataFinal) {
        return;
      }

      let idEmpresa = Number(c.id_empresa);
      let empresaNome = c.empresa?.trim() || "";

      // Agrupar por empresa: usar id_empresa como fonte principal; se vazia/1/Definir empresa, mapear por id_empresa
      if (!idEmpresa || idEmpresa <= 0) {
        const lowerName = empresaNome.toLowerCase();
        if (lowerName.includes("eireli") || lowerName.includes("grafica expressa") || lowerName.includes("grafica")) {
          idEmpresa = 1;
        } else if (lowerName.includes("biro")) {
          idEmpresa = 2;
        } else if (lowerName.includes("e3") || lowerName.includes("brindes")) {
          idEmpresa = 3;
        } else {
          idEmpresa = 1;
        }
      }

      // Padronizar por id_empresa
      if (idEmpresa === 1) empresaNome = "IDEAL GRÁFICA EXPRESSA EIRELI";
      else if (idEmpresa === 2) empresaNome = "IDEAL BIRÔ SERV. GRAFICOS";
      else if (idEmpresa === 3) empresaNome = "E3 BRINDES LTDA";
      else empresaNome = `Empresa ${idEmpresa}`;

      const valorValido = c.valor ?? 0;

      const current = groups.get(idEmpresa);
      if (current) {
        current.total += valorValido;
      } else {
        groups.set(idEmpresa, {
          id_empresa: idEmpresa,
          empresa: empresaNome,
          total: valorValido
        });
      }
    });

    return Array.from(groups.values()).sort((a, b) => a.id_empresa - b.id_empresa);
  }, [cobrancasStats, dataInicial, dataFinal]);

  const faturamentoPeriodoTotal = useMemo(() => {
    return faturamentoPeriodoPorEmpresa.reduce((sum, item) => sum + item.total, 0);
  }, [faturamentoPeriodoPorEmpresa]);

  const visibleCobrancas = useMemo(() => {
    const base =
      tipo === "PENDENTES_APROVACAO"
        ? cobrancasStats.filter((c) => isPendenteAprovacao(c))
        : tipo === "CONFIRMADOS_DIA"
          ? cobrancasStats.filter(isConfirmadoDia)
          : tipo === "EMITIR_BOLETOS"
            ? cobrancasStats.filter((c) => isEmitirBoletos(c, existingBoletoIdInts))
            : tipo === "CANCELADO"
              ? cobrancasStats.filter((c) => c.status === "CANCELADO")
              : statusFilter === "CONFIRMADOS"
                ? cobrancasStats.filter(isBaseConfirmada)
                : tipo === "TODOS"
                  ? cobrancasStats.filter(isFilaPadrao)
                  : cobrancasStats.filter(isBaseConfirmada);

    return base
      .filter((cobranca) => {
        const matchesSearch = cobrancaMatchesSearch(cobranca, search);
        const matchesTipo =
          tipo === "TODOS" || tipo === "PENDENTES_APROVACAO" || tipo === "CONFIRMADOS_DIA" || tipo === "EMITIR_BOLETOS" || tipo === "CANCELADO"
            ? true
            : matchesTipoFiltro(cobranca, tipo, existingBoletoIdInts);
        const matchesEmpresa = empresa === "TODAS" || getEmpresaGrupoKey(cobranca) === empresa;

        return matchesSearch && matchesTipo && matchesEmpresa;
      })
      .slice(0, 500);
  }, [cobrancasStats, empresa, search, tipo, statusFilter, existingBoletoIdInts]);

  const empresaDestinoSelecionada = empresaDestinoId ? getEmpresaRecebedoraFixaById(empresaDestinoId) ?? null : null;

  function abrirEdicaoEmpresa(cobranca: Cobranca) {
    if (source !== "supabase" || !isPendenteAprovacao(cobranca)) {
      return;
    }

    setEmpresaEmEdicao(cobranca);
    setEmpresaDestinoId(cobranca.id_empresa > 0 ? cobranca.id_empresa : null);
  }

  function fecharEdicaoEmpresa() {
    if (isSavingEmpresa) {
      return;
    }

    setEmpresaEmEdicao(null);
    setEmpresaDestinoId(null);
  }

  async function confirmarEdicaoEmpresa() {
    if (!empresaEmEdicao || !empresaDestinoSelecionada || source !== "supabase") {
      return;
    }

    setIsSavingEmpresa(true);

    try {
      const result = await updatePagamentoV2Empresa(empresaEmEdicao.id, {
        id_empresa: empresaDestinoSelecionada.id,
        empresa: empresaDestinoSelecionada.nome
      });

      if (!result.success) {
        throw new Error(result.errorMessage || "Nao foi possivel atualizar a empresa.");
      }

      const refreshed = await refreshCobrancas();
      if (refreshed.source !== "supabase") {
        throw new Error("A empresa foi salva, mas a tela nao conseguiu recarregar os dados reais.");
      }

      showToast({ type: "success", title: "Empresa atualizada com sucesso." });
      fecharEdicaoEmpresa();
    } catch (error) {
      showToast({
        type: "error",
        title: error instanceof Error ? error.message : "Nao foi possivel atualizar a empresa."
      });
    } finally {
      setIsSavingEmpresa(false);
    }
  }

  function renderEmpresaEditavel(cobranca: Cobranca) {
    const label = getEmpresaExibicao(cobranca);
    const editavel = source === "supabase" && isPendenteAprovacao(cobranca);

    if (!editavel) {
      return <span className="font-medium text-slate-900">{label}</span>;
    }

    return (
      <button
        type="button"
        onClick={() => abrirEdicaoEmpresa(cobranca)}
        className="text-left font-semibold text-[#0b2f4a] underline decoration-dotted underline-offset-4 transition hover:text-[#123f61]"
      >
        {label}
      </button>
    );
  }

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }

    const totalReais = cobrancasStats.length;

    console.info("[ConferenciaPagamentos][Cards]", {
      source,
      totalReais,
      sourceFinanceiro: dashboardFinanceiro.source,
      pendentesResumo: dashboardFinanceiro.pendentesResumo,
      confirmadosDiaResumo: dashboardFinanceiro.confirmadosDiaResumo,
      faturamentoDiaResumoTotal: dashboardFinanceiro.faturamentoDiaResumoTotal,
      faturamentoMesPeriodo: dashboardFinanceiro.faturamentoMesPeriodo,
      totalDiaPorEmpresa: Object.fromEntries(
        dashboardFinanceiro.faturamentoDiaPorEmpresa.map((item) => [item.id_empresa, item.total])
      ),
      totalMesSelecionado: dashboardFinanceiro.faturamentoMesResumo.total,
      mesSelecionado
    });
  }, [
    cobrancasStats.length,
    dashboardFinanceiro.confirmadosDiaResumo,
    dashboardFinanceiro.faturamentoDiaPorEmpresa,
    dashboardFinanceiro.faturamentoDiaResumoTotal,
    dashboardFinanceiro.faturamentoMesResumo.total,
    dashboardFinanceiro.pendentesResumo,
    dashboardFinanceiro.source,
    dashboardFinanceiro.faturamentoMesPeriodo,
    mesSelecionado,
    source
  ]);

  return (
    <div data-cobrancas-source={source} className="space-y-6">
      <PageHeader
        title="Conferência de pagamentos"
        subtitle="Fila de conferência, aprovação e acompanhamento das cobranças geradas no ERP."
        context="Financeiro / Conferência de pagamentos"
        action={(
          <button
            type="button"
            onClick={() => router.push("/orcamentos")}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            Abrir propostas
          </button>
        )}
      />

      <section className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <ConferenceStatCard
          title="Pendentes de aprovação"
          count={dashboardFinanceiro.pendentesResumo.count}
          total={dashboardFinanceiro.pendentesResumo.total}
          helper="E-Faturado aguardando validação financeira."
          tone="warning"
          isActive={tipo === "PENDENTES_APROVACAO"}
          onClick={() => {
            setTipo("PENDENTES_APROVACAO");
            setStatusFilter("FILA");
          }}
        />

        <ConferenceStatCard
          title="Confirmados do dia"
          count={dashboardFinanceiro.confirmadosDiaResumo.count}
          total={dashboardFinanceiro.confirmadosDiaResumo.total}
          helper="Baseado na data atual em America/Sao_Paulo."
          tone="success"
          isActive={tipo === "CONFIRMADOS_DIA"}
          onClick={() => {
            setTipo("CONFIRMADOS_DIA");
            setStatusFilter("CONFIRMADOS");
          }}
        />

        <section className="rounded-2xl border border-slate-200/60 p-4 shadow-sm bg-white flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {dashboardFinanceiro.source === "rpc" ? "Faturamento do período" : "Faturamento do dia"}
              </p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{formatCurrency(dashboardFinanceiro.faturamentoDiaResumoTotal)}</p>
            </div>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 select-none">
              {dashboardFinanceiro.source === "rpc" ? "Período" : "Hoje"}
            </span>
          </div>

          <div className="mt-2.5 space-y-1">
            {dashboardFinanceiro.faturamentoDiaPorEmpresa.map((item) => {
              return (
                <div key={item.id_empresa} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/50 px-3 py-1">
                  <p className="truncate text-[11px] font-semibold text-slate-700">{getEmpresaLabelVisual(item.empresa)}</p>
                  <p className="shrink-0 text-[11px] font-semibold text-slate-900">{formatCurrency(item.total)}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/60 p-4 shadow-sm bg-white flex flex-col justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Faturamento por Período</p>
              <p className="text-base font-bold text-slate-900">{formatCurrency(faturamentoPeriodoTotal)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dataInicial}
                onChange={(e) => setDataInicial(e.target.value)}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-1.5 py-1 text-[10px] text-slate-700 outline-none w-full"
              />
              <span className="text-[10px] text-slate-400">a</span>
              <input
                type="date"
                value={dataFinal}
                onChange={(e) => setDataFinal(e.target.value)}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-1.5 py-1 text-[10px] text-slate-700 outline-none w-full"
              />
            </div>
          </div>

          <div className="mt-2.5 space-y-1">
            {faturamentoPeriodoPorEmpresa.map((item) => {
              return (
                <div key={item.id_empresa} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/50 px-3 py-1">
                  <p className="truncate text-[11px] font-semibold text-slate-700">{getEmpresaLabelVisual(item.empresa)}</p>
                  <p className="shrink-0 text-[11px] font-semibold text-slate-900">{formatCurrency(item.total)}</p>
                </div>
              );
            })}
          </div>
        </section>
      </section>

      {dashboardFinanceiro.source === "fallback" ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Fonte financeira temporariamente em fallback</p>
          <p className="mt-1">
            A RPC `get_dashboard_financeiro` ainda nao respondeu no ambiente. A tela esta usando o
            calculo temporario em `pagamentos_v2` ate a funcao centralizada ficar disponivel.
          </p>
        </section>
      ) : null}

      <div className="flex gap-2 border-b border-slate-200 pb-1">
        <button
          type="button"
          onClick={() => {
            setStatusFilter("FILA");
            setTipo("TODOS");
          }}
          className={[
            "rounded-t-2xl px-5 py-2 text-sm font-semibold transition-all",
            statusFilter === "FILA"
              ? "border-b-2 border-[#0b2f4a] text-[#0b2f4a]"
              : "text-slate-500 hover:text-slate-800"
          ].join(" ")}
        >
          Fila de Conferência
        </button>
        <button
          type="button"
          onClick={() => {
            setStatusFilter("CONFIRMADOS");
            setTipo("TODOS");
          }}
          className={[
            "rounded-t-2xl px-5 py-2 text-sm font-semibold transition-all",
            statusFilter === "CONFIRMADOS"
              ? "border-b-2 border-[#0b2f4a] text-[#0b2f4a]"
              : "text-slate-500 hover:text-slate-800"
          ].join(" ")}
        >
          Cobranças Confirmadas
        </button>
      </div>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_220px_180px_180px_180px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por número, cliente, documento ou empresa"
            />
          </label>

          <select
            value={tipo}
            onChange={(event) => {
              const val = event.target.value as TipoFiltro;
              setTipo(val);
              if (val === "PENDENTES_APROVACAO" || val === "EMITIR_BOLETOS") {
                setStatusFilter("FILA");
              } else if (val !== "TODOS") {
                setStatusFilter("CONFIRMADOS");
              }
            }}
            className={filterClass}
          >
            {tipoOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select value={empresa} onChange={(event) => setEmpresa(event.target.value)} className={filterClass}>
            <option value="TODAS">Todas empresas</option>
            {empresaOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setTipo("TODOS");
              setEmpresa("TODAS");
              setStatusFilter("FILA");
              setMesSelecionado(getLocalMonthKey(new Date()));
              setDataInicial(initialDates.start);
              setDataFinal(initialDates.end);
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <ResponsiveList<Cobranca>
        items={visibleCobrancas}
        getKey={(cobranca) => cobranca.id}
        emptyTitle="Nenhuma cobrança encontrada"
        emptyDescription="Nenhum resultado com os filtros atuais. Ajuste a fila, os filtros ou a busca."
        columns={[
          {
            header: "N°",
            cell: (cobranca) => (
              <div>
                <p className="font-semibold text-slate-950">{getNumeroCobranca(cobranca)}</p>
                <p className="text-xs text-slate-500">OS {cobranca.os_ideal || "—"}</p>
              </div>
            )
          },
          {
            header: "Cliente",
            cell: (cobranca) => (
              <div>
                <p className="font-medium text-slate-900">{cobranca.cliente}</p>
                <p className="text-xs text-slate-500">{cobranca.documento}</p>
              </div>
            )
          },
          {
            header: "Status",
            cell: (cobranca) => <CobrancaStatusBadge cobranca={cobranca} />,
            align: "center"
          },
          { header: "Empresa", cell: (cobranca) => renderEmpresaEditavel(cobranca) },
          { header: "Valor", cell: (cobranca) => formatCurrency(cobranca.valor), align: "right" },
          { header: "Tipo", cell: (cobranca) => getTipoCobrancaLabel(cobranca.tipo_cobranca) },
          {
            header: statusFilter === "CONFIRMADOS" ? "Confirmação" : "Data/Hora",
            cell: (cobranca) => {
              if (statusFilter === "CONFIRMADOS") {
                const dateVal = cobranca.data_confirmacao;
                const operador = cobranca.confirmado_por || "";
                return (
                  <div>
                    <p className="font-semibold text-slate-950">{dateVal ? formatDateTime(dateVal) : "—"}</p>
                    {operador && <p className="text-xs text-slate-500">{operador}</p>}
                  </div>
                );
              }
              const reference = getDataHoraListaCobranca(cobranca) || cobranca.created_at;
              return <span>{formatDateTime(reference)}</span>;
            }
          },
          { header: "Ações", cell: (cobranca) => <CobrancaActionsMenu cobranca={cobranca} />, align: "right" }
        ]}
        renderCard={(cobranca) => (
          <article key={cobranca.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{getNumeroCobranca(cobranca)}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{cobranca.cliente}</h3>
                <p className="mt-1 text-sm text-slate-500">{cobranca.documento}</p>
              </div>
              <CobrancaStatusBadge cobranca={cobranca} />
            </div>

            <div className="mt-4 grid gap-2 text-sm text-slate-600">
              <p>Empresa: {renderEmpresaEditavel(cobranca)}</p>
              <p>Valor: <strong className="text-slate-900">{formatCurrency(cobranca.valor)}</strong></p>
              <p>Tipo: {getTipoCobrancaLabel(cobranca.tipo_cobranca)}</p>
              {statusFilter === "CONFIRMADOS" ? (
                <>
                  <p>Confirmação: <strong className="text-slate-900">{cobranca.data_confirmacao ? formatDateTime(cobranca.data_confirmacao) : "—"}</strong></p>
                  {cobranca.confirmado_por && <p>Confirmado por: <strong className="text-slate-900">{cobranca.confirmado_por}</strong></p>}
                </>
              ) : (
                <p>Data/Hora: {formatDateTime(getDataReferenciaCobranca(cobranca) || cobranca.created_at)}</p>
              )}
              <p>OS: {cobranca.os_ideal || "—"}</p>
              <p>Liberação: <strong className="text-slate-900">{getLiberacaoPedidoLabel(getLiberacaoPedidoStatus(cobrancasStats.filter((item) => item.id_int === cobranca.id_int)))}</strong></p>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => router.push(`/cobrancas/${cobranca.id}`)}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white"
              >
                Ver cobrança
              </button>
              <CobrancaActionsMenu cobranca={cobranca} label="Mais" />
            </div>
          </article>
        )}
      />

      {empresaEmEdicao ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Atualizar empresa</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Escolha a empresa da cobrança {getNumeroCobranca(empresaEmEdicao)}</h2>
            <p className="mt-2 text-sm text-slate-600">
              Empresa atual: <span className="font-semibold text-slate-900">{getEmpresaExibicao(empresaEmEdicao)}</span>
            </p>

            <div className="mt-4 grid gap-3">
              {EMPRESAS_RECEBEDORAS_FIXAS.map((empresaOption) => {
                const selected = empresaDestinoSelecionada?.id === empresaOption.id;
                return (
                  <button
                    key={empresaOption.id}
                    type="button"
                    onClick={() => setEmpresaDestinoId(empresaOption.id)}
                    className={[
                      "rounded-2xl border px-4 py-3 text-left transition",
                      selected ? "border-[#0b2f4a] bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"
                    ].join(" ")}
                  >
                    <p className="text-sm font-semibold text-slate-900">{empresaOption.nome}</p>
                    <p className="text-xs text-slate-500">{empresaOption.labelCurta}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Confirmação</p>
              <p className="mt-1">
                {empresaDestinoSelecionada
                  ? `Salvar empresa como ${empresaDestinoSelecionada.nome} nesta cobrança pendente?`
                  : "Selecione uma empresa para liberar o botão de salvar."}
              </p>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={fecharEdicaoEmpresa}
                disabled={isSavingEmpresa}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarEdicaoEmpresa()}
                disabled={!empresaDestinoSelecionada || isSavingEmpresa}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingEmpresa ? "Salvando..." : "Salvar empresa"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
        <div className="flex items-start gap-3">
          <CalendarDays className="mt-0.5 h-4 w-4 text-[#0f9f9a]" />
          <p>
            Esta tela usa leitura read-only quando o Supabase responde e mantém fallback mockado quando a fonte real falha. As ações continuam simuladas nesta fase.
          </p>
        </div>
      </section>
    </div>
  );
}

function ConferenceStatCard({
  title,
  count,
  total,
  helper,
  tone,
  isActive,
  onClick
}: {
  title: string;
  count: number;
  total: number;
  helper: string;
  tone: "success" | "warning";
  isActive?: boolean;
  onClick?: () => void;
}) {
  const baseClass = onClick ? "cursor-pointer hover:shadow-sm transition-all duration-200" : "";
  
  let stateClass = "";
  if (isActive) {
    stateClass = tone === "success"
      ? "border-teal-500 bg-teal-50/30 ring-1 ring-teal-500/20 text-slate-900"
      : "border-orange-500 bg-orange-50/30 ring-1 ring-orange-500/20 text-slate-900";
  } else {
    stateClass = "border-slate-200/80 bg-white text-slate-900 hover:bg-slate-50/50 hover:border-slate-300";
  }

  return (
    <section
      onClick={onClick}
      className={`rounded-2xl border p-4 shadow-sm ${baseClass} ${stateClass}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
        {tone === "success" ? (
          <span className="h-2 w-2 rounded-full bg-teal-500" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-orange-500" />
        )}
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <p className="text-2xl font-bold tracking-tight text-slate-900">{count}</p>
        <p className="text-sm font-semibold text-slate-700">{formatCurrency(total)}</p>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-slate-500 truncate" title={helper}>{helper}</p>
    </section>
  );
}
