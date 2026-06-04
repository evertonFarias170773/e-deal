"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  Search,
  TrendingUp,
  Wallet,
  X
} from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { useAppToast } from "@/components/common/AppToast";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  boletosDepositosMock,
  contasReceberMock,
  getTipoRecebivelLabel
} from "@/lib/mocks/contas-receber.mock";
import type {
  BoletoDepositoMock
} from "@/lib/mocks/contas-receber.mock";
import { getContasReceberReadOnlyData } from "@/features/contas-a-receber/services/contas-receber.service";

type ActiveTab = "CARTEIRA" | "BOLETOS" | "VENCIMENTOS" | "CARTOES" | "PREVISAO";
type TipoFilter = "TODOS" | "BOLETO" | "DEPOSITO" | "CARTAO";
type StatusFilter = "TODOS" | "A_VENCER" | "VENCIDOS" | "PAID" | "VENCIDO" | "CANCELADO";

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none w-full";

export function ContasReceberPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [activeTab, setActiveTab] = useState<ActiveTab>("CARTEIRA");
  const [recebiveis, setRecebiveis] = useState<BoletoDepositoMock[]>([]);
  const [boletosDepositos, setBoletosDepositos] = useState<BoletoDepositoMock[]>([]);
  const [dataSource, setDataSource] = useState<"supabase" | "mock">("mock");
  const [isLoadingSource, setIsLoadingSource] = useState(true);
  
  // Date states initialized to dynamic client dates
  const [today, setToday] = useState("2026-06-04");
  const [firstDayOfMonth, setFirstDayOfMonth] = useState("2026-06-01");
  const [lastDayOfMonth, setLastDayOfMonth] = useState("2026-06-30");

  const [search, setSearch] = useState("");
  const [empresa, setEmpresa] = useState("TODAS");
  const [tipo, setTipo] = useState<TipoFilter>("TODOS");
  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [dataInicial, setDataInicial] = useState("2026-06-01");
  const [dataFinal, setDataFinal] = useState("2026-06-30");
  const [isAvulsoFilter, setIsAvulsoFilter] = useState<"TODOS" | "SIM" | "NAO">("TODOS");
  const [isFaturadoFilter, setIsFaturadoFilter] = useState<"TODOS" | "SIM" | "NAO">("TODOS");
  const [detailItem, setDetailItem] = useState<BoletoDepositoMock | null>(null);

  // Hydrate client-side dynamic dates safely
  useEffect(() => {
    const timer = setTimeout(() => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const clientToday = `${year}-${month}-${day}`;
      const clientFirstDay = `${year}-${month}-01`;
      const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
      const clientLastDay = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      
      setToday(clientToday);
      setFirstDayOfMonth(clientFirstDay);
      setLastDayOfMonth(clientLastDay);
      setDataInicial(clientFirstDay);
      setDataFinal(clientLastDay);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Fetch read-only data on mount
  useEffect(() => {
    let isMounted = true;

    async function loadContasReceber() {
      setIsLoadingSource(true);
      try {
        const result = await getContasReceberReadOnlyData();
        if (!isMounted) return;

        console.log("[ContasReceber] dados carregados.", {
          source: result.source,
          recebiveis: result.recebiveis.length,
          boletosDepositos: result.boletosDepositos.length
        });
        setRecebiveis(result.recebiveis);
        setBoletosDepositos(result.boletosDepositos);
        setDataSource(result.source);
      } catch (error) {
        console.log("[ContasReceber] erro ao carregar dados read-only.", { error });
        if (!isMounted) return;

        setRecebiveis(contasReceberMock as unknown as BoletoDepositoMock[]);
        setBoletosDepositos(boletosDepositosMock);
        setDataSource("mock");
      } finally {
        if (isMounted) {
          setIsLoadingSource(false);
        }
      }
    }

    void loadContasReceber();

    return () => {
      isMounted = false;
    };
  }, []);

  const filterState = useMemo(() => ({
    search,
    empresa,
    tipo,
    status,
    dataInicial,
    dataFinal,
    isAvulso: isAvulsoFilter,
    isFaturado: isFaturadoFilter
  }), [search, empresa, tipo, status, dataInicial, dataFinal, isAvulsoFilter, isFaturadoFilter]);

  const filteredRecebiveis = useMemo(
    () => filterVisibleRows(recebiveis, filterState, status, today),
    [recebiveis, filterState, status, today]
  );

  const filteredBoletos = useMemo(
    () => filterVisibleRows(boletosDepositos, filterState, status, today),
    [boletosDepositos, filterState, status, today]
  );

  const activeItemsForCards = useMemo(() => {
    if (activeTab === "BOLETOS") {
      return filteredBoletos;
    }
    return filteredRecebiveis;
  }, [activeTab, filteredRecebiveis, filteredBoletos]);

  const resumo = useMemo(
    () => buildResumoVisible(activeItemsForCards, today),
    [activeItemsForCards, today]
  );

  const empresaOptions = useMemo(() => {
    const empresas = Array.from(
      new Set(
        recebiveis
          .map((item) => item.empresa_original?.trim() || item.empresa || "")
          .filter((value) => Boolean(value))
      )
    );

    return empresas.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [recebiveis]);

  function confirmRecebimento(id: string) {
    const paidAt = new Date().toISOString();
    setRecebiveis((current) =>
      current.map((item) => item.id === id ? { ...item, status: "PAID", confirmado: true, paid_at: paidAt } : item)
    );
    setBoletosDepositos((current) =>
      current.map((item) => item.id === id ? { ...item, status: "PAID", confirmado: true, paid_at: paidAt } : item)
    );
    showToast({ type: "success", title: "Recebimento confirmado no mock." });
  }

  function cancelRecebivel(id: string) {
    const confirmed = window.confirm("Cancelar recebível mockado? Nenhum backend real será acionado.");
    if (!confirmed) return;

    setRecebiveis((current) => current.map((item) => item.id === id ? { ...item, status: "CANCELADO", confirmado: false } : item));
    setBoletosDepositos((current) => current.map((item) => item.id === id ? { ...item, status: "CANCELADO", confirmado: false } : item));
    showToast({ type: "warning", title: "Recebível cancelado no mock." });
  }

  function prorrogarBoleto(id: string) {
    setBoletosDepositos((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const nextDate = addDays(item.vencimento, 7);
        return {
          ...item,
          vencimento: nextDate,
          status: "A_VENCER",
          dias_atraso: undefined,
          observacao: "Vencimento prorrogado no mock; status financeiro permanece A_VENCER."
        };
      })
    );
    showToast({ type: "info", title: "Vencimento prorrogado em 7 dias no mock." });
  }

  async function copyLinhaDigitavel(value?: string) {
    if (!value) {
      showToast({ type: "warning", title: "Este item não possui linha digitável." });
      return;
    }

    await navigator.clipboard?.writeText(value);
    showToast({ type: "success", title: "Linha digitável copiada." });
  }

  function openPdf(url?: string) {
    if (!url) {
      showToast({ type: "warning", title: "Este item não possui PDF de boleto associado." });
      return;
    }
    window.open(url, "_blank");
  }

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "CARTEIRA", label: "Carteira" },
    { id: "BOLETOS", label: "Boletos e depósitos" },
    { id: "VENCIMENTOS", label: "Vencimentos" },
    { id: "CARTOES", label: "Cartões a receber" },
    { id: "PREVISAO", label: "Previsão de caixa" }
  ];

  return (
    <div className="space-y-6" data-contas-receber-source={dataSource}>
      <PageHeader
        title="Contas a receber"
        subtitle="Carteira financeira de boletos e previsões para acompanhamento de fluxos operacionais e recebíveis."
        context="Financeiro / Gestão de recebíveis"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Vencidos reais" value={formatCurrency(resumo.vencidos)} description="Cobranças vencidas reais (A Receber expirado / Vencido)." tone="danger" icon={AlertTriangle} />
        <SummaryCard title="Carteira ativa" value={formatCurrency(resumo.carteiraAtiva)} description="Cobranças operacionais ativas a receber em dia." tone="warning" icon={CalendarDays} />
        <SummaryCard title="Previsão futura" value={formatCurrency(resumo.previsaoFutura)} description="Previsões financeiras e recebíveis futuros de caixa." tone="info" icon={Wallet} />
        <SummaryCard title="Pagos" value={formatCurrency(resumo.pagos)} description="Cobranças e premissas quitadas no período." tone="success" icon={TrendingUp} />
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-9">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 xl:col-span-2">
            <Search className="h-4 w-4 text-[#0f9f9a] shrink-0" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por cliente, id, pagamento, OS ou CPF/CNPJ"
            />
          </label>

          <select value={empresa} onChange={(event) => setEmpresa(event.target.value)} className={filterClass}>
            <option value="TODAS">Todas as empresas</option>
            {empresaOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select value={tipo} onChange={(event) => setTipo(event.target.value as TipoFilter)} className={filterClass}>
            <option value="TODOS">Todos os tipos</option>
            <option value="BOLETO">Boleto</option>
            <option value="DEPOSITO">Depósito</option>
            <option value="CARTAO">Cartão</option>
          </select>

          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            <option value="A_VENCER">Previsão futura / E-Faturado (A Vencer)</option>
            <option value="VENCIDOS">Vencidos</option>
            <option value="PAID">Pagos</option>
            <option value="CANCELADO">Cancelados</option>
          </select>

          <select value={isAvulsoFilter} onChange={(event) => setIsAvulsoFilter(event.target.value as "TODOS" | "SIM" | "NAO")} className={filterClass}>
            <option value="TODOS">Todos (Avulso/OS)</option>
            <option value="SIM">Apenas Avulsos</option>
            <option value="NAO">Apenas OS</option>
          </select>

          <select value={isFaturadoFilter} onChange={(event) => setIsFaturadoFilter(event.target.value as "TODOS" | "SIM" | "NAO")} className={filterClass}>
            <option value="TODOS">Todos (Faturado/Não)</option>
            <option value="SIM">Apenas Faturados</option>
            <option value="NAO">Apenas Não Faturados</option>
          </select>

          <input
            type="date"
            value={dataInicial}
            onChange={(event) => setDataInicial(event.target.value)}
            className={filterClass}
            aria-label="Data inicial"
          />

          <input
            type="date"
            value={dataFinal}
            onChange={(event) => setDataFinal(event.target.value)}
            className={filterClass}
            aria-label="Data final"
          />

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setEmpresa("TODAS");
              setTipo("TODOS");
              setStatus("TODOS");
              setIsAvulsoFilter("TODOS");
              setIsFaturadoFilter("TODOS");
              setDataInicial(firstDayOfMonth);
              setDataFinal(lastDayOfMonth);
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 w-full"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-2 shadow-sm">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === tab.id ? "bg-[#0b2f4a] text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "CARTEIRA" ? (
        <CarteiraTab
          items={filteredRecebiveis}
          today={today}
          onConfirm={confirmRecebimento}
          onCancel={cancelRecebivel}
          onCopy={copyLinhaDigitavel}
          onPdf={openPdf}
          onDetail={setDetailItem}
          onNavigate={(path) => router.push(path)}
        />
      ) : null}

      {activeTab === "BOLETOS" ? (
        <BoletosDepositosTab
          items={filteredBoletos}
          today={today}
          onConfirm={confirmRecebimento}
          onCancel={cancelRecebivel}
          onCopy={copyLinhaDigitavel}
          onPdf={openPdf}
          onProrrogar={prorrogarBoleto}
          onDetail={setDetailItem}
          onNavigate={(path) => router.push(path)}
        />
      ) : null}

      {activeTab === "VENCIMENTOS" ? <VencimentosTab items={recebiveis} today={today} /> : null}
      {activeTab === "CARTOES" ? <CartoesFaturadoTab items={recebiveis} today={today} /> : null}
      {activeTab === "PREVISAO" ? <PrevisaoCaixaTab items={recebiveis} boletos={boletosDepositos} today={today} /> : null}

      <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        Contas a Receber é a carteira financeira de acompanhamento. A criação de cobranças e baixas reais permanecem gerenciadas no módulo operacional.
      </section>

      {isLoadingSource ? (
        <section className="rounded-3xl border border-dashed border-slate-350 bg-sky-50/50 p-4 text-sm leading-6 text-sky-850 animate-pulse">
          Buscando registros em tempo real na tabela public.boletos no Supabase. Fallback mock automático em caso de falha.
        </section>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500 flex justify-between items-center">
          <span>Fonte ativa de dados: <strong className="uppercase">{dataSource}</strong></span>
          <span>Dados atualizados da tabela public.boletos.</span>
        </section>
      )}

      {detailItem ? <RecebivelDetailModal item={detailItem} today={today} onClose={() => setDetailItem(null)} /> : null}
    </div>
  );
}

