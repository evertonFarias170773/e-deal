/**
 * ORIGEM DO FRETE ESCOLHIDO (21/10/2026) — card calculado x frete manual.
 *
 * `cotacao_frete.origem` (migration 20261021_cotacao_frete_origem):
 *   - COTACAO: card que veio de uma cotacao (SEDEX, VEPPO, Sao Miguel, Azul...).
 *     E CIF calculado: a transportadora e o "Valor cobrado" ficam SO LEITURA, com
 *     o valor do card. Para mudar, escolhe-se outro card ou "Atualizar fretes".
 *   - MANUAL: frete criado pelo dropdown de transportadora sem card (`manual_...`,
 *     "Cadastro manual"). Transportadora e valor seguem editaveis.
 *   - vazia: linha antiga, ou gravada por outra porta (n8n, Expedicao,
 *     complemento). Tratada como hoje, editavel, ate a primeira troca de frete
 *     pelo Salvar.
 *
 * A tela (aba Fretes) e o `saveProposta` usam ESTAS funcoes: os dois concordam.
 * Retira, FOB, avulsa, complemento e a Expedicao nao passam por aqui.
 *
 * Sem imports de proposito: roda no navegador e no teste do Node, igual.
 */

export const ORIGENS_FRETE = ["COTACAO", "MANUAL"] as const;
export type OrigemFrete = (typeof ORIGENS_FRETE)[number];

/** O minimo de um frete que estas regras leem (o `PropostaFrete` da tela). */
export type FreteComOrigem = {
  id: string;
  valor: number;
  observacao?: string | null;
  origem?: OrigemFrete | null;
  /** O valor que a cotacao trouxe. So existe em card COTACAO. */
  valorCotado?: number | null;
  /**
   * A transportadora que o proprio card vincula (`resolverTransportadoraParceira`),
   * carimbada na escolha; na releitura, a gravada na proposta. `undefined` = nao se
   * sabe (nao confere).
   */
  idTransportadoraCotada?: number | null;
};

export const MENSAGEM_VALOR_DO_CARD =
  "O valor cobrado de um frete calculado é o valor do card. Para mudar, escolha outro card ou use \"Atualizar fretes\".";
export const MENSAGEM_TRANSPORTADORA_DO_CARD =
  "A transportadora de um frete calculado é a do card. Para mudar, escolha outro card ou use \"Atualizar fretes\".";

/** Frete manual: o que o dropdown cria (`manual_...`, "Cadastro manual") ou o gravado MANUAL. */
export function ehFreteManual(frete: Pick<FreteComOrigem, "id" | "observacao" | "origem"> | null | undefined): boolean {
  if (!frete) return false;
  return frete.origem === "MANUAL" || frete.id.startsWith("manual_") || frete.observacao === "Cadastro manual";
}

/** Cards que acabaram de vir de uma cotacao: origem COTACAO e o valor cotado guardado. */
export function marcarComoCotacao<T extends { valor: number }>(fretes: readonly T[]): (T & { origem: OrigemFrete; valorCotado: number })[] {
  return fretes.map((f) => ({ ...f, origem: "COTACAO" as const, valorCotado: f.valor }));
}

/** O card escolhido trava a transportadora e o "Valor cobrado"? So o COTACAO. */
export function freteTravadoPeloCard(frete: Pick<FreteComOrigem, "id" | "observacao" | "origem"> | null | undefined): boolean {
  return Boolean(frete) && frete!.origem === "COTACAO" && !ehFreteManual(frete);
}

/**
 * O que o Salvar grava em `cotacao_frete.origem`. Fora de CIF (RETIRA, FOB), em
 * avulsa e sem frete: nulo. Frete antigo sem origem continua sem origem.
 */
export function origemParaGravar(
  frete: Pick<FreteComOrigem, "id" | "observacao" | "origem"> | null | undefined,
  contexto: { modalidade: string | null; isAvulso: boolean }
): OrigemFrete | null {
  if (!frete || contexto.isAvulso || contexto.modalidade === "RETIRA" || contexto.modalidade === "FOB") return null;
  if (ehFreteManual(frete)) return "MANUAL";
  return frete.origem === "COTACAO" ? "COTACAO" : null;
}

/** A mesma regra, no Salvar: valor ou transportadora diferentes do card COTACAO. */
export function recusaDoFreteCalculado(
  frete: FreteComOrigem | null | undefined,
  idTransportadoraDaProposta: number | null | undefined
): string | null {
  if (!frete || !freteTravadoPeloCard(frete)) return null;
  if (typeof frete.valorCotado === "number" && Math.abs(Number(frete.valor) - frete.valorCotado) > 0.005) {
    return MENSAGEM_VALOR_DO_CARD;
  }
  if (frete.idTransportadoraCotada !== undefined && (idTransportadoraDaProposta ?? null) !== (frete.idTransportadoraCotada ?? null)) {
    return MENSAGEM_TRANSPORTADORA_DO_CARD;
  }
  return null;
}
