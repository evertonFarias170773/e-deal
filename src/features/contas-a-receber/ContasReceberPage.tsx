"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
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
  BoletoDepositoMock,
  BoletoDepositoTipo,
  RecebivelMock,
  RecebivelTipo
} from "@/lib/mocks/contas-receber.mock";

type ActiveTab = "CARTEIRA" | "BOLETOS" | "VENCIMENTOS" | "CARTOES" | "PREVISAO";
type TipoFilter = "TODOS" | RecebivelTipo | BoletoDepositoTipo;
type StatusFilter = "TODOS" | "A_VENCER" | "PAID" | "CANCELADO" | "VENCIDO";

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";
const today = "2026-05-22";
const firstDayOfMonth = "2026-05-01";
const lastDayOfMonth = "2026-05-31";

export function ContasReceberPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [activeTab, setActiveTab] = useState<ActiveTab>("CARTEIRA");
  const [recebiveis, setRecebiveis] = useState<RecebivelMock[]>(contasReceberMock);
  const [boletosDepositos, setBoletosDepositos] = useState<BoletoDepositoMock[]>(boletosDepositosMock);
  const [search, setSearch] = useState("");
  const [empresa, setEmpresa] = useState("TODAS");
  const [tipo, setTipo] = useState<TipoFilter>("TODOS");
  const [status, setStatus] = useState<StatusFilter>("A_VENCER");
  const [dataInicial, setDataInicial] = useState(firstDayOfMonth);
  const [dataFinal, setDataFinal] = useState(lastDayOfMonth);
  const [detailItem, setDetailItem] = useState<RecebivelMock | BoletoDepositoMock | null>(null);

  const filterState = { search, empresa, tipo, status, dataInicial, dataFinal };
  const filteredRecebiveis = useMemo(
    () => recebiveis.filter((item) => matchesFilters(item, filterState, { includeAReceber: false })),
    [dataFinal, dataInicial, empresa, recebiveis, search, status, tipo]
  );

  const filteredBoletos = useMemo(
    () => boletosDepositos.filter((item) => matchesFilters(item, filterState, { includeAReceber: false })),
    [boletosDepositos, dataFinal, dataInicial, empresa, search, status, tipo]
  );

  const resumo = useMemo(() => buildResumo(filteredRecebiveis), [filteredRecebiveis]);

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
    showToast({
      type: url ? "info" : "warning",
      title: url ? "PDF mockado aberto." : "Este item não possui PDF mockado."
    });
  }

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "CARTEIRA", label: "Carteira" },
    { id: "BOLETOS", label: "Boletos e depósitos" },
    { id: "VENCIMENTOS", label: "Vencimentos" },
    { id: "CARTOES", label: "Cartões e faturado" },
    { id: "PREVISAO", label: "Previsão de caixa" }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas a receber"
        subtitle="Carteira financeira mockada para acompanhar vencimentos, boletos, depósitos futuros, cartões aprovados, faturados e previsão de caixa."
        context="Financeiro / Gestão de recebíveis"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="A vencer" value={formatCurrency(resumo.aVencer)} description="Recebíveis aprovados com vencimento futuro." tone="info" icon={Wallet} />
        <SummaryCard title="Vencidos" value={formatCurrency(resumo.vencidos)} description="A_VENCER com data anterior a hoje." tone="danger" icon={AlertTriangle} />
        <SummaryCard title="Vencem hoje" value={formatCurrency(resumo.vencemHoje)} description="Recebíveis aprovados para a data atual." tone="warning" icon={CalendarDays} />
        <SummaryCard title="Vencem até o fechamento do mês" value={formatCurrency(resumo.fechamentoMes)} description="Recebíveis até o fim do mês corrente." tone="warning" icon={CalendarClock} />
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_150px_170px_160px_160px_160px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por cliente, proposta, pagamento, OS ou documento"
            />
          </label>

          <select value={empresa} onChange={(event) => setEmpresa(event.target.value)} className={filterClass}>
            <option value="TODAS">Todas</option>
            <option value="Ideal Grafica">Ideal</option>
            <option value="Ideal Biro">Birô</option>
            <option value="E3 Brindes">E3</option>
          </select>

          <select value={tipo} onChange={(event) => setTipo(event.target.value as TipoFilter)} className={filterClass}>
            <option value="TODOS">Todos tipos</option>
            <option value="PIX">PIX</option>
            <option value="BOLETO">Boleto</option>
            <option value="CREDIT_CARD">Cartão</option>
            <option value="CARD_PARCELADO">Cartão parcelado</option>
            <option value="E-FATURADO">Faturado</option>
            <option value="DEPOSITO">Depósito</option>
            <option value="OUTRO_RECEBIVEL">Outro recebível</option>
          </select>

          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            <option value="A_VENCER">A vencer</option>
            <option value="PAID">Pago</option>
            <option value="CANCELADO">Cancelado</option>
            <option value="VENCIDO">Vencido visual</option>
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
              setStatus("A_VENCER");
              setDataInicial(firstDayOfMonth);
              setDataFinal(lastDayOfMonth);
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
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
          onConfirm={confirmRecebimento}
          onCancel={cancelRecebivel}
          onCopy={copyLinhaDigitavel}
          onPdf={openPdf}
          onProrrogar={prorrogarBoleto}
          onDetail={setDetailItem}
          onNavigate={(path) => router.push(path)}
        />
      ) : null}

      {activeTab === "VENCIMENTOS" ? <VencimentosTab items={filteredRecebiveis} /> : null}
      {activeTab === "CARTOES" ? <CartoesFaturadoTab items={filteredRecebiveis} /> : null}
      {activeTab === "PREVISAO" ? <PrevisaoCaixaTab items={filteredRecebiveis} boletos={filteredBoletos} /> : null}

      <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        Contas a Receber é a carteira financeira de vencimentos e previsão. A criação e conferência da cobrança permanecem no módulo Cobranças.
      </section>

      {detailItem ? <RecebivelDetailModal item={detailItem} onClose={() => setDetailItem(null)} /> : null}
    </div>
  );
}