function GroupedSection({
  title,
  tone,
  items,
  today,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onDetail,
  onNavigate,
  isBoletoTab = false,
  onProrrogar
}: {
  title: string;
  tone: "danger" | "warning" | "info" | "success" | "neutral";
  items: BoletoDepositoMock[];
  today: string;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
  isBoletoTab?: boolean;
  onProrrogar?: (id: string) => void;
}) {
  if (items.length === 0) return null;

  const totalSum = items.reduce((acc, item) => acc + (item.valor_atualizado ?? item.valor), 0);

  const toneClasses = {
    danger: { bg: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50", dot: "bg-red-500" },
    warning: { bg: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50", dot: "bg-amber-500" },
    info: { bg: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/20 dark:text-sky-400 dark:border-sky-900/50", dot: "bg-sky-500" },
    success: { bg: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50", dot: "bg-emerald-500" },
    neutral: { bg: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:text-slate-400 dark:border-slate-800/50", dot: "bg-slate-500" }
  };

  const selectedTone = toneClasses[tone] || toneClasses.neutral;

  return (
    <div className="space-y-3 mb-6">
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border ${selectedTone.bg} px-4 py-2.5 text-xs font-bold uppercase tracking-wide`}>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${selectedTone.dot}`} />
          <span>{title} ({items.length})</span>
        </div>
        <div>Total: {formatCurrency(totalSum)}</div>
      </div>

      {isBoletoTab ? (
        <ResponsiveList<BoletoDepositoMock>
          items={items}
          getKey={(item) => item.id}
          columns={[
            { header: "N°", cell: (item) => <strong className="text-slate-950">{item.id_pagamento}</strong> },
            { header: "N° / OS", cell: (item) => <div><p>{item.id_int}</p><p className="text-xs text-slate-500">{item.os_ideal}</p></div> },
            { header: "Parc.", cell: (item) => item.parcela ? `${item.parcela}/${item.total_parcelas ?? item.parcela}` : "-", align: "center" },
            { header: "Cliente", cell: (item) => item.cliente },
            { header: "Empresa", cell: (item) => item.empresa },
            { header: "Tipo", cell: (item) => getTipoRecebivelLabel(item.tipo) },
            { header: "Venc.", cell: (item) => formatLocalDate(item.vencimento), align: "center" },
            { header: "Total", cell: (item) => formatCurrency(item.valor_atualizado ?? item.valor), align: "right" },
            { header: "Status", cell: (item) => <StatusBadge status={getVisualStatus(item, today)} tone={getVisualStatusTone(item, today)} />, align: "center" },
            { header: "Linha/Ref.", cell: (item) => item.linha_digitavel ?? item.referencia ?? "-" },
            { header: "Ações", cell: (item) => <BoletoActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onProrrogar={onProrrogar!} onDetail={onDetail} onNavigate={onNavigate} />, align: "right" }
          ]}
          renderCard={(item) => <RecebivelCard key={item.id} item={item} today={today} actions={<BoletoActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onProrrogar={onProrrogar!} onDetail={onDetail} onNavigate={onNavigate} label="Mais" />} />}
        />
      ) : (
        <ResponsiveList<BoletoDepositoMock>
          items={items}
          getKey={(item) => item.id}
          columns={[
            { header: "N°", cell: (item) => <strong className="text-slate-950">{item.id_pagamento}</strong> },
            { header: "N° / OS", cell: (item) => <div><p>{item.id_int}</p><p className="text-xs text-slate-500">{item.os_ideal}</p></div> },
            { header: "Cliente", cell: (item) => <div><p className="font-medium text-slate-900">{item.cliente}</p><p className="text-xs text-slate-500">{item.documento}</p></div> },
            { header: "Empresa", cell: (item) => item.empresa },
            { header: "Tipo", cell: (item) => getTipoRecebivelLabel(item.tipo) },
            { header: "Status", cell: (item) => <StatusBadge status={getVisualStatus(item, today)} tone={getVisualStatusTone(item, today)} />, align: "center" },
            { header: "Total", cell: (item) => formatCurrency(item.valor_atualizado ?? item.valor), align: "right" },
            { header: "Venc.", cell: (item) => formatLocalDate(item.vencimento), align: "center" },
            { header: "Conf.", cell: (item) => <StatusBadge status={item.confirmado ? "CONFIRMADO" : "NAO_CONFIRMADO"} tone={item.confirmado ? "success" : "neutral"} />, align: "center" },
            { header: "Ações", cell: (item) => <RecebivelActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} />, align: "right" }
          ]}
          renderCard={(item) => <RecebivelCard key={item.id} item={item} today={today} actions={<RecebivelActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} label="Mais" />} />}
        />
      )}
    </div>
  );
}

function CarteiraTab({
  items,
  today,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onDetail,
  onNavigate
}: {
  items: BoletoDepositoMock[];
  today: string;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
}) {
  const vencidos = useMemo(() => items.filter((item) => isVisualVencido(item, today)), [items, today]);
  const previsaoFutura = useMemo(() => items.filter((item) => item.status === "A_VENCER"), [items]);
  const pagos = useMemo(() => items.filter((item) => item.status === "PAID"), [items]);
  const cancelados = useMemo(() => items.filter((item) => item.status === "CANCELADO"), [items]);

  const hasItems = items.length > 0;

  if (!hasItems) {
    return (
      <ResponsiveList<BoletoDepositoMock>
        items={[]}
        getKey={(item) => item.id}
        emptyTitle="Nenhum recebível encontrado"
        emptyDescription="Ajuste os filtros para localizar recebíveis na carteira financeira."
        columns={[]}
        renderCard={() => null}
      />
    );
  }

  return (
    <div className="space-y-2">
      <GroupedSection title="Vencidos" tone="danger" items={vencidos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} />
      <GroupedSection title="Previsão futura / E-Faturado" tone="info" items={previsaoFutura} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} />
      <GroupedSection title="Pagos" tone="success" items={pagos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} />
      <GroupedSection title="Cancelados" tone="neutral" items={cancelados} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} />
    </div>
  );
}

