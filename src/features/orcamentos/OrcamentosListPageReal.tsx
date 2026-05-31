"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CreditCard, FileText, Search, WalletCards } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import { buildPropostaInformalText } from "@/features/orcamentos/orcamento-utils";
import { useOrcamentosReadOnlyData } from "@/features/orcamentos/hooks/useOrcamentosReadOnlyData";
import type { OrcamentoListItem } from "@/features/orcamentos/mappers";
import { gerarPDFProposta } from "@/features/orcamentos/services/orcamentos.service";

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";
const defaultStatusOrder = ["NOVO", "AGUARDANDO", "APROVADO", "CANCELADO"];

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function getSearchableProposalText(item: OrcamentoListItem) {
  return normalize(
    [
      item.id_int,
      item.clienteId,
      item.clienteNome,
      item.documento,
      item.vendedor,
      item.statusLabel,
      item.tipoCobrancaLabel,
      item.modelo,
      item.createdAt,
      item.osIdeal,
      formatCurrency(item.total)
    ]
      .map((value) => String(value ?? ""))
      .join(" ")
  );
}

function getSearchableProposalDigits(item: OrcamentoListItem) {
  return [
    item.id_int,
    item.clienteId,
    item.documento,
    item.total,
    item.osIdeal
  ]
    .map((value) => onlyDigits(value))
    .join(" ");
}

function getMonthKeyFromDate(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).format(value);
}

function getMonthKeyFromIso(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? getMonthKeyFromDate(date) : "";
}

function getPeriodKeyFromProposal(item: OrcamentoListItem) {
  return item.periodoKey || getMonthKeyFromIso(item.createdAt) || "";
}

type PeriodOption = {
  value: string;
  label: string;
};

function formatPeriodLabel(date: Date) {
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "short"
  })
    .format(date)
    .replace(".", "");

  const formattedMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const year = String(date.getFullYear()).slice(2);

  return `${formattedMonth}/${year}`;
}

function getPeriodValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildLastSixPeriodOptions() {
  const today = new Date();
  const periods = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);

    return {
      label: formatPeriodLabel(date),
      value: getPeriodValue(date)
    } satisfies PeriodOption;
  });

  return periods satisfies PeriodOption[];
}

function getSelectedPeriodLabel(periodo: string, periodOptions: PeriodOption[]) {
  return periodOptions.find((option) => option.value === periodo)?.label ?? "período selecionado";
}

function normalizeProposalStatus(status: string | null | undefined) {
  const normalized = normalize(String(status ?? ""));

  if (!normalized) {
    return "SEM_STATUS";
  }

  if (normalized.includes("nov")) {
    return "NOVO";
  }

  if (normalized.includes("aguard") || normalized.includes("pend")) {
    return "AGUARDANDO";
  }

  if (normalized.includes("aprov")) {
    return "APROVADO";
  }

  if (normalized.includes("cancel")) {
    return "CANCELADO";
  }

  return "SEM_STATUS";
}

function isEmAbertoStatus(status: string | null | undefined) {
  const normalized = normalizeProposalStatus(status);
  return normalized === "NOVO" || normalized === "AGUARDANDO" || normalized === "SEM_STATUS";
}

function isAguardandoStatus(status: string | null | undefined) {
  return normalizeProposalStatus(status) === "AGUARDANDO";
}

function isAprovadaStatus(status: string | null | undefined) {
  return normalizeProposalStatus(status) === "APROVADO";
}

function sumPropostaTotal(items: OrcamentoListItem[]) {
  return items.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
}

function getStatusTone(status: string) {
  const normalized = normalize(status);
  if (normalized.includes("aprov")) return "success";
  if (normalized.includes("aguard") || normalized.includes("pend")) return "warning";
  if (normalized.includes("cancel")) return "neutral";
  return "info";
}