function CarteiraTab({
  items,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onDetail,
  onNavigate
}: {
  items: RecebivelMock[];
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onDetail: (item: RecebivelMock) => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <ResponsiveList<RecebivelMock>
      items={items}
      getKey={(item) => item.id}
      emptyTitle="Nenhum recebível encontrado"
      emptyDescription="Ajuste os filtros para localizar recebíveis na carteira financeira."
      columns={[
        { header: "ID pagamento", cell: (item) => <strong className="text-slate-950">{item.id_pagamento}</strong> },
        { header: "Proposta / OS Ideal", cell: (item) => <div><p>#{item.id_int}</p><p className="text-xs text-slate-500">{item.os_ideal}</p></div> },
        { header: "Cliente", cell: (item) => <div><p className="font-medium text-slate-900">{item.cliente}</p><p className="text-xs text-slate-500">{item.documento}</p></div> },
        { header: "Empresa", cell: (item) => item.empresa },
        { header: "Tipo", cell: (item) => getTipoRecebivelLabel(item.tipo) },
        { header: "Status", cell: (item) => <StatusBadge status={getVisualStatus(item)} tone={getVisualStatusTone(item)} />, align: "center" },
        { header: "Valor", cell: (item) => formatCurrency(item.valor_atualizado ?? item.valor), align: "right" },
        { header: "Vencimento", cell: (item) => formatLocalDate(item.vencimento), align: "center" },
        { header: "Confirmado", cell: (item) => <StatusBadge status={item.confirmado ? "CONFIRMADO" : "NAO_CONFIRMADO"} tone={item.confirmado ? "success" : "neutral"} />, align: "center" },
        { header: "Ações", cell: (item) => <RecebivelActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} />, align: "right" }
      ]}
      renderCard={(item) => <RecebivelCard key={item.id} item={item} actions={<RecebivelActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onDetail={onDetail} onNavigate={onNavigate} label="Mais" />} />}
    />
  );
}