function BoletosDepositosTab({
  items,
  today,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onProrrogar,
  onDetail,
  onNavigate
}: {
  items: BoletoDepositoMock[];
  today: string;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onProrrogar: (id: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
}) {
  const vencidos = useMemo(() => items.filter((item) => isVisualVencido(item, today)), [items, today]);
  const previsaoFutura = useMemo(() => items.filter((item) => item.status === "A_VENCER"), [items]);
  const pagos = useMemo(() => items.filter((item) => item.status === "PAID"), [items]);
  const cancelados = useMemo(() => items.filter((item) => item.status === "CANCELADO"), [items]);

  const hasItems = items.length > 0;

  if (!hasItems) {
    return (
      <ResponsiveList<BoletoDepositoMock>
        items={[]}
        getKey={(item) => item.id}
        emptyTitle="Nenhum boleto ou depósito encontrado"
        emptyDescription="Ajuste os filtros para localizar boletos, depósitos ou outros recebíveis."
        columns={[]}
        renderCard={() => null}
      />
    );
  }

  return (
    <div className="space-y-2">
      <GroupedSection title="Vencidos" tone="danger" items={vencidos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} />
      <GroupedSection title="Previsão futura / E-Faturado" tone="info" items={previsaoFutura} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} />
      <GroupedSection title="Pagos" tone="success" items={pagos} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} />
      <GroupedSection title="Cancelados" tone="neutral" items={cancelados} today={today} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} isBoletoTab onProrrogar={onProrrogar} />
    </div>
  );
}

