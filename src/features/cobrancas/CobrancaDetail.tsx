"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, FileText, Link2, Wallet } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CobrancaActionsMenu } from "@/features/cobrancas/CobrancaActionsMenu";
import { CobrancaHistoricoPanel } from "@/features/cobrancas/CobrancaHistoricoPanel";
import { CobrancaResumoCard } from "@/features/cobrancas/CobrancaResumoCard";
import { CobrancaStatusBadge } from "@/features/cobrancas/CobrancaStatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import {
  canLiberarParaPedido,
  getCobrancaStatusDescription,
  getLiberacaoPedidoLabel,
  getLiberacaoPedidoStatus,
  getLiberacaoPedidoTone,
  getTipoCobrancaLabel,
  isCreditoPendente,
  isCobrancaVencida,
  isPropostaLiberadaParaPedido
} from "@/features/cobrancas/cobrancas-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";

type CobrancaDetailProps = {
  cobrancaId: string;
};

export function CobrancaDetail({ cobrancaId }: CobrancaDetailProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { getCobrancaById, confirmPagamento, cancelCobranca, getCobrancasByProposta, liberarParaPedido } = useCobrancas();
  const cobranca = getCobrancaById(cobrancaId) as NonNullable<ReturnType<typeof getCobrancaById>>;

  if (!cobranca) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Detalhe da cobrança</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Cobrança não encontrada</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          O identificador informado não existe no estado mockado atual. Volte para a lista e gere uma nova cobrança.
        </p>
      </div>
    );
  }

  const cobrancaAtual = cobranca;
  const cobrancasDaProposta = getCobrancasByProposta(cobrancaAtual.id_int);
  const liberacaoStatus = getLiberacaoPedidoStatus(cobrancasDaProposta);
  const propostaLiberada = isPropostaLiberadaParaPedido(cobrancasDaProposta);
  const podeLiberarParaPedido = canLiberarParaPedido(cobrancasDaProposta);

  async function copyValue(value: string | undefined, successTitle: string) {
    if (!value) {
      return;
    }

    await navigator.clipboard?.writeText(value);
    showToast({ type: "success", title: successTitle });
  }

  function handleConfirm() {
    confirmPagamento(cobrancaAtual.id);
    showToast({ type: "success", title: "Pagamento confirmado no mock." });
  }

  function handleCancel() {
    const confirmed = window.confirm("Cancelar cobrança mockada? Nenhum backend real será acionado.");

    if (!confirmed) {
      return;
    }

    cancelCobranca(cobrancaAtual.id, "Cancelamento mockado solicitado a partir do detalhe.");
    showToast({ type: "warning", title: "Cobrança cancelada no mock." });
  }

  function handleLiberarPedido() {
    const liberou = liberarParaPedido(cobrancaAtual.id_int);
    showToast({
      type: liberou ? "success" : "warning",
      title: liberou ? "Proposta liberada para pedido no mock." : "Ainda não é possível liberar para pedido."
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/cobrancas" className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-3 py-2 text-sm font-semibold text-[#0b2f4a] shadow-sm transition hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Voltar para cobranças
        </Link>
      </div>

      <PageHeader
        title={cobrancaAtual.id_pagamento}
        subtitle={`Proposta #${cobrancaAtual.id_int} • ${cobrancaAtual.cliente} • ${getTipoCobrancaLabel(cobrancaAtual.tipo_cobranca)}`}
        context="Detalhe da cobrança"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <CobrancaStatusBadge cobranca={cobrancaAtual} showConfirmed />
            <CobrancaActionsMenu cobranca={cobrancaAtual} />
          </div>
        }
      />

      {isCobrancaVencida(cobrancaAtual) ? (
        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-800">
          <h2 className="font-semibold">Cobrança vencida no mock</h2>
          <p className="mt-1 text-sm">Esta cobrança continua aberta e o vencimento já passou. Use isso como referência visual para alertas futuros do financeiro.</p>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CobrancaResumoCard
          title="Valor principal"
          value={formatCurrency(cobranca.valor)}
          description="Valor base salvo no registro mockado."
          tone="info"
          icon={Wallet}
        />
        <CobrancaResumoCard
          title="Valor final"
          value={formatCurrency(cobranca.cartao_valor_final ?? cobranca.valor)}
          description={cobranca.cartao_valor_final ? "Inclui taxa simulada do cartão parcelado." : "Sem taxa adicional mockada."}
          tone="success"
          icon={CreditCard}
        />
        <CobrancaResumoCard
          title="Situação"
          value={getCobrancaStatusDescription(cobranca)}
          description={cobranca.vencimento ? `Vencimento ${formatDate(cobranca.vencimento)}.` : "Cobrança sem vencimento definido."}
          tone="warning"
          icon={FileText}
        />
        <CobrancaResumoCard
          title="Página pública"
          value={cobranca.token_publico ?? "Sem token"}
          description="Token mockado para visualização pública."
          tone="neutral"
          icon={Link2}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <DetailCard title="Dados da proposta">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <InfoBox label="id_int" value={`#${cobranca.proposta.id_int}`} detail={`Status da proposta: ${cobranca.proposta.statusProposta}`} />
              <InfoBox label="OS Ideal" value={cobranca.os_ideal} detail="Campo temporário usado enquanto o sistema antigo roda em paralelo." />
              <InfoBox label="Valor total" value={formatCurrency(cobranca.proposta.valorTotal)} detail={`Pendente ${formatCurrency(cobranca.proposta.valorPendente)}`} />
              <InfoBox label="Empresa da proposta" value={cobranca.proposta.empresaProposta} detail={`Vendedor: ${cobranca.proposta.vendedor}`} />
              <InfoBox label="Frete" value={formatCurrency(cobranca.proposta.valorFrete)} detail="Valor herdado visualmente da proposta." />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">{cobranca.proposta.descricao}</p>
            <div className="mt-4">
              <StatusBadge status={getLiberacaoPedidoLabel(liberacaoStatus)} tone={getLiberacaoPedidoTone(liberacaoStatus)} />
            </div>
          </DetailCard>

          <DetailCard title="Cliente e cobrança">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <InfoBox label="Cliente" value={cobranca.cliente} detail={`ID cliente ${cobranca.id_cliente}`} />
              <InfoBox label="Documento" value={cobranca.documento} detail="CPF/CNPJ herdado da proposta." />
              <InfoBox label="Empresa recebedora" value={cobranca.empresa} detail="Empresa herdada da proposta para o fluxo financeiro." />
              <InfoBox label="Tipo de cobrança" value={getTipoCobrancaLabel(cobranca.tipo_cobranca)} detail={cobranca.atendente} />
              <InfoBox label="Valor" value={formatCurrency(cobranca.valor)} detail={`Criada em ${formatDate(cobranca.created_at)}`} />
              <InfoBox label="Vencimento" value={cobranca.vencimento ? formatDate(cobranca.vencimento) : "Sem vencimento"} detail={cobranca.paid_at ? `Pago em ${formatDate(cobranca.paid_at)}` : "Pagamento ainda não confirmado."} />
              <InfoBox label="Status" value={cobranca.status} detail={cobranca.confirmado ? "Confirmado" : "Não confirmado"} />
              <InfoBox label="Saldo pendente" value={formatCurrency(cobranca.saldo_pendente ?? 0)} detail="Preparado para cenários futuros de parcial." />
              <InfoBox label="Condição" value={cobranca.condicao_pagamento ?? "Não informada"} detail="Condição comercial definida pelo vendedor dentro da proposta." />
              <InfoBox label="Crédito pendente" value={isCreditoPendente(cobranca) ? "Sim" : "Não"} detail="Usado pelo financeiro para análise de faturado." />
            </div>
          </DetailCard>

          <DetailCard title="Links, documentos e campos específicos">
            <div className="grid gap-3 md:grid-cols-2">
              <InfoBox label="Token público" value={cobranca.token_publico ?? "Não gerado"} detail="A mesma cobrança pode ser aberta em página pública mockada." />
              <InfoBox label="URL pública" value={cobranca.url_cobranca ?? "Não gerada"} />
              <InfoBox label="PIX copia e cola" value={cobranca.pix_copia_cola ?? "Não se aplica"} />
              <InfoBox label="Linha digitável" value={cobranca.linha_digitavel ?? "Não se aplica"} />
              <InfoBox label="PDF mockado" value={cobranca.url_pdf ?? "Não se aplica"} />
              <InfoBox label="Checkout mockado" value={cobranca.cartao_checkout_url ?? "Não se aplica"} detail={cobranca.cartao_checkout_id ?? "Sem checkout"} />
            </div>

            {cobranca.tipo_cobranca === "CARD_PARCELADO" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <InfoBox label="Parcelas" value={`${cobranca.cartao_parcelas ?? 0}x`} />
                <InfoBox label="Taxa percentual" value={`${(cobranca.cartao_taxa_percentual ?? 0).toFixed(1)}%`} />
                <InfoBox label="Valor da taxa" value={formatCurrency(cobranca.cartao_valor_taxa ?? 0)} />
                <InfoBox label="Valor final" value={formatCurrency(cobranca.cartao_valor_final ?? cobranca.valor)} />
              </div>
            ) : null}

            {cobranca.tipo_cobranca === "BOLETO" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <InfoBox label="Multa" value={`${(cobranca.multaPercentual ?? 0).toFixed(1)}%`} />
                <InfoBox label="Juros" value={`${(cobranca.jurosPercentual ?? 0).toFixed(1)}%`} />
                <InfoBox label="Erro/retorno" value={cobranca.erro_pagamento ?? "Sem erro mockado"} />
                <InfoBox label="Motivo de cancelamento" value={cobranca.motivo_cancela ?? "Sem cancelamento"} />
              </div>
            ) : null}

            {cobranca.tipo_cobranca === "E-FATURADO" && cobranca.creditoAnalise ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <InfoBox label="Limite" value={formatCurrency(cobranca.creditoAnalise.limite)} />
                <InfoBox label="Utilizado" value={formatCurrency(cobranca.creditoAnalise.utilizado)} />
                <InfoBox label="Disponível" value={formatCurrency(cobranca.creditoAnalise.disponivel)} />
                <InfoBox label="Risco" value={cobranca.creditoAnalise.risco} />
                <InfoBox label="Análise" value={cobranca.creditoAnalise.statusAnalise} detail={cobranca.creditoAnalise.mensagem} />
              </div>
            ) : null}
          </DetailCard>

          <DetailCard title="Histórico mockado">
            <CobrancaHistoricoPanel cobranca={cobranca} />
          </DetailCard>
        </div>

        <div className="space-y-6">
          <DetailCard title="Ações disponíveis">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => router.push(`/pagamento/${cobranca.token_publico}`)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
              >
                Abrir página pública mockada
              </button>
              {cobranca.pix_copia_cola ? (
                <button
                  type="button"
                  onClick={() => void copyValue(cobranca.pix_copia_cola, "PIX copiado.")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Copiar PIX
                </button>
              ) : null}
              {cobranca.linha_digitavel ? (
                <button
                  type="button"
                  onClick={() => void copyValue(cobranca.linha_digitavel, "Linha digitável copiada.")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Copiar linha digitável
                </button>
              ) : null}
              {cobranca.status !== "PAID" && cobranca.status !== "CANCELADO" ? (
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="w-full rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white"
                >
                  Confirmar pagamento mockado
                </button>
              ) : null}
              {propostaLiberada ? (
                <button
                  type="button"
                  disabled
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  Pedido ainda não criado no mock
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLiberarPedido}
                  disabled={!podeLiberarParaPedido}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  Liberar para pedido
                </button>
              )}
              {cobranca.status !== "CANCELADO" ? (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
                >
                  Cancelar cobrança
                </button>
              ) : null}
            </div>
          </DetailCard>
        </div>
      </section>
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

function InfoBox({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}
