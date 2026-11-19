"use client";

/**
 * ENVIO ATUAL DO PEDIDO REENVIADO, no alto da aba Fretes (18/11 e 19/11/2026).
 * So leitura.
 *
 * O reenvio de pedido devolvido NAO muda o frete da proposta (o da venda, que
 * esta no total e na NF): a aba continua com ele, agora marcado "Envio
 * original". Este destaque diz qual e o envio de agora: "Envio atual: reenvio
 * N, <transportadora>, R$ X; cobrança: <modo> R$ Y". Reenvios anteriores ficam
 * numa linha menor cada. A cobranca e o PIX ficam na aba Pagamentos.
 *
 * Os dados vem da pagina (`useReenviosDoPedido`), que tambem marca os cards.
 * Sem reenvio, nao aparece.
 */
import { Truck } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import { ROTULO_MODO_COBRANCA } from "@/features/expedicao/lib/reenvio";
import { envioDoReenvio, type ReenvioDaAbaFretes } from "../hooks/useReenviosDoPedido";

function linhaDoReenvio(r: ReenvioDaAbaFretes): string {
  const frete = r.freteNovo !== null ? `, ${formatCurrency(r.freteNovo)}` : "";
  return `reenvio ${r.ciclo}, ${envioDoReenvio(r)}${frete}; cobrança: ${ROTULO_MODO_COBRANCA[r.modoCobranca]} ${formatCurrency(r.valorCobrar)}`;
}

export function ReenviosDoFreteCard({ reenvios }: { reenvios: ReenvioDaAbaFretes[] }) {
  if (reenvios.length === 0) return null;
  const atual = reenvios[reenvios.length - 1];
  const anteriores = reenvios.slice(0, -1);

  return (
    <div
      data-testid="envio-atual-reenvio"
      className="mb-6 space-y-2 rounded-2xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-900 shadow-sm dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100"
    >
      <p className="flex items-start gap-2 text-base font-bold">
        <Truck className="mt-0.5 h-5 w-5 shrink-0" />
        <span>Envio atual: {linhaDoReenvio(atual)}</span>
      </p>
      {anteriores.map((r) => (
        <p key={r.ciclo} className="text-xs">
          Antes: {linhaDoReenvio(r)}
        </p>
      ))}
      <p className="text-xs text-violet-800 dark:text-violet-200">
        A cobrança do frete do reenvio fica na aba Pagamentos.
      </p>
    </div>
  );
}
