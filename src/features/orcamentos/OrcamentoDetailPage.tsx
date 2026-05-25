"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, CreditCard, FileText, Package, Truck } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { PropostaCobrancaPanel } from "@/features/cobrancas/PropostaCobrancaPanel";
import { getLiberacaoPedidoLabel, getLiberacaoPedidoStatus } from "@/features/cobrancas/cobrancas-utils";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import type { Proposta, PropostaStatus } from "@/features/orcamentos/types";
import { buildPropostaInformalText, getCobrancaLabel } from "@/features/orcamentos/orcamento-utils";

type OrcamentoDetailPageProps = {
  proposta: Proposta;
};

export function OrcamentoDetailPage({ proposta }: OrcamentoDetailPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { getCobrancasByProposta } = useCobrancas();
  const [isCobrancaModalOpen, setIsCobrancaModalOpen] = useState(false);
  const freteEscolhido = proposta.fretes.find((frete) => frete.id === proposta.freteEscolhidoId);
  const cobrancasDaProposta = getCobrancasByProposta(proposta.id_int);
  const cobrancasAtivas = cobrancasDaProposta.filter((item) => item.status !== "CANCELADO");
  const totalCobradoMock = cobrancasAtivas.reduce((total, item) => total + (item.cartao_valor_final ?? item.valor), 0);
  const liberacaoFinanceira = getLiberacaoPedidoLabel(getLiberacaoPedidoStatus(cobrancasDaProposta));
  const informalText = buildPropostaInformalText({
    id_int: proposta.id_int,
    clienteNome: proposta.cliente.nome,
    itens: proposta.itens,
    frete: freteEscolhido,
    resumo: proposta.resumo,
    formaPagamento: proposta.formaPagamento
  });

  async function copyInformal() {
    await navigator.clipboard?.writeText(informalText);
    showToast({ type: "success", title: "Resumo copiado", description: "Proposta informal copiada para WhatsApp." });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orcamentos" className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-3 py-2 text-sm font-semibold text-[#0b2f4a] shadow-sm transition hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Voltar para orcamentos
        </Link>
      </div>

      <PageHeader
        title={`Proposta #${proposta.id_int}`}
        subtitle={`${proposta.cliente.nome} - ${proposta.empresa} - ${formatDate(proposta.data)}`}
        context="Detalhe da proposta"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCobrancaModalOpen(true)}
              className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
            >
              Gerar cobrança
            </button>
            <StatusBadge status={proposta.status} tone={getStatusTone(proposta.status)} />
            <ActionsMenu
              items={[
                { label: "Editar proposta", onClick: () => router.push(`/orcamentos/${proposta.id_int}/editar`) },
                { label: "Duplicar proposta", onClick: () => showToast({ type: "info", title: "Duplicar proposta", description: "Acao mockada." }) },
                { label: "Copiar proposta informal", onClick: () => void copyInformal() },
                { label: "Gerar PDF mockado", onClick: () => showToast({ type: "success", title: "PDF mockado gerado com sucesso." }) },
                { label: "Gerar cobranca", onClick: () => setIsCobrancaModalOpen(true) },
                { label: "Ver financeiro", onClick: () => router.push("/cobrancas") },
                { label: "Cancelar proposta", destructive: true, onClick: () => showToast({ type: "warning", title: "Cancelamento mockado", description: "Nenhuma proposta real foi cancelada." }) }
              ]}
            />
          </div>
        }
      />

      {proposta.cliente.restricao ? (
        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-800">
          <h2 className="font-semibold">Cliente com restricao</h2>
          <p className="mt-1 text-sm">Revise credito, documento e observacoes antes de gerar cobranca ou aprovar esta proposta.</p>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Subtotal produtos" value={formatCurrency(proposta.resumo.subtotalProdutos)} description="Soma mockada dos itens da proposta." tone="info" icon={Package} />
        <SummaryCard title="Frete escolhido" value={formatCurrency(proposta.resumo.frete)} description={freteEscolhido ? `${freteEscolhido.transportadora} - ${freteEscolhido.prazo}` : "Frete nao definido."} tone="warning" icon={Truck} />
        <SummaryCard title="Total final" value={formatCurrency(proposta.resumo.valorTotal)} description={`Pagamento: ${proposta.formaPagamento}.`} tone="success" icon={FileText} />
        <SummaryCard
          title="Cobranças"
          value={cobrancasAtivas.length ? `${cobrancasAtivas.length} gerada(s)` : getCobrancaLabel(proposta.cobrancaStatus)}
          description={
            cobrancasAtivas.length
              ? `${formatCurrency(totalCobradoMock)} no mock • ${liberacaoFinanceira}.`
              : "Criação principal acontece dentro desta proposta; conferência fica no módulo financeiro."
          }
          tone="neutral"
          icon={CreditCard}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <DetailCard title="Cliente, contato e entrega">
            <div className="grid gap-3 md:grid-cols-2">
              <InfoBox label="Cliente" value={`${proposta.cliente.nome} (#${proposta.cliente.idCliente})`} detail={proposta.cliente.documento} />
              <InfoBox label="Contato responsavel" value={proposta.contato.nome} detail={`${proposta.contato.whatsapp} - ${proposta.contato.email}`} />
              <InfoBox label="Endereco de entrega" value={`${proposta.enderecoEntrega.endereco}, ${proposta.enderecoEntrega.numero}`} detail={`${proposta.enderecoEntrega.cidade}/${proposta.enderecoEntrega.uf} - CEP ${proposta.enderecoEntrega.cep}`} />
              <InfoBox label="Comprador / autorizado" value={proposta.compradorAutorizado?.nome ?? "Cliente principal"} detail={proposta.compradorAutorizado?.tipoRelacao ?? "Sem vinculo comercial selecionado"} />
            </div>
          </DetailCard>

          <DetailCard title="Produtos da proposta">
            <div className="space-y-4">
              {proposta.itens.map((item) => (
                <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 lg:grid-cols-[1fr_110px_130px_130px] lg:items-start">
                    <div>
                      <p className="font-semibold text-slate-950">#{item.id_produto} - {item.nome}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.formato} | {item.descricaoModelo}</p>
                    </div>
                    <InfoPill label="Qtd." value={item.quantidade.toLocaleString("pt-BR")} />
                    <InfoPill label="Prazo" value={item.prazo} />
                    <InfoPill label="Subtotal" value={formatCurrency(item.subtotal)} />
                  </div>
                  {item.variacoesEscolhidas.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.variacoesEscolhidas.map((escolha) => (
                        <span key={escolha.id} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                          {escolha.variacao.nome}: {escolha.tipo.variacao} (+{formatCurrency(escolha.tipo.v_extra)} / {escolha.tipo.peso}g)
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </DetailCard>

          <DetailCard title="Fretes disponiveis">
            <div className="grid gap-3 md:grid-cols-2">
              {proposta.fretes.map((frete) => (
                <div key={frete.id} className={`rounded-3xl border p-4 ${frete.escolhido ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{frete.transportadora}</p>
                      <p className="text-sm text-slate-500">{frete.servico} - {frete.prazo}</p>
                    </div>
                    {frete.escolhido ? <StatusBadge status="ESCOLHIDO" tone="success" /> : null}
                  </div>
                  <p className="mt-3 text-lg font-bold text-slate-950">{formatCurrency(frete.valor)}</p>
                  <p className="mt-1 text-sm text-slate-500">{frete.observacao}</p>
                </div>
              ))}
            </div>
          </DetailCard>
        </div>

        <div className="space-y-6">
          <DetailCard title="Resumo de valores">
            <ResumoValores proposta={proposta} />
          </DetailCard>

          <DetailCard title="Proposta informal">
            <textarea readOnly value={informalText} className="min-h-72 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 outline-none" />
            <button type="button" onClick={copyInformal} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white">
              <Copy className="h-4 w-4" />
              Copiar resumo para WhatsApp
            </button>
          </DetailCard>

        </div>
      </section>

      <PropostaCobrancaPanel
        proposta={proposta}
        isModalOpen={isCobrancaModalOpen}
        onOpenModal={() => setIsCobrancaModalOpen(true)}
        onCloseModal={() => setIsCobrancaModalOpen(false)}
      />
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoBox({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ResumoValores({ proposta }: { proposta: Proposta }) {
  const rows = [
    ["Subtotal produtos", formatCurrency(proposta.resumo.subtotalProdutos)],
    ["Descontos individuais", `-${formatCurrency(proposta.resumo.descontosIndividuais)}`],
    ["Acréscimo tabela especial", `+${formatCurrency(proposta.resumo.acrescimoBonus)}`],
    ["Desconto geral", `-${formatCurrency(proposta.resumo.descontoGeral)}`],
    ["Frete", formatCurrency(proposta.resumo.frete)],
    ["Peso total", `${proposta.resumo.pesoTotal.toLocaleString("pt-BR")}g`],
    ["Prazo producao", proposta.resumo.prazoProducao],
    ["Prazo entrega", proposta.resumo.prazoEntrega]
  ];

  return (
    <div className="space-y-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-slate-500">{label}</span>
          <strong className="text-right text-slate-900">{value}</strong>
        </div>
      ))}
      <div className="border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-slate-600">Total final</span>
          <strong className="text-xl text-slate-950">{formatCurrency(proposta.resumo.valorTotal)}</strong>
        </div>
      </div>
    </div>
  );
}

function getStatusTone(status: PropostaStatus) {
  if (status === "APROVADO") return "success";
  if (status === "AGUARDANDO") return "warning";
  if (status === "CANCELADO") return "neutral";
  return "info";
}
