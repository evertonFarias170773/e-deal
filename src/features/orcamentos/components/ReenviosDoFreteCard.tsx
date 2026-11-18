"use client";

/**
 * REENVIOS NA ABA FRETES (18/11/2026), so leitura.
 *
 * O reenvio de pedido devolvido NAO muda o frete da proposta nem a nota: a aba
 * Fretes continua travada para troca, com o frete do primeiro envio. Sem este
 * quadro o pedido pareceria seguir no envio original (ex.: SEDEX) depois de
 * reenviado por transportadora. Uma linha por ciclo: "Reenvio N:
 * <transportadora> R$ X, cobrança: <modo> R$ Y". A cobranca e o PIX ficam na
 * aba Pagamentos.
 *
 * Fica FORA do fieldset da aba (o bloqueio por cobranca nao se aplica a uma
 * leitura). Sem ciclo, nao aparece.
 */
import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import { ROTULO_MODO_COBRANCA, type SituacaoCicloReenvio } from "@/features/expedicao/lib/reenvio";
import { lerSituacaoDosReenvios } from "@/features/expedicao/services/reenvio.client";

const ROTULO_TIPO: Record<string, string> = {
  CORREIOS: "Correios",
  TRANSPORTADORA: "Transportadora",
  MOTOBOY: "Motoboy"
};

/** "Transportadora São Miguel", ou o tipo de envio quando o ciclo nao cotou. */
export function envioDoCiclo(c: Pick<SituacaoCicloReenvio, "transportadora" | "tipoFreteNovo">): string {
  if (c.transportadora) return c.transportadora;
  const tipo = String(c.tipoFreteNovo ?? "").toUpperCase();
  return ROTULO_TIPO[tipo] ?? (tipo || "envio");
}

export function ReenviosDoFreteCard({ idInt }: { idInt: number }) {
  const [ciclos, setCiclos] = useState<SituacaoCicloReenvio[]>([]);

  useEffect(() => {
    let vivo = true;
    void lerSituacaoDosReenvios(idInt).then((lista) => {
      if (vivo) setCiclos(lista);
    });
    return () => {
      vivo = false;
    };
  }, [idInt]);

  if (ciclos.length === 0) return null;

  return (
    <div className="mb-6 space-y-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">
      <p className="flex items-center gap-2 font-semibold">
        <Truck className="h-4 w-4" /> Pedido reenviado
      </p>
      {ciclos.map((c) => (
        <p key={c.chave}>
          Reenvio {c.ciclo}: {envioDoCiclo(c)}
          {c.freteNovo !== null ? ` ${formatCurrency(c.freteNovo)}` : ""}, cobrança: {ROTULO_MODO_COBRANCA[c.modoCobranca]}{" "}
          {formatCurrency(c.valorCobrar)}
        </p>
      ))}
      <p className="text-xs text-violet-800 dark:text-violet-200">
        O frete desta aba e a nota continuam os do primeiro envio; o reenvio não os muda. A cobrança do frete do reenvio fica na aba Pagamentos.
      </p>
    </div>
  );
}
