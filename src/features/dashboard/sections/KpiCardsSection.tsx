"use client";

import { useRouter } from "next/navigation";
import {
  Banknote,
  ClipboardList,
  Factory,
  Percent,
  ReceiptText,
  WalletCards
} from "lucide-react";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatRangeLabel, type DateRange } from "@/lib/period";
import { formatTrend, formatTrendPontos, taxaConversao } from "@/features/dashboard/utils/trend";
import type { DashboardExecutivoPayload } from "@/features/dashboard/types";

type KpiCardsSectionProps = {
  data: DashboardExecutivoPayload;
  range: DateRange;
};

/** Linha de KPIs executivos — todos com drill-down e tendência quando cabível. */
export function KpiCardsSection({ data, range }: KpiCardsSectionProps) {
  const router = useRouter();
  const rotulo = formatRangeLabel(range);

  const { comercial, financeiro, producao, fiscal } = data;

  const conversaoAtual = taxaConversao(comercial.ganho.atual.qtd, comercial.criadas.atual.qtd);
  const conversaoAnterior = taxaConversao(
    comercial.ganho.anterior.qtd,
    comercial.criadas.anterior.qtd
  );
  const trendConversao =
    conversaoAtual !== null && conversaoAnterior !== null
      ? formatTrendPontos(conversaoAtual, conversaoAnterior)
      : undefined;

  const trendFaturamento = formatTrend(
    financeiro.recebido.atual.valor,
    financeiro.recebido.anterior.valor
  );
  const trendPropostas = formatTrend(comercial.criadas.atual.qtd, comercial.criadas.anterior.qtd);

  const nfQtdAtual = fiscal.nfe.emitidas.atual.qtd + fiscal.nfse.emitidas.atual.qtd;
  const nfQtdAnterior = fiscal.nfe.emitidas.anterior.qtd + fiscal.nfse.emitidas.anterior.qtd;
  const nfValorAtual = fiscal.nfe.emitidas.atual.valor + fiscal.nfse.emitidas.atual.valor;
  const trendNf = formatTrend(nfQtdAtual, nfQtdAnterior);

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <SummaryCard
        title="Faturamento"
        value={formatCurrency(financeiro.recebido.atual.valor)}
        description={`${financeiro.recebido.atual.qtd} pagamento(s) confirmado(s) · ${rotulo}`}
        tone="success"
        trend={trendFaturamento?.label}
        trendTone={trendFaturamento?.tone}
        icon={Banknote}
        onClick={() => router.push("/cobrancas")}
      />
      <SummaryCard
        title="Contas a receber"
        value={formatCurrency(financeiro.carteira.total.valor)}
        description={`${financeiro.carteira.total.qtd} título(s) em aberto hoje`}
        tone="info"
        icon={WalletCards}
        onClick={() => router.push("/contas-a-receber")}
      />
      <SummaryCard
        title="Propostas criadas"
        value={String(comercial.criadas.atual.qtd)}
        description={`${formatCurrency(comercial.criadas.atual.valor)} em propostas · ${rotulo}`}
        tone="warning"
        trend={trendPropostas?.label}
        trendTone={trendPropostas?.tone}
        icon={ClipboardList}
        onClick={() => router.push("/orcamentos")}
      />
      <SummaryCard
        title="Conversão"
        value={
          conversaoAtual === null ? "—" : `${conversaoAtual.toFixed(1).replace(".", ",")}%`
        }
        description={
          conversaoAtual === null
            ? "Sem propostas criadas no período"
            : `${comercial.ganho.atual.qtd} de ${comercial.criadas.atual.qtd} propostas ganhas`
        }
        tone="special"
        trend={trendConversao?.label}
        trendTone={trendConversao?.tone}
        icon={Percent}
        onClick={() => router.push("/orcamentos")}
      />
      <SummaryCard
        title="OS em produção"
        value={String(producao.total)}
        description="Pedidos aprovados na esteira agora"
        tone="special"
        icon={Factory}
        onClick={() => router.push("/producao")}
      />
      <SummaryCard
        title="NF emitidas"
        value={String(nfQtdAtual)}
        description={`${formatCurrency(nfValorAtual)} · NFe ${fiscal.nfe.emitidas.atual.qtd} · NFSe ${fiscal.nfse.emitidas.atual.qtd}`}
        tone="neutral"
        trend={trendNf?.label}
        trendTone={trendNf?.tone}
        icon={ReceiptText}
        onClick={() => router.push("/notas-fiscais")}
      />
    </section>
  );
}
