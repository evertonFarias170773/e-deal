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

type TipoFiltro = "PENDENTES_APROVACAO" | "EMITIR_BOLETOS" | "TODOS" | "PIX" | "BOLETO" | "FATURADO" | "CARTAO";

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";
const monthsShort = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const tipoFiltroOptions: Array<{ value: TipoFiltro; label: string }> = [
  { value: "PENDENTES_APROVACAO", label: "Pendentes aprovação" },
  { value: "EMITIR_BOLETOS", label: "Emitir Boletos" },
  { value: "PIX", label: "PIX" },
  { value: "BOLETO", label: "Boleto" },
  { value: "FATURADO", label: "Faturado" },
  { value: "CARTAO", label: "Cartão" },
  { value: "TODOS", label: "Todos os tipos" }
];

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const monthIndex = Number(month) - 1;
  return `${monthsShort[monthIndex] ?? "Mês"}/${year.slice(-2)}`;
}

function getFaturamentoReferenceKey(cobranca: Cobranca) {
  const ref = cobranca.paid_at || cobranca.data_confirmacao || "";

  if (!ref) {
    return null;
  }

  return {
    dateKey: getLocalDateKey(ref),
    monthKey: getLocalMonthKey(ref),
    value: ref
  };
}

function addMonths(monthKey: string, offset: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + offset);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

function getCurrentMonthOptions(cobrancas: Cobranca[]) {
  const currentMonthKey = getLocalMonthKey(new Date());
  const recentFromSystem = Array.from({ length: 6 }, (_, index) => addMonths(currentMonthKey, -index));
  const fromData = cobrancas
    .map((cobranca) => getFaturamentoReferenceKey(cobranca)?.monthKey)
    .filter((value): value is string => Boolean(value));

  const keys = new Set<string>([currentMonthKey, ...recentFromSystem, ...fromData]);
  return Array.from(keys)
    .sort((a, b) => b.localeCompare(a))
    .map((value) => ({ value, label: formatMonthLabel(value) }));
}

function isEmpresaValida(cobranca: Pick<Cobranca, "id_empresa">) {
  const idEmpresa = Number(cobranca.id_empresa);
  return Number.isFinite(idEmpresa) && idEmpresa !== 0;
}

function isFilaPadrao(cobranca: Cobranca) {
  return (
    !Boolean(cobranca.confirmado) &&
    (cobranca.status === "PAID" || cobranca.status === "A_VENCER") &&
    isEmpresaValida(cobranca)
  );
}

function isBaseConfirmada(cobranca: Cobranca) {
  return (
    Boolean(cobranca.confirmado) &&
    (cobranca.status === "PAID" || cobranca.status === "A_VENCER") &&
    Boolean(cobranca.paid_at) &&
    isEmpresaValida(cobranca)
  );
}

function isEmitirBoletos(cobranca: Cobranca) {
  return (
    cobranca.tipo_cobranca?.toUpperCase() === "E-FATURADO" &&
    cobranca.status === "A_VENCER" &&
    Boolean(cobranca.confirmado) &&
    !Boolean(cobranca.boleto_enviadoo) &&
    isEmpresaValida(cobranca)
  );
}

function matchesTipoFiltro(cobranca: Cobranca, tipo: TipoFiltro) {
  if (tipo === "PENDENTES_APROVACAO") {
    return isPendenteAprovacao(cobranca);
  }

  if (tipo === "EMITIR_BOLETOS") {
    return isEmitirBoletos(cobranca);
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
    return cobranca.tipo_cobranca === "E-FATURADO";
  }

  return cobranca.tipo_cobranca === "CREDIT_CARD" || cobranca.tipo_cobranca === "CARD_PARCELADO";
}