function VencimentosTab({ items, today }: { items: BoletoDepositoMock[]; today: string }) {
  const visibleItems = items.filter((item) => isAllowedTipo(item.tipo) && item.status === "VENCIDO");
  const groups = [
    { title: "Vencidos", items: visibleItems.filter((item) => isVisualVencido(item, today)), tone: "danger" as const },
    { title: "Vencem hoje", items: visibleItems.filter((item) => item.vencimento === today), tone: "warning" as const },
    { title: "Próximos 7 dias", items: visibleItems.filter((item) => isWithinDays(item.vencimento, 7, today)), tone: "info" as const },
    { title: "Próximos 30 dias", items: visibleItems.filter((item) => isWithinDays(item.vencimento, 30, today)), tone: "neutral" as const }
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {groups.map((group) => (
        <section key={group.title} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">{group.title}</h2>
            <StatusBadge status={`${group.items.length} item(ns)`} tone={group.tone} />
          </div>
          <div className="space-y-3">
            {group.items.length ? group.items.map((item) => <MiniRecebivel key={`${group.title}-${item.id}`} item={item} />) : <p className="text-sm text-slate-500">Nenhum recebível neste grupo.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

function CartoesFaturadoTab({ items, today }: { items: BoletoDepositoMock[]; today: string }) {
  const filtered = items.filter((item) => isAllowedTipo(item.tipo) && item.tipo === "CARTAO");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {filtered.length ? (
        filtered.map((item) => (
          <article key={item.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.id_pagamento}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{item.cliente}</h3>
                <p className="mt-1 text-sm text-slate-500">{item.id_int} • {item.os_ideal} • Cartão</p>
              </div>
              <StatusBadge status={getVisualStatus(item, today)} tone={getVisualStatusTone(item, today)} />
            </div>
            <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <p>Valor: <strong className="text-slate-900">{formatCurrency(item.valor_atualizado ?? item.valor)}</strong></p>
              <p>Vencimento: {formatLocalDate(item.vencimento)}</p>
              <p>Confirmado: {item.confirmado ? "Sim" : "Não"}</p>
              <p>Empresa: {item.empresa}</p>
            </div>
            <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{item.observacao}</p>
          </article>
        ))
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600 lg:col-span-2">
          Cartões a receber ficará disponível em uma fase futura.
        </div>
      )}
    </div>
  );
}

function PrevisaoCaixaTab({ items, boletos, today }: { items: BoletoDepositoMock[]; boletos: BoletoDepositoMock[]; today: string }) {
  const previsaoItems = items.filter((item) => isAllowedTipo(item.tipo) && item.status === "A_VENCER");
  const weekly = groupByWeek(previsaoItems, today);
  const byEmpresa = groupByEmpresa(previsaoItems);
  const recebido = items.filter((item) => isAllowedTipo(item.tipo) && item.status === "PAID").reduce((total, item) => total + item.valor, 0);
  const aReceber = previsaoItems.reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0);
  const vencidos = items.filter((item) => isAllowedTipo(item.tipo) && isVisualVencido(item, today)).reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="rounded-2xl bg-sky-50 p-3 text-sky-700"><TrendingUp className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Previsão por semana</h2>
            <p className="text-sm text-slate-500">Agrupamento dinâmico por vencimento.</p>
          </div>
        </div>
        <div className="space-y-3">
          {weekly.map((row) => (
            <div key={row.label} className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-700">{row.label}</span>
                <strong className="text-slate-950">{formatCurrency(row.total)}</strong>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div className="h-2 rounded-full bg-[#0f9f9a]" style={{ width: `${Math.min(100, (row.total / Math.max(...weekly.map((item) => item.total), 1)) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <MiniResumo title="Recebidos x a vencer" rows={[["Recebido", recebido], ["A vencer", aReceber], ["Vencidos", vencidos]]} />
        <MiniResumo title="Por empresa" rows={byEmpresa.map((item) => [item.empresa, item.total])} />
        <MiniResumo title="Boletos e depósitos" rows={[
          ["Boletos", boletos.filter((item) => item.tipo === "BOLETO").reduce((total, item) => total + item.valor, 0)],
          ["Depósitos", boletos.filter((item) => item.tipo === "DEPOSITO").reduce((total, item) => total + item.valor, 0)]
        ]} />
      </section>
    </div>
  );
}

function RecebivelActions({
  item,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onDetail,
  onNavigate,
  label
}: {
  item: BoletoDepositoMock;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
  label?: string;
}) {
  return (
    <ActionsMenu
      label={label}
      items={[
        { label: "Ver detalhe recebível", onClick: () => onDetail(item) },
        { label: "Abrir proposta", onClick: () => onNavigate(`/orcamentos/${item.id_int}`) },
        { label: "Ver cliente", onClick: () => onNavigate(`/cadastros/${item.id_cliente}`) },
        { label: "Copiar linha digitável", disabled: !item.linha_digitavel, onClick: () => void onCopy(item.linha_digitavel) },
        { label: "Abrir PDF Boleto", disabled: !item.url_pdf, onClick: () => onPdf(item.url_pdf) },
        { label: "Confirmar recebimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onConfirm(item.id) },
        { label: "Cancelar recebível", destructive: true, disabled: item.status === "CANCELADO", onClick: () => onCancel(item.id) }
      ]}
    />
  );
}

function BoletoActions({
  item,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onProrrogar,
  onDetail,
  onNavigate,
  label
}: {
  item: BoletoDepositoMock;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onProrrogar: (id: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
  label?: string;
}) {
  return (
    <ActionsMenu
      label={label}
      items={[
        { label: "Ver detalhe boleto", onClick: () => onDetail(item) },
        { label: "Abrir proposta", onClick: () => onNavigate(`/orcamentos/${item.id_int}`) },
        { label: "Copiar linha digitável", disabled: !item.linha_digitavel, onClick: () => void onCopy(item.linha_digitavel) },
        { label: "Abrir PDF Boleto", disabled: !item.url_pdf, onClick: () => onPdf(item.url_pdf) },
        { label: "Confirmar recebimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onConfirm(item.id) },
        { label: "Prorrogar vencimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onProrrogar(item.id) },
        { label: "Cancelar boleto", destructive: true, disabled: item.status === "CANCELADO", onClick: () => onCancel(item.id) }
      ]}
    />
  );
}

function RecebivelCard({ item, today, actions }: { item: BoletoDepositoMock; today: string; actions: ReactNode }) {
  return (
    <article className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {item.id_pagamento}</p>
          <h3 className="mt-2 font-semibold text-slate-950">{item.cliente}</h3>
          <p className="mt-1 text-sm text-slate-500">{item.id_int} • {item.os_ideal} • {item.empresa}</p>
        </div>
        <StatusBadge status={getVisualStatus(item, today)} tone={getVisualStatusTone(item, today)} />
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-600">
        <p>Tipo: {getTipoRecebivelLabel(item.tipo)}</p>
        <p>Total: <strong className="text-slate-900">{formatCurrency(item.valor_atualizado ?? item.valor)}</strong></p>
        {item.dias_atraso !== undefined && item.dias_atraso > 0 && <p className="text-red-650">Atraso: <strong>{item.dias_atraso} dia(s)</strong></p>}
        <p>Venc.: {formatLocalDate(item.vencimento)}</p>
        <p>Conf.: {item.confirmado ? "Sim" : "Não"}</p>
      </div>
      <div className="mt-4 flex justify-end">{actions}</div>
    </article>
  );
}

function MiniRecebivel({ item }: { item: BoletoDepositoMock }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">{item.cliente}</p>
          <p className="text-sm text-slate-500">N° {item.id_pagamento} • {getTipoRecebivelLabel(item.tipo)}</p>
        </div>
        <strong className="text-right text-slate-950">{formatCurrency(item.valor_atualizado ?? item.valor)}</strong>
      </div>
      <p className="mt-2 text-xs text-slate-500">Venc. {formatLocalDate(item.vencimento)} • {item.empresa}</p>
    </div>
  );
}

function MiniResumo({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">{label}</span>
            <strong className="text-right text-slate-900">{formatCurrency(value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecebivelDetailModal({
  item,
  today,
  onClose
}: {
  item: BoletoDepositoMock;
  today: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Conferência de Recebível</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">{item.id_pagamento}</h2>
            <p className="mt-1 text-sm text-slate-500">{item.cliente} • {item.id_int} • {item.os_ideal}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200"
            aria-label="Fechar detalhe"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DetailField label="Empresa" value={item.empresa} />
          <DetailField label="Tipo de cobrança" value={getTipoRecebivelLabel(item.tipo)} />
          <DetailField label="Status visual" value={humanizeLocalStatus(getVisualStatus(item, today))} />
          <DetailField label="Status financeiro" value={humanizeLocalStatus(item.status)} />
          <DetailField label="Total original" value={formatCurrency(item.valor)} />
          {item.valor_atualizado !== undefined && <DetailField label="Total atualizado" value={formatCurrency(item.valor_atualizado)} />}
          <DetailField label="Vencimento" value={formatLocalDate(item.vencimento)} />
          <DetailField label="Confirmado" value={item.confirmado ? "Sim" : "Não"} />
          <DetailField label="CPF / CNPJ" value={item.documento} />
          <DetailField label="Parcela" value={item.parcela ? `${item.parcela}/${item.total_parcelas ?? item.parcela}` : "-"} />
          {item.multa !== undefined && item.multa > 0 && <DetailField label="Multa aplicada" value={formatCurrency(item.multa)} />}
          {item.juros_dia !== undefined && item.juros_dia > 0 && <DetailField label="Juros por dia" value={formatCurrency(item.juros_dia)} />}
          {item.dias_atraso !== undefined && item.dias_atraso > 0 && <DetailField label="Dias de atraso" value={`${item.dias_atraso} dia(s)`} />}
          {item.is_avulso !== undefined && <DetailField label="Tipo de emissão" value={item.is_avulso ? "Faturamento Avulso" : "Ordem de Serviço (OS)"} />}
          {item.is_faturado !== undefined && <DetailField label="Faturamento faturado" value={item.is_faturado ? "Sim" : "Não"} />}
          {item.linha_digitavel && <DetailField label="Linha Digitável" value={item.linha_digitavel} />}
          {item.codigo_barras && <DetailField label="Código de barras" value={item.codigo_barras} />}
          {item.nosso_numero && <DetailField label="Nosso Número" value={item.nosso_numero} />}
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observação / Descrição</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{item.observacao || "Nenhuma observação ou descrição vinculada."}</p>
        </div>

        {item.url_pdf && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => window.open(item.url_pdf, "_blank")}
              className="w-full rounded-2xl bg-[#0f9f9a] text-white px-4 py-3 text-sm font-semibold transition hover:bg-[#0c7c78]"
            >
              Visualizar PDF do boleto
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}



function matchesVisibleStatus(item: BoletoDepositoMock, status: StatusFilter, today: string) {
  if (status === "TODOS") return true;
  if (status === "VENCIDOS") return isVisualVencido(item, today);
  if (status === "A_VENCER") return item.status === "A_VENCER";

  if (status === "PAID") return item.status === "PAID";
  if (status === "CANCELADO") return item.status === "CANCELADO";
  return true;
}

function buildResumoVisible(recebiveis: BoletoDepositoMock[], today: string) {
  const carteira = recebiveis.filter((item) => isAllowedTipo(item.tipo));

  return {
    vencidos: carteira.filter((item) => isVisualVencido(item, today)).reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0),
    carteiraAtiva: 0, // A_RECEBER completely excluded from cards
    previsaoFutura: carteira.filter((item) => item.status === "A_VENCER").reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0),
    pagos: carteira.filter((item) => item.status === "PAID").reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0)
  };
}

function isAllowedTipo(tipo: string) {
  return tipo === "BOLETO" || tipo === "DEPOSITO" || tipo === "CARTAO" || tipo === "E-FATURADO" || tipo === "OUTRO_RECEBIVEL";
}

function getPaidSortScore(item: BoletoDepositoMock) {
  return toMillis(item.paid_at) ?? toMillis(item.vencimento) ?? toMillis(item.created_at) ?? 0;
}

function toMillis(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getVisualStatus(item: BoletoDepositoMock, today: string): string {
  if (isVisualVencido(item, today)) return "VENCIDO";
  return item.status;
}

function getVisualStatusTone(item: BoletoDepositoMock, today: string) {
  if (isVisualVencido(item, today)) return "danger";
  if (item.status === "PAID") return "success";
  if (item.status === "A_VENCER") return "warning";
  if (item.status === "A_RECEBER") return "info";
  return "neutral";
}

function humanizeLocalStatus(status: string) {
  const labels: Record<string, string> = {
    A_RECEBER: "Carteira em aberto (Emitida)",
    A_VENCER: "Previsão futura",
    PAID: "Pago",
    CANCELADO: "Cancelado",
    VENCIDO: "Vencido"
  };

  return labels[status] ?? status;
}

function formatLocalDate(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}



function isVisualVencido(item: BoletoDepositoMock, _today: string) {
  if (_today) {
    // no-op to satisfy eslint unused-vars
  }
  return item.status === "VENCIDO";
}

function isDateInRange(value: string, start: string, end: string) {
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

function isWithinDays(vencimento: string, days: number, today: string) {
  const diff = diffDays(vencimento, today);
  return diff >= 0 && diff <= days;
}

function diffDays(vencimento: string, today: string) {
  const base = new Date(`${today}T00:00:00-03:00`).getTime();
  const target = new Date(`${vencimento}T00:00:00-03:00`).getTime();
  return Math.round((target - base) / 86400000);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00-03:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function groupByWeek(items: BoletoDepositoMock[], today: string) {
  const rows = [
    { label: "Semana atual", start: 0, end: 7 },
    { label: "Próximos 15 dias", start: 8, end: 15 },
    { label: "Próximos 30 dias", start: 16, end: 30 },
    { label: "Acima de 30 dias", start: 31, end: 999 }
  ];

  return rows.map((row) => ({
    label: row.label,
    total: items
      .filter((item) => {
        const diff = diffDays(item.vencimento, today);
        return diff >= row.start && diff <= row.end;
      })
      .reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0)
  }));
}

function groupByEmpresa(items: BoletoDepositoMock[]) {
  const totals = new Map<string, number>();

  for (const item of items) {
    const empresa = item.empresa_original?.trim() || item.empresa || "Empresa não informada";
    totals.set(empresa, (totals.get(empresa) ?? 0) + (item.valor_atualizado ?? item.valor));
  }

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([empresa, total]) => ({ empresa, total }));
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function filterVisibleRows(
  items: BoletoDepositoMock[],
  filters: { 
    search: string; 
    empresa: string; 
    tipo: TipoFilter; 
    status: StatusFilter; 
    dataInicial: string; 
    dataFinal: string;
    isAvulso: "TODOS" | "SIM" | "NAO";
    isFaturado: "TODOS" | "SIM" | "NAO";
  },
  status: StatusFilter,
  today: string
) {
  const normalizedSearch = normalize(filters.search);

  const filtered = items.filter((item) => {
    if (!isAllowedTipo(item.tipo)) {
      return false;
    }

    const haystack = normalize(`${item.cliente} ${item.id_int} ${item.id_pagamento} ${item.os_ideal} ${item.documento}`);
    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
    const matchesEmpresa = filters.empresa === "TODAS" || (item.empresa_original?.trim() || item.empresa) === filters.empresa;
    const matchesTipo = filters.tipo === "TODOS" || item.tipo === filters.tipo;
    const matchesStatus = matchesVisibleStatus(item, filters.status, today);
    const matchesPeriodo = isDateInRange(item.vencimento, filters.dataInicial, filters.dataFinal);
    
    let matchesAvulso = true;
    if (filters.isAvulso === "SIM") {
      matchesAvulso = item.is_avulso === true;
    } else if (filters.isAvulso === "NAO") {
      matchesAvulso = item.is_avulso !== true;
    }

    let matchesFaturado = true;
    if (filters.isFaturado === "SIM") {
      matchesFaturado = item.is_faturado === true;
    } else if (filters.isFaturado === "NAO") {
      matchesFaturado = item.is_faturado !== true;
    }

    return matchesSearch && matchesEmpresa && matchesTipo && matchesStatus && matchesPeriodo && matchesAvulso && matchesFaturado;
  });

  if (status !== "PAID") {
    return filtered;
  }

  return [...filtered]
    .sort((a, b) => getPaidSortScore(b) - getPaidSortScore(a))
    .slice(0, 100);
}
