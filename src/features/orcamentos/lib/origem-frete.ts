/**
 * ORIGEM DO FRETE ESCOLHIDO (21/10/2026) — card calculado x frete manual.
 *
 * `cotacao_frete.origem` (migration 20261021_cotacao_frete_origem):
 *   - COTACAO: card que veio de uma cotacao (SEDEX, VEPPO, Sao Miguel, Azul...).
 *     E CIF calculado: o "Valor cobrado" fica SO LEITURA, com
 *     o valor do card. A lista de transportadora segue aberta (22/10/2026): e a
 *     porta do frete manual, que substitui o card.
 *   - MANUAL: frete criado pelo dropdown de transportadora sem card (`manual_...`,
 *     "Cadastro manual"). Transportadora e valor seguem editaveis.
 *   - vazia: linha antiga, ou gravada por outra porta (n8n, Expedicao,
 *     complemento). Tratada como hoje, editavel, ate a primeira troca de frete
 *     pelo Salvar.
 *
 * A tela (aba Fretes) e o `saveProposta` usam ESTAS funcoes: os dois concordam.
 * Retira, FOB, avulsa, complemento e a Expedicao nao passam por aqui.
 *
 * EXCECAO DO MOTOBOY INTERNO (27/10/2026): com a transportadora 997 escolhida
 * (TRANSPORTADORAS_PARCEIRAS.MOTOBOY, sempre pelo id), o "Valor cobrado" do card
 * calculado fica editavel para todos e o Salvar grava o digitado. A transportadora
 * continua a do card. As demais transportadoras seguem a regra acima.
 *
 * O unico import e o mapa de ids das parceiras, que tambem nao importa nada:
 * roda no navegador e no teste do Node, igual.
 */

import { TRANSPORTADORAS_PARCEIRAS } from "@/features/orcamentos/lib/transportadoras-parceiras";

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
  /**
   * O "Valor cobrado" do card do motoboy interno (997) foi digitado pelo usuario
   * (27/10/2026). So vive no estado da tela; no banco e `propostas.frete_valor_digitado`.
   */
  valorDigitado?: boolean;
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

/**
 * Transportadora cujo "Valor cobrado" e livre mesmo com card calculado: so o
 * motoboy interno (997). Pelo id, nunca pelo nome.
 */
export function valorCobradoLivreNaTransportadora(idTransportadora: number | null | undefined): boolean {
  return idTransportadora !== null && idTransportadora !== undefined && Number(idTransportadora) === TRANSPORTADORAS_PARCEIRAS.MOTOBOY;
}

/**
 * O "Valor cobrado" fica so leitura? Card calculado trava, exceto quando a
 * transportadora escolhida e a 997 E o card e dela (carimbo ausente = nao se sabe,
 * vale a da proposta). Frete manual e antigo nunca travam.
 */