function BoletosDepositosTab({
  items,
  onConfirm,
  onCancel,
  onCopy,
  onPdf,
  onProrrogar,
  onDetail,
  onNavigate
}: {
  items: BoletoDepositoMock[];
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onProrrogar: (id: string) => void;
  onDetail: (item: BoletoDepositoMock) => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <ResponsiveList<BoletoDepositoMock>
      items={items}
      getKey={(item) => item.id}
      emptyTitle="Nenhum boleto ou depósito encontrado"
      emptyDescription="Ajuste os filtros para localizar boletos, depósitos ou outros recebíveis."
      columns={[
        { header: "ID", cell: (item) => <strong className="text-slate-950">{item.id_pagamento}</strong> },
        { header: "Proposta / OS Ideal", cell: (item) => <div><p>#{item.id_int}</p><p className="text-xs text-slate-500">{item.os_ideal}</p></div> },
        { header: "Parcela", cell: (item) => item.parcela ? `${item.parcela}/${item.total_parcelas ?? item.parcela}` : "-", align: "center" },
        { header: "Cliente", cell: (item) => item.cliente },
        { header: "Empresa", cell: (item) => item.empresa },
        { header: "Tipo", cell: (item) => getTipoRecebivelLabel(item.tipo) },
        { header: "Vencimento", cell: (item) => formatLocalDate(item.vencimento), align: "center" },
        { header: "Valor", cell: (item) => formatCurrency(item.valor_atualizado ?? item.valor), align: "right" },
        { header: "Status", cell: (item) => <StatusBadge status={getVisualStatus(item)} tone={getVisualStatusTone(item)} />, align: "center" },
        { header: "Linha / Referência", cell: (item) => item.linha_digitavel ?? item.referencia ?? "-" },
        { header: "Ações", cell: (item) => <BoletoActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onProrrogar={onProrrogar} onDetail={onDetail} onNavigate={onNavigate} />, align: "right" }
      ]}
      renderCard={(item) => <RecebivelCard key={item.id} item={item} actions={<BoletoActions item={item} onConfirm={onConfirm} onCancel={onCancel} onCopy={onCopy} onPdf={onPdf} onProrrogar={onProrrogar} onDetail={onDetail} onNavigate={onNavigate} label="Mais" />} />}
    />
  );
}

function VencimentosTab({ items }: { items: RecebivelMock[] }) {
  const groups = [
    { title: "Vencidos", items: items.filter((item) => isVisualVencido(item)), tone: "danger" as const },
    { title: "Vencem hoje", items: items.filter((item) => isCarteiraAberta(item) && item.vencimento === today), tone: "warning" as const },
    { title: "Próximos 7 dias", items: items.filter((item) => isCarteiraAberta(item) && isWithinDays(item.vencimento, 7)), tone: "info" as const },
    { title: "Próximos 30 dias", items: items.filter((item) => isCarteiraAberta(item) && isWithinDays(item.vencimento, 30)), tone: "neutral" as const }
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

function CartoesFaturadoTab({ items }: { items: RecebivelMock[] }) {
  const filtered = items.filter((item) => item.tipo === "CREDIT_CARD" || item.tipo === "CARD_PARCELADO" || item.tipo === "E-FATURADO");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {filtered.map((item) => (
        <article key={item.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.id_pagamento}</p>
              <h3 className="mt-2 font-semibold text-slate-950">{item.cliente}</h3>
              <p className="mt-1 text-sm text-slate-500">#{item.id_int} • {item.os_ideal} • {getTipoRecebivelLabel(item.tipo)}</p>
            </div>
            <StatusBadge status={getVisualStatus(item)} tone={getVisualStatusTone(item)} />
          </div>
          <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <p>Valor: <strong className="text-slate-900">{formatCurrency(item.valor)}</strong></p>
            <p>Vencimento: {formatLocalDate(item.vencimento)}</p>
            <p>Confirmado: {item.confirmado ? "Sim" : "Não"}</p>
            <p>Empresa: {item.empresa}</p>
          </div>
          <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{item.observacao}</p>
        </article>
      ))}
    </div>
  );
}

function PrevisaoCaixaTab({ items, boletos }: { items: RecebivelMock[]; boletos: BoletoDepositoMock[] }) {
  const previsaoItems = items.filter((item) => isCarteiraAberta(item) && !isVencido(item.vencimento));
  const weekly = groupByWeek(previsaoItems);
  const byEmpresa = groupByEmpresa(previsaoItems);
  const recebido = items.filter((item) => item.status === "PAID").reduce((total, item) => total + item.valor, 0);
  const aReceber = previsaoItems.reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0);
  const vencidos = items.filter((item) => isVisualVencido(item)).reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="rounded-2xl bg-sky-50 p-3 text-sky-700"><TrendingUp className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Previsão por semana</h2>
            <p className="text-sm text-slate-500">Agrupamento mockado por vencimento.</p>
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
        <MiniResumo title="Recebidos x a receber" rows={[["Recebido", recebido], ["A receber", aReceber], ["Vencidos", vencidos]]} />
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
  item: RecebivelMock;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onCopy: (value?: string) => void;
  onPdf: (url?: string) => void;
  onDetail: (item: RecebivelMock) => void;
  onNavigate: (path: string) => void;
  label?: string;
}) {
  return (
    <ActionsMenu
      label={label}
      items={[
        { label: "Ver recebível", onClick: () => onDetail(item) },
        { label: "Abrir proposta", onClick: () => onNavigate(`/orcamentos/${item.id_int}`) },
        { label: "Ver cliente", onClick: () => onNavigate(`/cadastros/${item.id_cliente}`) },
        { label: "Ver boletos vinculados", disabled: item.tipo !== "BOLETO" && item.tipo !== "E-FATURADO", onClick: () => onPdf(item.url_pdf) },
        { label: "Copiar linha digitável", disabled: !item.linha_digitavel, onClick: () => void onCopy(item.linha_digitavel) },
        { label: "Abrir PDF mockado", disabled: !item.url_pdf, onClick: () => onPdf(item.url_pdf) },
        { label: "Confirmar recebimento mockado", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onConfirm(item.id) },
        { label: "Ver histórico", onClick: () => onDetail(item) },
        { label: "Cancelar recebível mockado", destructive: true, disabled: item.status === "CANCELADO", onClick: () => onCancel(item.id) }
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
        { label: "Ver detalhe", onClick: () => onDetail(item) },
        { label: "Abrir proposta", onClick: () => onNavigate(`/orcamentos/${item.id_int}`) },
        { label: "Copiar linha digitável", disabled: item.tipo !== "BOLETO" || !item.linha_digitavel, onClick: () => void onCopy(item.linha_digitavel) },
        { label: "Abrir PDF mockado", disabled: !item.url_pdf, onClick: () => onPdf(item.url_pdf) },
        { label: "Confirmar recebimento", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onConfirm(item.id) },
        { label: "Prorrogar vencimento mockado", disabled: item.status === "PAID" || item.status === "CANCELADO", onClick: () => onProrrogar(item.id) },
        { label: "Cancelar mockado", destructive: true, disabled: item.status === "CANCELADO", onClick: () => onCancel(item.id) }
      ]}
    />
  );
}

