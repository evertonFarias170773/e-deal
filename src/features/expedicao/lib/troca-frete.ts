/**
 * DIFERENÇA DE FRETE DA TROCA DE TRANSPORTADORA COBRANDO (26/11/2026).
 *
 * Leitura do JSON de `exp_troca_frete_situacao(id_int)`: uma linha por troca
 * cobrando do pedido, com o valor da cobrança à parte, o que já foi pago, o
 * abono (se houver) e a cobrança viva. `pendente` é o que a trava de saldo usa
 * (`exp_saldo_despacho`, situação SALDO_TROCA_FRETE). Sem React, para o teste.
 */

import type { FormaCobrancaTroca } from "./abono-frete";

export type CobrancaVivaDaTroca = {
  id: string;
  idPagamento: string | null;
  status: string | null;
  valor: number;
  idEmpresa: number | null;
  tipo: FormaCobrancaTroca | null;
  temPix: boolean;
  urlCobranca: string | null;
};

export type SituacaoTrocaFrete = {
  id: number;
  transportadora: string;
  servico: string | null;
  freteCobrado: number;
  valorOpcao: number;
  valor: number;
  tipo: FormaCobrancaTroca | null;
  motivo: string | null;
  autor: string | null;
  aplicadoEm: string | null;
  abono: number | null;
  abonadoPor: string | null;
  abonoMotivo: string | null;
  pago: number;
  pendente: number;
  cobrancaViva: CobrancaVivaDaTroca | null;
};

const num = (v: unknown, padrao = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const forma = (v: unknown): FormaCobrancaTroca | null =>
  v === "PIX" || v === "BOLETO" || v === "CARD_PARCELADO" ? v : null;

export function lerSituacaoDasTrocas(bruto: unknown): SituacaoTrocaFrete[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
    .map((l) => {
      const viva = l.cobranca_viva && typeof l.cobranca_viva === "object" ? (l.cobranca_viva as Record<string, unknown>) : null;
      return {
        id: num(l.id),
        transportadora: txt(l.transportadora) ?? "outra transportadora",
        servico: txt(l.servico),
        freteCobrado: num(l.frete_cobrado),
        valorOpcao: num(l.valor_opcao),
        valor: num(l.valor),
        tipo: forma(l.tipo),
        motivo: txt(l.motivo),
        autor: txt(l.autor),
        aplicadoEm: txt(l.aplicado_em),
        abono: l.abono === null || l.abono === undefined ? null : num(l.abono),
        abonadoPor: txt(l.abonado_por),
        abonoMotivo: txt(l.abono_motivo),
        pago: num(l.pago),
        pendente: num(l.pendente),
        cobrancaViva: viva
          ? {
              id: String(viva.id ?? ""),
              idPagamento: txt(viva.id_pagamento),
              status: txt(viva.status),
              valor: num(viva.valor),
              idEmpresa: viva.id_empresa === null || viva.id_empresa === undefined ? null : num(viva.id_empresa),
              tipo: forma(viva.tipo_cobranca),
              temPix: viva.pix_copia_cola === true,
              urlCobranca: txt(viva.url_cobranca)
            }
          : null
      };
    })
    .filter((s) => s.id > 0);
}

/** A cobrança viva ainda precisa ser emitida (PIX sem QR, boleto sem PDF/link, cartão sem link)? */
export function cobrancaDaTrocaPrecisaEmitir(viva: CobrancaVivaDaTroca | null): boolean {
  if (!viva || viva.status === "PAID") return false;
  if (viva.tipo === "PIX") return !viva.temPix;
  return !viva.urlCobranca;
}

/** "EXP_TROCA_ABONO: ..." -> só o texto. */
export function textoDoErroDaTroca(mensagem: string | undefined): string {
  return String(mensagem ?? "").replace(/^.*?EXP_(?:TROCA|RECOT)_[A-Z_]+:\s*/, "").trim() || "Não foi possível concluir agora.";
}