export function valorTravadoPeloCard(
  frete: Pick<FreteComOrigem, "id" | "observacao" | "origem" | "idTransportadoraCotada"> | null | undefined,
  idTransportadoraDaProposta: number | null | undefined,
  /** `clientes.pode_editar_frete` do cliente da proposta (27/10/2026): libera qualquer card. */
  clientePodeEditarFrete: boolean = false
): boolean {
  if (!freteTravadoPeloCard(frete)) return false;
  if (clientePodeEditarFrete === true) return false;
  if (!valorCobradoLivreNaTransportadora(idTransportadoraDaProposta)) return true;
  return frete!.idTransportadoraCotada !== undefined && !valorCobradoLivreNaTransportadora(frete!.idTransportadoraCotada);
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
  idTransportadoraDaProposta: number | null | undefined,
  /** Lido do BANCO pelo Salvar (cadastro relido), nunca do que a tela mandou. */
  clientePodeEditarFrete: boolean = false
): string | null {
  if (!frete || !freteTravadoPeloCard(frete)) return null;
  // Motoboy interno (997) ou cliente com "Pode editar valor do frete": o valor
  // digitado vale; a transportadora segue conferida.
  if (valorTravadoPeloCard(frete, idTransportadoraDaProposta, clientePodeEditarFrete) && typeof frete.valorCotado === "number" && Math.abs(Number(frete.valor) - frete.valorCotado) > 0.005) {
    return MENSAGEM_VALOR_DO_CARD;
  }
  if (frete.idTransportadoraCotada !== undefined && (idTransportadoraDaProposta ?? null) !== (frete.idTransportadoraCotada ?? null)) {
    return MENSAGEM_TRANSPORTADORA_DO_CARD;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * VALOR DIGITADO DO MOTOBOY INTERNO (27/10/2026) — `propostas.frete_valor_digitado`.
 *
 * Vale tambem para o cliente com "Pode editar valor do frete"
 * (`clientes.pode_editar_frete`, 27/10/2026): qualquer card calculado, valor 0
 * incluido, com as mesmas regras de descarte.
 *
 * O valor que o usuario digita no card do 997 sobrevive a recotacao automatica
 * (mudanca de item, peso ou cidade): ela atualiza so o valor cotado de referencia.
 * "Atualizar fretes" e ato explicito: volta ao cotado e limpa a marca. Trocar de
 * card ou de transportadora, ou o motoboy deixar de ser cotado, tambem limpam.
 * --------------------------------------------------------------------------- */

const DIFERENCA_DE_CENTAVO = 0.005;

/**
 * O card escolhido e calculado e o valor dele esta liberado (997 na proposta com o
 * card dela, ou cliente com "Pode editar valor do frete")? So nele a marca vale.
 */
export function valorDoCardLiberado(
  frete: Pick<FreteComOrigem, "id" | "observacao" | "origem" | "idTransportadoraCotada"> | null | undefined,
  idTransportadoraDaProposta: number | null | undefined,
  clientePodeEditarFrete: boolean = false
): boolean {
  return Boolean(frete) && freteTravadoPeloCard(frete) && !valorTravadoPeloCard(frete, idTransportadoraDaProposta, clientePodeEditarFrete);
}

/** Nome antigo (so o 997), mantido para quem ja chamava. */
export function ehCardDoMotoboyInterno(
  frete: Pick<FreteComOrigem, "id" | "observacao" | "origem" | "idTransportadoraCotada"> | null | undefined,
  idTransportadoraDaProposta: number | null | undefined
): boolean {
  return valorDoCardLiberado(frete, idTransportadoraDaProposta, false);
}

/**
 * O usuario digitou `valor` no "Valor cobrado". No card do 997 a marca acende
 * quando o digitado difere do cotado (digitar o proprio cotado apaga); nos
 * outros fretes a marca nao existe.
 */
export function aplicarValorDigitado<T extends FreteComOrigem>(
  frete: T,
  valor: number,
  idTransportadoraDaProposta: number | null | undefined,
  clientePodeEditarFrete: boolean = false
): T {
  if (!valorDoCardLiberado(frete, idTransportadoraDaProposta, clientePodeEditarFrete)) return { ...frete, valor, valorDigitado: false };
  const cotado = typeof frete.valorCotado === "number" ? frete.valorCotado : null;
  const digitado = cotado === null ? true : Math.abs(valor - cotado) > DIFERENCA_DE_CENTAVO;
  return { ...frete, valor, valorDigitado: digitado };
}

/**
 * Recotacao AUTOMATICA achou o card novo equivalente ao escolhido. Com a marca no
 * card do 997, fica o valor digitado e so o cotado se atualiza; sem a marca (ou
 * fora do 997), vale o card novo, sem marca — a regra de antes.
 */
export function recotacaoAutomaticaDoEscolhido<T extends FreteComOrigem>(
  anterior: FreteComOrigem,
  novo: T,
  idTransportadoraDaProposta: number | null | undefined,
  clientePodeEditarFrete: boolean = false
): T {
  if (anterior.valorDigitado === true && valorDoCardLiberado(anterior, idTransportadoraDaProposta, clientePodeEditarFrete)) {
    return {
      ...novo,
      valor: anterior.valor,
      valorCotado: novo.valor,
      valorDigitado: true,
      idTransportadoraCotada: anterior.idTransportadoraCotada
    };
  }
  return { ...novo, valorDigitado: false };
}

/**
 * O escolhido nao veio na recotacao (motoboy fora da faixa, por exemplo) e e
 * preservado como sempre. O digitado nao fica as cegas: volta ao ultimo cotado
 * conhecido e a marca apaga.
 */
export function preservadoSemCotacao<T extends FreteComOrigem>(frete: T): T {
  if (frete.valorDigitado !== true) return frete;
  return { ...frete, valor: typeof frete.valorCotado === "number" ? frete.valorCotado : frete.valor, valorDigitado: false };
}

/**
 * Troca de card ou de transportadora: o card que deixa de ser o escolhido perde a
 * marca e volta ao cotado, para nao reaparecer com o digitado se for escolhido de novo.
 */
export function limparValorDigitadoForaDe<T extends FreteComOrigem>(fretes: readonly T[], idEscolhido: string | null | undefined): T[] {
  return fretes.map((f) =>
    f.valorDigitado === true && f.id !== idEscolhido
      ? { ...f, valor: typeof f.valorCotado === "number" ? f.valorCotado : f.valor, valorDigitado: false }
      : f
  );
}

/** "Atualizar fretes" (explicito) e card trocado: sem marca em lugar nenhum. */
export function semValorDigitado<T extends FreteComOrigem>(fretes: readonly T[]): T[] {
  return fretes.map((f) => (f.valorDigitado ? { ...f, valorDigitado: false } : f));
}

/**
 * O que o Salvar grava em `propostas.frete_valor_digitado`: `true` so com o valor
 * do card liberado (997 com o card dela, ou cliente com "Pode editar valor do
 * frete") e editado; em qualquer outro caso `null`.
 */
export function freteValorDigitadoParaGravar(
  frete: FreteComOrigem | null | undefined,
  contexto: {
    idTransportadora: number | null | undefined;
    modalidade: string | null;
    isAvulso: boolean;
    /** Lido do banco pelo Salvar. */
    clientePodeEditarFrete?: boolean;
  }
): true | null {
  if (!frete || contexto.isAvulso || contexto.modalidade === "RETIRA" || contexto.modalidade === "FOB") return null;
  return frete.valorDigitado === true && valorDoCardLiberado(frete, contexto.idTransportadora, contexto.clientePodeEditarFrete === true) ? true : null;
}

/**
 * Releitura do banco: com a marca gravada e o card do 997 escolhido, o valor
 * gravado e o digitado. O cotado de referencia nao se sabe ate a proxima cotacao
 * (`undefined`); a cotacao da abertura da aba o preenche.
 */
export function valorDigitadoRelido<T extends FreteComOrigem>(
  frete: T,
  marcaGravada: unknown,
  idTransportadoraDaProposta: number | null | undefined,
  clientePodeEditarFrete: boolean = false
): T {
  if (marcaGravada !== true || !valorDoCardLiberado(frete, idTransportadoraDaProposta, clientePodeEditarFrete)) return frete;
  return { ...frete, valorDigitado: true, valorCotado: undefined };
}

/** A cotacao da abertura da aba trouxe o card equivalente: so o cotado de referencia muda. */
export function atualizarCotadoDoDigitado<T extends FreteComOrigem>(frete: T, novo: Pick<FreteComOrigem, "valor">): T {
  return frete.valorDigitado === true ? { ...frete, valorCotado: novo.valor } : frete;
}