function RecebivelCard({ item, actions }: { item: RecebivelMock | BoletoDepositoMock; actions: ReactNode }) {
  return (
    <article className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.id_pagamento}</p>
          <h3 className="mt-2 font-semibold text-slate-950">{item.cliente}</h3>
          <p className="mt-1 text-sm text-slate-500">#{item.id_int} • {item.os_ideal} • {item.empresa}</p>
        </div>
        <StatusBadge status={getVisualStatus(item)} tone={getVisualStatusTone(item)} />
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-600">
        <p>Tipo: {getTipoRecebivelLabel(item.tipo)}</p>
        <p>Valor: <strong className="text-slate-900">{formatCurrency(item.valor_atualizado ?? item.valor)}</strong></p>
        <p>Vencimento: {formatLocalDate(item.vencimento)}</p>
        <p>Confirmado: {item.confirmado ? "Sim" : "Não"}</p>
      </div>
      <div className="mt-4 flex justify-end">{actions}</div>
    </article>
  );
}

function MiniRecebivel({ item }: { item: RecebivelMock }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">{item.cliente}</p>
          <p className="text-sm text-slate-500">{item.id_pagamento} • {getTipoRecebivelLabel(item.tipo)}</p>
        </div>
        <strong className="text-right text-slate-950">{formatCurrency(item.valor_atualizado ?? item.valor)}</strong>
      </div>
      <p className="mt-2 text-xs text-slate-500">Vencimento {formatLocalDate(item.vencimento)} • {item.empresa}</p>
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
  onClose
}: {
  item: RecebivelMock | BoletoDepositoMock;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Detalhe mockado</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">{item.id_pagamento}</h2>
            <p className="mt-1 text-sm text-slate-500">{item.cliente} • #{item.id_int} • {item.os_ideal}</p>
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
          <DetailField label="Tipo" value={getTipoRecebivelLabel(item.tipo)} />
          <DetailField label="Status visual" value={humanizeLocalStatus(getVisualStatus(item))} />
          <DetailField label="Status financeiro" value={humanizeLocalStatus(item.status)} />
          <DetailField label="Valor" value={formatCurrency(item.valor_atualizado ?? item.valor)} />
          <DetailField label="Vencimento" value={formatLocalDate(item.vencimento)} />
          <DetailField label="Confirmado" value={item.confirmado ? "Sim" : "Não"} />
          <DetailField label="Documento" value={item.documento} />
          <DetailField label="Parcela" value={item.parcela ? `${item.parcela}/${item.total_parcelas ?? item.parcela}` : "-"} />
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observação</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{item.observacao}</p>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          Histórico mockado: registro listado para conferência da carteira financeira. Nenhum backend, banco, C6, n8n ou Supabase foi acionado.
        </div>
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

function matchesFilters(
  item: RecebivelMock | BoletoDepositoMock,
  filters: { search: string; empresa: string; tipo: TipoFilter; status: StatusFilter; dataInicial: string; dataFinal: string },
  options: { includeAReceber: boolean }
) {
  const normalizedSearch = normalize(filters.search);
  const haystack = normalize(`${item.cliente} ${item.id_int} ${item.id_pagamento} ${item.os_ideal} ${item.documento}`);
  const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
  const matchesEmpresa = filters.empresa === "TODAS" || item.empresa === filters.empresa;
  const matchesTipo = filters.tipo === "TODOS" || item.tipo === filters.tipo;
  const matchesStatus = matchesStatusFilter(item, filters.status);
  const matchesPeriodo = isDateInRange(item.vencimento, filters.dataInicial, filters.dataFinal);
  const matchesCarteira = options.includeAReceber || item.status !== "A_RECEBER";

  return matchesSearch && matchesEmpresa && matchesTipo && matchesStatus && matchesPeriodo && matchesCarteira;
}

function matchesStatusFilter(item: RecebivelMock | BoletoDepositoMock, status: StatusFilter) {
  if (status === "TODOS") return true;
  if (status === "VENCIDO") return isVisualVencido(item);
  if (status === "A_VENCER") return item.status === "A_VENCER";
  return item.status === status;
}

function buildResumo(recebiveis: RecebivelMock[]) {
  const abertos = recebiveis.filter(isCarteiraAberta);
  return {
    vencemHoje: abertos.filter((item) => item.vencimento === today).reduce((total, item) => total + item.valor, 0),
    aVencer: abertos.filter((item) => !isVencido(item.vencimento)).reduce((total, item) => total + item.valor, 0),
    vencidos: abertos.filter((item) => isVencido(item.vencimento)).reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0),
    fechamentoMes: abertos.filter((item) => item.vencimento >= today && item.vencimento <= lastDayOfMonth).reduce((total, item) => total + item.valor, 0)
  };
}

