"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CreditCard, Search, ShieldCheck, Wallet, WalletCards } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CobrancaActionsMenu } from "@/features/cobrancas/CobrancaActionsMenu";
import { CobrancaResumoCard } from "@/features/cobrancas/CobrancaResumoCard";
import { CobrancaStatusBadge } from "@/features/cobrancas/CobrancaStatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import {
  cobrancaMatchesSearch,
  getLiberacaoPedidoLabel,
  getLiberacaoPedidoStatus,
  getLiberacaoPedidoTone,
  getTipoCobrancaLabel,
  isCreditoPendente
} from "@/features/cobrancas/cobrancas-utils";
import type { Cobranca } from "@/features/cobrancas/types";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { tiposCobrancaMock } from "@/lib/mocks/pagamentos.mock";

type StatusFilter = "TODOS" | Cobranca["status"];

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";

export function CobrancasList() {
  const router = useRouter();
  const { cobrancas } = useCobrancas();
  const [search, setSearch] = useState("");
  const [tipo, setTipo] = useState<"TODOS" | Cobranca["tipo_cobranca"]>("TODOS");
  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [empresa, setEmpresa] = useState("TODAS");
  const [periodo, setPeriodo] = useState("TODOS");

  const filtered = useMemo(() => {
    return cobrancas.filter((cobranca) => {
      const matchesSearch = cobrancaMatchesSearch(cobranca, search);
      const matchesTipo = tipo === "TODOS" || cobranca.tipo_cobranca === tipo;
      const matchesStatus = status === "TODOS" || cobranca.status === status;
      const matchesEmpresa = empresa === "TODAS" || cobranca.empresa === empresa;
      const periodSource = cobranca.vencimento ?? cobranca.created_at;
      const matchesPeriodo = periodo === "TODOS" || periodSource.startsWith(periodo);

      return matchesSearch && matchesTipo && matchesStatus && matchesEmpresa && matchesPeriodo;
    });
  }, [cobrancas, empresa, periodo, search, status, tipo]);

  const totalReceber = cobrancas
    .filter((item) => item.status === "A_RECEBER" || item.status === "A_VENCER")
    .reduce((total, item) => total + (item.cartao_valor_final ?? item.valor), 0);
  const totalPago = cobrancas
    .filter((item) => item.status === "PAID")
    .reduce((total, item) => total + (item.cartao_valor_final ?? item.valor), 0);
  const creditoPendente = cobrancas.filter((item) => isCreditoPendente(item)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conferência de cobranças"
        subtitle="Use esta lista para conferir cobranças geradas pelo vendedor, acompanhar status, analisar crédito e liberar propostas para pedido."
        context="Financeiro / Cobranças para conferência"
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CobrancaResumoCard
          title="Total a receber"
          value={formatCurrency(totalReceber)}
          description="Somatório mockado de cobranças abertas, futuras e parceladas."
          tone="info"
          icon={Wallet}
        />
        <CobrancaResumoCard
          title="Total pago"
          value={formatCurrency(totalPago)}
          description="Recebimentos já confirmados manualmente no mock."
          tone="success"
          icon={WalletCards}
        />
        <CobrancaResumoCard
          title="Confirmadas"
          value={cobrancas.filter((item) => item.confirmado).length.toString()}
          description="Cobranças confirmadas ou faturados já liberados."
          tone="warning"
          icon={CreditCard}
        />
        <CobrancaResumoCard
          title="Crédito pendente"
          value={creditoPendente.toString()}
          description="Solicitações de faturado aguardando análise do financeiro."
          tone="special"
          icon={ShieldCheck}
        />
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_180px_180px_180px_170px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por id_pagamento, id_int, cliente ou documento"
            />
          </label>

          <select value={tipo} onChange={(event) => setTipo(event.target.value as typeof tipo)} className={filterClass}>
            <option value="TODOS">Todos os tipos</option>
            {tiposCobrancaMock.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            <option value="A_RECEBER">A receber</option>
            <option value="A_VENCER">A vencer</option>
            <option value="PAID">Pago</option>
            <option value="CANCELADO">Cancelado</option>
          </select>

          <select value={empresa} onChange={(event) => setEmpresa(event.target.value)} className={filterClass}>
            <option value="TODAS">Todas empresas</option>
            <option value="Ideal Grafica">Ideal</option>
            <option value="Ideal Biro">Birô</option>
            <option value="E3 Brindes">E3</option>
          </select>

          <select value={periodo} onChange={(event) => setPeriodo(event.target.value)} className={filterClass}>
            <option value="TODOS">Todo período</option>
            <option value="2026-06">Junho/2026</option>
            <option value="2026-05">Maio/2026</option>
            <option value="2026-04">Abril/2026</option>
          </select>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setTipo("TODOS");
              setStatus("TODOS");
              setEmpresa("TODAS");
              setPeriodo("TODOS");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <ResponsiveList<Cobranca>
        items={filtered}
        getKey={(cobranca) => cobranca.id}
        emptyTitle="Nenhuma cobrança encontrada"
        emptyDescription="Nenhum resultado com os filtros atuais. Tente limpar os filtros ou criar a cobrança a partir da proposta."
        columns={[
          { header: "ID pagamento", cell: (cobranca) => <span className="font-semibold text-slate-950">{cobranca.id_pagamento}</span> },
          {
            header: "Proposta / OS Ideal",
            cell: (cobranca) => {
              const liberacao = getLiberacaoPedidoStatus(cobrancas.filter((item) => item.id_int === cobranca.id_int));
              return (
                <div>
                  <p className="font-medium text-slate-900">#{cobranca.id_int} • {cobranca.os_ideal}</p>
                  <div className="mt-1">
                    <StatusBadge status={getLiberacaoPedidoLabel(liberacao)} tone={getLiberacaoPedidoTone(liberacao)} />
                  </div>
                </div>
              );
            }
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
          { header: "Empresa", cell: (cobranca) => cobranca.empresa },
          { header: "Tipo de cobrança", cell: (cobranca) => getTipoCobrancaLabel(cobranca.tipo_cobranca) },
          { header: "Status", cell: (cobranca) => <CobrancaStatusBadge cobranca={cobranca} />, align: "center" },
          { header: "Valor", cell: (cobranca) => formatCurrency(cobranca.cartao_valor_final ?? cobranca.valor), align: "right" },
          {
            header: "Vencimento",
            cell: (cobranca) => (cobranca.vencimento ? formatDate(cobranca.vencimento) : "Sem vencimento"),
            align: "center"
          },
          {
            header: "Confirmado",
            cell: (cobranca) => (
              <StatusBadge status={cobranca.confirmado ? "CONFIRMADO" : "NAO_CONFIRMADO"} tone={cobranca.confirmado ? "success" : "neutral"} />
            ),
            align: "center"
          },
          { header: "Ações", cell: (cobranca) => <CobrancaActionsMenu cobranca={cobranca} />, align: "right" }
        ]}
        renderCard={(cobranca) => (
          <article key={cobranca.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{cobranca.id_pagamento}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{cobranca.cliente}</h3>
                <p className="mt-1 text-sm text-slate-500">Proposta #{cobranca.id_int} • {cobranca.os_ideal} • {cobranca.empresa}</p>
              </div>
              <CobrancaStatusBadge cobranca={cobranca} />
            </div>

            <div className="mt-4 grid gap-2 text-sm text-slate-600">
              <p>Tipo: {getTipoCobrancaLabel(cobranca.tipo_cobranca)}</p>
              <p>Valor: <strong className="text-slate-900">{formatCurrency(cobranca.cartao_valor_final ?? cobranca.valor)}</strong></p>
              <p>Vencimento: {cobranca.vencimento ? formatDate(cobranca.vencimento) : "Sem vencimento"}</p>
              <p>Confirmado: {cobranca.confirmado ? "Sim" : "Não"}</p>
              <p>
                Liberação:{" "}
                <strong className="text-slate-900">
                  {getLiberacaoPedidoLabel(getLiberacaoPedidoStatus(cobrancas.filter((item) => item.id_int === cobranca.id_int)))}
                </strong>
              </p>
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

      <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
        <div className="flex items-start gap-3">
          <CalendarDays className="mt-0.5 h-4 w-4 text-[#0f9f9a]" />
          <p>
            Este módulo usa apenas estado local mockado. A criação principal da cobrança acontece na proposta; aqui o financeiro confere, acompanha crédito e libera para pedido.
          </p>
        </div>
      </section>
    </div>
  );
}