export function OrcamentosListPageReal() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const periodOptions = buildLastSixPeriodOptions();
  const [periodo, setPeriodo] = useState(periodOptions[0]?.value ?? getPeriodValue(new Date()));
  const { propostas, source, warnings, detectedColumns, loadedCount, diagnostics, isLoading } = useOrcamentosReadOnlyData(periodo);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("TODOS");
  const [modelo, setModelo] = useState("TODOS_MODELOS");
  const [vendedor, setVendedor] = useState("TODOS");

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(propostas.map((item) => item.status))).filter(Boolean);
    const ordered = values.sort((a, b) => {
      const indexA = defaultStatusOrder.indexOf(a);
      const indexB = defaultStatusOrder.indexOf(b);
      if (indexA === -1 && indexB === -1) return a.localeCompare(b, "pt-BR");
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

    return ["TODOS", ...ordered];
  }, [propostas]);

  const vendedorOptions = useMemo(
    () => Array.from(new Set(propostas.map((item) => item.vendedor).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [propostas]
  );

  const modeloOptions = useMemo(
    () => [
      { value: "TODOS_MODELOS", label: "Todos modelos" },
      { value: "AVULSO", label: "AVULSO" },
      { value: "PROPOSTA", label: "PROPOSTA" }
    ],
    []
  );

  const filteredPropostas = useMemo(() => {
    const normalizedSearch = normalize(search.trim());
    const digitsSearch = onlyDigits(search);

    return propostas.filter((item) => {
      const searchableText = getSearchableProposalText(item);
      const searchableDigits = getSearchableProposalDigits(item);
      const matchesSearch =
        !normalizedSearch && !digitsSearch
          ? true
          : (normalizedSearch && searchableText.includes(normalizedSearch)) ||
            (digitsSearch && searchableDigits.includes(digitsSearch));
      const matchesStatus = status === "TODOS" || item.status === status;
      const matchesModelo =
        modelo === "TODOS_MODELOS" ||
        (modelo === "AVULSO" ? item.isAvulsoRaw === true : item.isAvulsoRaw !== true);
      const matchesVendedor = vendedor === "TODOS" || item.vendedor === vendedor;
      const matchesPeriodo = getPeriodKeyFromProposal(item) === periodo;

      return matchesSearch && matchesStatus && matchesModelo && matchesVendedor && matchesPeriodo;
    });
  }, [modelo, periodo, propostas, search, status, vendedor]);

  const periodoSelecionadoLabel = useMemo(() => getSelectedPeriodLabel(periodo, periodOptions), [periodOptions, periodo]);
  const emAbertoItens = useMemo(
    () => propostas.filter((item) => isEmAbertoStatus(item.statusInterno)),
    [propostas]
  );
  const aprovadasItens = useMemo(
    () => propostas.filter((item) => isAprovadaStatus(item.statusInterno)),
    [propostas]
  );
  const aguardandoItens = useMemo(
    () => propostas.filter((item) => isAguardandoStatus(item.statusInterno)),
    [propostas]
  );
  const emAbertoResumo = useMemo(
    () => ({
      quantidade: emAbertoItens.length,
      total: sumPropostaTotal(emAbertoItens)
    }),
    [emAbertoItens]
  );
  const aprovadasResumo = useMemo(
    () => ({
      quantidade: aprovadasItens.length,
      total: sumPropostaTotal(aprovadasItens)
    }),
    [aprovadasItens]
  );
  const aguardandoResumo = useMemo(
    () => ({
      quantidade: aguardandoItens.length,
      total: sumPropostaTotal(aguardandoItens)
    }),
    [aguardandoItens]
  );

  useEffect(() => {
    console.info("[Orcamentos][ReadOnly]", {
      source,
      loadedCount,
      warnings,
      detectedColumns: detectedColumns.slice(0, 20)
    });
  }, [detectedColumns, loadedCount, source, warnings]);

  function showMockAction(title: string) {
    showToast({
      type: "info",
      title,
      description: "Acao mockada para validacao visual. Nenhum backend real foi acionado."
    });
  }

  async function handleGerarPDFForListItem(item: OrcamentoListItem) {
    const isUnregistered = !item.clienteId || item.clienteId === "0" || item.clienteId === "null" || Boolean(item.mockProposal?.clienteNaoCadastrado);
    if (isUnregistered) {
      showToast({
        type: "warning",
        title: "Geração de PDF bloqueada",
        description: "Para gerar PDF, primeiro cadastre ou vincule um cliente à proposta."
      });
      return;
    }

    const labelLower = (item.empresaLabel || "").toLowerCase();
    let idEmpresa: number | null = null;
    if (labelLower.includes("grafica") || labelLower.includes("ingresso")) {
      idEmpresa = 1;
    } else if (labelLower.includes("biro")) {
      idEmpresa = 2;
    } else if (labelLower.includes("e3") || labelLower.includes("brindes")) {
      idEmpresa = 3;
    }

    if (idEmpresa === null) {
      showToast({
        type: "error",
        title: "Empresa inválida",
        description: "A empresa selecionada para a proposta não é suportada para geração de PDF (use Ideal Grafica, Ideal Biro ou E3 Brindes)."
      });
      return;
    }

    showToast({
      type: "info",
      title: "Gerando PDF",
      description: "Aguarde enquanto geramos o PDF da proposta comercial..."
    });

    try {
      const res = await gerarPDFProposta(item.id_int, idEmpresa);
      if (res.success && res.url) {
        window.open(res.url, "_blank");
        showToast({
          type: "success",
          title: "PDF Gerado",
          description: "O PDF da proposta foi aberto em uma nova aba."
        });
      } else {
        showToast({
          type: "error",
          title: "Falha na geração",
          description: "Não foi possível gerar o PDF da proposta."
        });
        console.error("[Edge Function Error] Falha ao gerar PDF da proposta:", res.errorMessage);
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: "Ocorreu um erro ao tentar gerar o PDF."
      });
      console.error("[PDF Error] Erro ao chamar Edge Function:", err);
    }
  }

  function getActions(item: OrcamentoListItem) {
    const isClienteNaoCadastrado = !item.clienteId || item.clienteId === "0" || item.clienteId === "null" || Boolean(item.mockProposal?.clienteNaoCadastrado);

    if (item.mockProposal) {
      return [
        { label: "Ver proposta", onClick: () => router.push(`/orcamentos/${item.id_int}`) },
        { label: "Editar proposta", onClick: () => router.push(`/orcamentos/${item.id_int}/editar`) },
        { label: "Duplicar proposta", onClick: () => showMockAction("Duplicar proposta") },
        {
          label: "Copiar proposta informal",
          onClick: async () => {
            const frete = item.mockProposal!.fretes.find((freteItem) => freteItem.id === item.mockProposal!.freteEscolhidoId);
            const text = buildPropostaInformalText({
              id_int: item.mockProposal!.id_int,
              clienteNome: item.mockProposal!.cliente.nome,
              itens: item.mockProposal!.itens,
              frete,
              resumo: item.mockProposal!.resumo,
              formaPagamento: item.mockProposal!.formaPagamento
            });

            await navigator.clipboard?.writeText(text);
            showToast({ type: "success", title: "Resumo cobrado", description: "Proposta informal copiada para WhatsApp." });
          }
        },
        { label: "Gerar PDF da proposta", onClick: () => void handleGerarPDFForListItem(item) },
        ...(!isClienteNaoCadastrado ? [{ label: "Gerar cobranca", onClick: () => router.push(`/cobrancas/nova?id_int=${item.id_int}`) }] : []),
        { label: "Ver financeiro", onClick: () => router.push("/cobrancas") },
        { label: "Cancelar proposta", destructive: true, onClick: () => showMockAction("Cancelar proposta") }
      ];
    }

    return [
      { label: "Ver proposta", onClick: () => router.push(`/orcamentos/${item.id_int}`) },
      { label: "Editar proposta", onClick: () => router.push(`/orcamentos/${item.id_int}/editar`) },
      { label: "Duplicar proposta", onClick: () => showToast({ type: "info", title: "Duplicacao ainda nao conectada." }) },
      { label: "Copiar proposta informal", onClick: () => showToast({ type: "info", title: "Resumo informal ainda nao disponivel para dados reais." }) },
      { label: "Gerar PDF da proposta", onClick: () => void handleGerarPDFForListItem(item) },
      ...(!isClienteNaoCadastrado ? [{ label: "Gerar cobranca", onClick: () => router.push(`/cobrancas/nova?id_int=${item.id_int}`) }] : []),
      { label: "Ver financeiro", onClick: () => router.push("/cobrancas") },
      { label: "Cancelar proposta", destructive: true, onClick: () => showToast({ type: "warning", title: "Cancelamento ainda nao conectado." }) }
    ];
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orcamentos"
        subtitle="Monte e acompanhe propostas comerciais com cliente, cobrança vinculada e resumo operacional."
        context="Orcamentos / Propostas"
        action={
          <button
            type="button"
            onClick={() => router.push("/orcamentos/novo")}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
          >
            + Nova proposta
          </button>
        }
      />

      {isLoading ? (
        <section className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white dark:bg-slate-800/40 dark:border-slate-700" />
          ))}
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            title="Em aberto"
            value={emAbertoResumo.quantidade.toString()}
            description={
              <span>
                Soma em {periodoSelecionadoLabel}:{" "}
                <strong className="text-base font-bold text-slate-900">{formatCurrency(emAbertoResumo.total)}</strong>
              </span>
            }
            tone="info"
            icon={FileText}
          />
          <SummaryCard
            title="Aprovadas"
            value={aprovadasResumo.quantidade.toString()}
            description={
              <span>
                Soma em {periodoSelecionadoLabel}:{" "}
                <strong className="text-base font-bold text-slate-900">{formatCurrency(aprovadasResumo.total)}</strong>
              </span>
            }
            tone="success"
            icon={WalletCards}
          />
          <SummaryCard
            title="Aguardando"
            value={aguardandoResumo.quantidade.toString()}
            description={
              <span>
                Soma em {periodoSelecionadoLabel}:{" "}
                <strong className="text-base font-bold text-slate-900">{formatCurrency(aguardandoResumo.total)}</strong>
              </span>
            }
            tone="warning"
            icon={CreditCard}
          />
        </section>
      )}

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_170px_170px_170px_150px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por proposta, cliente, ID cliente, valor ou OS Ideal"
            />
          </label>

          <select value={status} onChange={(event) => setStatus(event.target.value)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            {statusOptions.filter((item) => item !== "TODOS").map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={modelo} onChange={(event) => setModelo(event.target.value)} className={filterClass}>
            {modeloOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select value={vendedor} onChange={(event) => setVendedor(event.target.value)} className={filterClass}>
            <option value="TODOS">Todos vendedores</option>
            {vendedorOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={periodo} onChange={(event) => setPeriodo(event.target.value)} className={filterClass}>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatus("TODOS");
              setModelo("TODOS_MODELOS");
              setVendedor("TODOS");
              setPeriodo(periodOptions[0]?.value ?? getPeriodValue(new Date()));
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <ResponsiveList<OrcamentoListItem>
        items={filteredPropostas}
        getKey={(proposta) => proposta.id}
        isLoading={isLoading}
        emptyTitle="Nenhuma proposta encontrada"
        emptyDescription="Ajuste os filtros ou crie uma nova proposta para comecar."
        columns={[
          { header: "N°", cell: (proposta) => <span className="font-semibold text-slate-950">{proposta.id_int}</span> },
          {
            header: "id - Cliente",
            cell: (proposta) => {
              const isClienteNaoCadastrado = !proposta.clienteId || proposta.clienteId === "0";
              return (
                <div>
                  <p className="font-medium text-slate-900">
                    {isClienteNaoCadastrado ? (
                      <>
                        {proposta.clienteNome}
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">Sem cadastro</span>
                      </>
                    ) : (
                      <>{proposta.clienteId} - {proposta.clienteNome}</>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">{proposta.documento || ""}</p>
                </div>
              );
            }
          },
          { header: "Tipo cobrança", cell: (proposta) => proposta.tipoCobrancaLabel, align: "center" },
          { header: "Data / Hora", cell: (proposta) => <span>{proposta.createdAt ? formatDateTime(proposta.createdAt) : "-"}</span>, align: "center" },
          { header: "Atendente", cell: (proposta) => proposta.vendedor },
          { header: "Status", cell: (proposta) => <StatusBadge status={proposta.statusLabel} tone={getStatusTone(proposta.status)} />, align: "center" },
          { header: "Valor total", cell: (proposta) => formatCurrency(proposta.total), align: "right" },
          { header: "Modelo", cell: (proposta) => proposta.modelo, align: "center" },
          { header: "Ações", cell: (proposta) => <ActionsMenu items={getActions(proposta)} />, align: "right" }
        ]}
        renderCard={(proposta) => (
          <article key={proposta.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {proposta.id_int}</p>
                <h3 className="mt-2 font-semibold text-slate-950">
                  {(!proposta.clienteId || proposta.clienteId === "0") ? (
                    <>
                      {proposta.clienteNome}
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">Sem cadastro</span>
                    </>
                  ) : (
                    <>{proposta.clienteId || "—"} - {proposta.clienteNome}</>
                  )}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{proposta.vendedor}</p>
              </div>
              <StatusBadge status={proposta.statusLabel} tone={getStatusTone(proposta.status)} />
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Tipo cobrança: {proposta.tipoCobrancaLabel}</p>
              <p>Data / Hora: {proposta.createdAt ? formatDateTime(proposta.createdAt) : "-"}</p>
              <p>Modelo: {proposta.modelo}</p>
              <p className="font-semibold text-slate-900">Valor total: {formatCurrency(proposta.total)}</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  router.push(`/orcamentos/${proposta.id_int}`);
                }}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white"
              >
                Ver
              </button>
              <ActionsMenu label="Mais" items={getActions(proposta).filter((item) => item.label !== "Ver proposta")} />
            </div>
          </article>
        )}
      />

      {!isLoading ? (
        <section className={`rounded-3xl border border-dashed p-4 text-sm ${
          source === "supabase"
            ? "border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-800/20 dark:border-slate-700 dark:text-slate-400"
            : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-300"
        }`}>
          <div className="flex items-start gap-3">
            <CalendarDays className={`mt-0.5 h-4 w-4 ${source === "supabase" ? "text-[#0f9f9a]" : "text-amber-600"}`} />
            <div>
              <p className="font-semibold">
                {source === "supabase"
                  ? `Dados reais carregados em public.propostas (${loadedCount} registros).`
                  : "Não foi possível carregar dados reais. Exibindo fallback local."}
              </p>
              {source === "mock" && (
                <p className="mt-1 text-xs">
                  A conexão com o banco de dados Supabase falhou ou não retornou dados. Exibindo dados de simulação locais.
                </p>
              )}
            </div>
          </div>
          {source === "supabase" ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Colunas detectadas: {detectedColumns.slice(0, 20).join(", ")}
              {detectedColumns.length > 20 ? "..." : ""}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