export function CobrancasList() {
  const router = useRouter();
  const { cobrancasStats, source, refreshCobrancas } = useCobrancas();
  const { showToast } = useAppToast();
  const [search, setSearch] = useState("");
  const [tipo, setTipo] = useState<TipoFiltro>("TODOS");
  const [empresa, setEmpresa] = useState("TODAS");
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

  const monthOptions = useMemo(() => getCurrentMonthOptions(cobrancasStats), [cobrancasStats]);

  const visibleCobrancas = useMemo(() => {
    const base =
      tipo === "PENDENTES_APROVACAO"
        ? cobrancasStats.filter((c) => isPendenteAprovacao(c))
        : tipo === "EMITIR_BOLETOS"
          ? cobrancasStats.filter(isEmitirBoletos)
          : tipo !== "TODOS"
            ? cobrancasStats.filter(isBaseConfirmada)
            : cobrancasStats.filter(isFilaPadrao);

    return base
      .filter((cobranca) => {
        const matchesSearch = cobrancaMatchesSearch(cobranca, search);
        const matchesTipo =
          tipo === "TODOS" || tipo === "PENDENTES_APROVACAO" || tipo === "EMITIR_BOLETOS"
            ? true
            : matchesTipoFiltro(cobranca, tipo);
        const matchesEmpresa = empresa === "TODAS" || getEmpresaGrupoKey(cobranca) === empresa;

        return matchesSearch && matchesTipo && matchesEmpresa;
      })
      .slice(0, 500);
  }, [cobrancasStats, empresa, search, tipo]);

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

      <section className="grid gap-4 xl:grid-cols-4">
        <ConferenceStatCard
          title="Pendentes de aprovação"
          count={dashboardFinanceiro.pendentesResumo.count}
          total={dashboardFinanceiro.pendentesResumo.total}
          helper="E-Faturado aguardando validação financeira."
          tone="warning"
        />

        <ConferenceStatCard
          title="Confirmados do dia"
          count={dashboardFinanceiro.confirmadosDiaResumo.count}
          total={dashboardFinanceiro.confirmadosDiaResumo.total}
          helper="Baseado na data atual em America/Sao_Paulo."
          tone="success"
        />

        <section className="rounded-3xl border p-4 shadow-sm h-full">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {dashboardFinanceiro.source === "rpc" ? "Faturamento do período por empresa" : "Faturamento do dia por empresa"}
              </p>
              <p className="mt-2 text-xl font-bold text-slate-950">{formatCurrency(dashboardFinanceiro.faturamentoDiaResumoTotal)}</p>
            </div>
            <div className="rounded-2xl bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700">
              {dashboardFinanceiro.source === "rpc" ? "Período" : "Hoje"}
            </div>
          </div>

          <div className="mt-2 space-y-1">
            {dashboardFinanceiro.faturamentoDiaPorEmpresa.map((item) => {
              return (
                <div key={item.id_empresa} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-4 text-slate-900">{item.empresa}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold leading-4 text-slate-900">{formatCurrency(item.total)}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Faturamento total do mês corrente</p>
              <p className="mt-2 text-2xl font-bold text-slate-950">{formatCurrency(dashboardFinanceiro.faturamentoMesResumo.total)}</p>
            </div>
            <select value={mesSelecionado} onChange={(event) => setMesSelecionado(event.target.value)} className={filterClass}>
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            {dashboardFinanceiro.faturamentoMesPeriodo?.label ??
              "Período fechado por paid_at e confirmação, sem usar created_at."}
          </p>
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

          <select value={tipo} onChange={(event) => setTipo(event.target.value as TipoFiltro)} className={filterClass}>
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
              setMesSelecionado(getLocalMonthKey(new Date()));
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
            header: "Data/Hora",
            cell: (cobranca) => {
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
              <p>Data/Hora: {formatDateTime(getDataReferenciaCobranca(cobranca) || cobranca.created_at)}</p>
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
  tone
}: {
  title: string;
  count: number;
  total: number;
  helper: string;
  tone: "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-teal-200 bg-teal-50 text-teal-800"
      : "border-orange-200 bg-orange-50 text-orange-800";

  return (
    <section className={`rounded-3xl border p-5 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-bold text-slate-950">{count}</p>
          <p className="mt-1 text-sm text-slate-500">quantidade de registros</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-slate-900">{formatCurrency(total)}</p>
          <p className="text-xs text-slate-500">soma total</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{helper}</p>
    </section>
  );
}