function groupByWeek(items: RecebivelMock[]) {
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
        const diff = diffDays(item.vencimento);
        return diff >= row.start && diff <= row.end;
      })
      .reduce((total, item) => total + (item.valor_atualizado ?? item.valor), 0)
  }));
}

function groupByEmpresa(items: RecebivelMock[]) {
  return ["Ideal Grafica", "Ideal Biro", "E3 Brindes"].map((empresa) => ({
    empresa,
    total: items.filter((item) => item.empresa === empresa).reduce((sum, item) => sum + (item.valor_atualizado ?? item.valor), 0)
  }));
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getVisualStatus(item: RecebivelMock | BoletoDepositoMock): StatusFilter {
  if (isVisualVencido(item)) return "VENCIDO";
  if (item.status === "A_RECEBER") return "TODOS";
  return item.status;
}

function getVisualStatusTone(item: RecebivelMock | BoletoDepositoMock) {
  if (isVisualVencido(item)) return "danger";
  if (item.status === "PAID") return "success";
  if (item.status === "A_VENCER") return "warning";
  return "neutral";
}

function humanizeLocalStatus(status: string) {
  const labels: Record<string, string> = {
    A_RECEBER: "A receber",
    A_VENCER: "A vencer",
    PAID: "Pago",
    CANCELADO: "Cancelado",
    VENCIDO: "Vencido"
  };

  return labels[status] ?? status;
}

function formatLocalDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function isCarteiraAberta(item: RecebivelMock | BoletoDepositoMock) {
  return item.status === "A_VENCER";
}

function isVisualVencido(item: RecebivelMock | BoletoDepositoMock) {
  return item.status === "A_VENCER" && isVencido(item.vencimento);
}

function isDateInRange(value: string, start: string, end: string) {
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

function isVencido(vencimento: string) {
  return vencimento < today;
}

function isWithinDays(vencimento: string, days: number) {
  const diff = diffDays(vencimento);
  return diff >= 0 && diff <= days;
}

function diffDays(vencimento: string) {
  const base = new Date(`${today}T00:00:00-03:00`).getTime();
  const target = new Date(`${vencimento}T00:00:00-03:00`).getTime();
  return Math.round((target - base) / 86400000);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00-03:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
