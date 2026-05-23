"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CreditCard, FileText, Search, WalletCards } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import { propostasMock, statusPropostaOptions, vendedoresPropostaMock } from "@/lib/mocks/propostas.mock";
import type { Proposta, PropostaStatus } from "@/features/orcamentos/types";
import { buildPropostaInformalText, getCobrancaLabel } from "@/features/orcamentos/orcamento-utils";

type StatusFilter = "TODOS" | PropostaStatus;

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function propostaMatchesSearch(proposta: Proposta, search: string) {
  const normalizedSearch = normalize(search.trim());

  if (!normalizedSearch) {
    return true;
  }

  return normalize(`${proposta.id_int} ${proposta.cliente.nome} ${proposta.cliente.documento}`).includes(normalizedSearch);
}

export function OrcamentosListPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [empresa, setEmpresa] = useState("TODAS");
  const [vendedor, setVendedor] = useState("TODOS");
  const [periodo, setPeriodo] = useState("TODOS");

  const filteredPropostas = useMemo(() => {
    return propostasMock.filter((proposta) => {
      const matchesSearch = propostaMatchesSearch(proposta, search);
      const matchesStatus = status === "TODOS" || proposta.status === status;
      const matchesEmpresa = empresa === "TODAS" || proposta.empresa === empresa;
      const matchesVendedor = vendedor === "TODOS" || proposta.vendedor === vendedor;
      const matchesPeriodo = periodo === "TODOS" || proposta.data.startsWith(periodo);

      return matchesSearch && matchesStatus && matchesEmpresa && matchesVendedor && matchesPeriodo;
    });
  }, [empresa, periodo, search, status, vendedor]);

  const totalAberto = propostasMock
    .filter((proposta) => proposta.status === "NOVO" || proposta.status === "AGUARDANDO")
    .reduce((total, proposta) => total + proposta.resumo.valorTotal, 0);
  const totalAprovado = propostasMock
    .filter((proposta) => proposta.status === "APROVADO")
    .reduce((total, proposta) => total + proposta.resumo.valorTotal, 0);
  const aguardando = propostasMock.filter((proposta) => proposta.status === "AGUARDANDO").length;

  function showMockAction(title: string) {
    showToast({
      type: "info",
      title,
      description: "Acao mockada para validacao visual. Nenhum backend real foi acionado."
    });
  }

  async function copyInformal(proposta: Proposta) {
    const frete = proposta.fretes.find((item) => item.id === proposta.freteEscolhidoId);
    const text = buildPropostaInformalText({
      id_int: proposta.id_int,
      clienteNome: proposta.cliente.nome,
      itens: proposta.itens,
      frete,
      resumo: proposta.resumo,
      formaPagamento: proposta.formaPagamento
    });

    await navigator.clipboard?.writeText(text);
    showToast({ type: "success", title: "Resumo copiado", description: "Proposta informal copiada para WhatsApp." });
  }

  function getActions(proposta: Proposta) {
    return [
      { label: "Ver proposta", onClick: () => router.push(`/orcamentos/${proposta.id_int}`) },
      { label: "Editar proposta", onClick: () => router.push(`/orcamentos/${proposta.id_int}/editar`) },
      { label: "Duplicar proposta", onClick: () => showMockAction("Duplicar proposta") },
      { label: "Copiar proposta informal", onClick: () => void copyInformal(proposta) },
      { label: "Gerar PDF mockado", onClick: () => showToast({ type: "success", title: "PDF mockado gerado com sucesso." }) },
      { label: "Gerar cobranca", onClick: () => router.push(`/cobrancas/nova?id_int=${proposta.id_int}`) },
      { label: "Ver financeiro", onClick: () => router.push("/cobrancas") },
      { label: "Cancelar proposta", destructive: true, onClick: () => showMockAction("Cancelar proposta") }
    ];
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orcamentos"
        subtitle="Monte e acompanhe propostas comerciais com cliente, produtos, frete, resumo e cobranca mockada."
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

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Em aberto" value={formatCurrency(totalAberto)} description="Propostas novas ou aguardando retorno." tone="info" icon={FileText} />
        <SummaryCard title="Aprovadas" value={formatCurrency(totalAprovado)} description="Valor comercial aprovado no mock." tone="success" icon={WalletCards} />
        <SummaryCard title="Aguardando" value={aguardando.toString()} description="Propostas com cobranca ou aprovacao pendente." tone="warning" icon={CreditCard} />
      </section>

      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_170px_170px_170px_150px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por proposta, cliente ou documento"
            />
          </label>

          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className={filterClass}>
            <option value="TODOS">Todos status</option>
            {statusPropostaOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>

          <select value={empresa} onChange={(event) => setEmpresa(event.target.value)} className={filterClass}>
            <option value="TODAS">Todas empresas</option>
            {mockCompanies.filter((company) => !company.isConsolidated).map((company) => (
              <option key={company.id} value={company.name}>{company.shortName}</option>
            ))}
          </select>

          <select value={vendedor} onChange={(event) => setVendedor(event.target.value)} className={filterClass}>
            <option value="TODOS">Todos vendedores</option>
            {vendedoresPropostaMock.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>

          <select value={periodo} onChange={(event) => setPeriodo(event.target.value)} className={filterClass}>
            <option value="TODOS">Todo periodo</option>
            <option value="2026-05">Maio/2026</option>
            <option value="2026-04">Abril/2026</option>
          </select>

          <button type="button" onClick={() => { setSearch(""); setStatus("TODOS"); setEmpresa("TODAS"); setVendedor("TODOS"); setPeriodo("TODOS"); }} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            Limpar filtros
          </button>
        </div>
      </section>

      <ResponsiveList<Proposta>
        items={filteredPropostas}
        getKey={(proposta) => proposta.id}
        emptyTitle="Nenhuma proposta encontrada"
        emptyDescription="Ajuste os filtros ou crie uma nova proposta para comecar."
        columns={[
          { header: "No proposta", cell: (proposta) => <span className="font-semibold text-slate-950">#{proposta.id_int}</span> },
          {
            header: "Cliente",
            cell: (proposta) => (
              <div>
                <p className="font-medium text-slate-900">{proposta.cliente.nome}</p>
                <p className="text-xs text-slate-500">{proposta.cliente.documento}</p>
              </div>
            )
          },
          { header: "Empresa", cell: (proposta) => proposta.empresa },
          { header: "Vendedor", cell: (proposta) => proposta.vendedor },
          { header: "Data", cell: (proposta) => formatDate(proposta.data), align: "center" },
          { header: "Status", cell: (proposta) => <StatusBadge status={proposta.status} tone={getStatusTone(proposta.status)} />, align: "center" },
          { header: "Valor total", cell: (proposta) => formatCurrency(proposta.resumo.valorTotal), align: "right" },
          { header: "Cobranca", cell: (proposta) => getCobrancaLabel(proposta.cobrancaStatus), align: "center" },
          { header: "Acoes", cell: (proposta) => <ActionsMenu items={getActions(proposta)} />, align: "right" }
        ]}
        renderCard={(proposta) => (
          <article key={proposta.id} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">#{proposta.id_int}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{proposta.cliente.nome}</h3>
                <p className="mt-1 text-sm text-slate-500">{proposta.empresa} - {proposta.vendedor}</p>
              </div>
              <StatusBadge status={proposta.status} tone={getStatusTone(proposta.status)} />
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Data: {formatDate(proposta.data)}</p>
              <p>Cobranca: {getCobrancaLabel(proposta.cobrancaStatus)}</p>
              <p className="font-semibold text-slate-900">Total: {formatCurrency(proposta.resumo.valorTotal)}</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <button type="button" onClick={() => router.push(`/orcamentos/${proposta.id_int}`)} className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white">
                Ver
              </button>
              <ActionsMenu label="Mais" items={getActions(proposta).filter((item) => item.label !== "Ver proposta")} />
            </div>
          </article>
        )}
      />
    </div>
  );
}

function getStatusTone(status: PropostaStatus) {
  if (status === "APROVADO") return "success";
  if (status === "AGUARDANDO") return "warning";
  if (status === "CANCELADO") return "neutral";
  return "info";
}

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";
