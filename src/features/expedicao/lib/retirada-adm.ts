/**
 * RETIRADA NO BALCAO DECIDIDA PELO ADM (21/10/2026) — "Cliente vai retirar no balcao".
 *
 * Pedido CIF (a modalidade vem travada do orcamento) que o cliente decidiu buscar.
 * A aba Fretes nao serve: com NF-e autorizada a troca de modalidade e barrada, e
 * RETIRA zera o frete (`valorFreteEfetivo`). Aqui a retirada e decidida NO DESPACHO,
 * e a proposta nao muda: frete, total, modalidade e nota ficam como estao.
 *
 * O despacho grava em `expedicoes`: tipo_frete RETIRA_BALCAO, "Retira balcao",
 * transportadora vazia e modalidade_frete CIF (quem pagou o frete continua sendo
 * a empresa). Na proposta, so `status_interno` -> A RETIRAR, com a trilha em
 * `os_status_log` (motivo `MOTIVO_RETIRADA_ADM`). Depois, o fluxo de retirada de
 * sempre: aguardando retirada e "Confirmar retirada" ate ENTREGUE.
 *
 * QUEM PODE: so ADM pelo cadastro ve a opcao. E o despacho so sai com a liberacao
 * "Liberar despacho (ADM)" que ja existe (`expedicao.admin`, conferida no banco,
 * vale para um despacho): com CIF + RETIRA_BALCAO a trava de frete
 * (`trg_exp_trava_frete_despacho`) ve o transporte mudar e bloqueia ate a
 * liberacao. Quando a cotacao do pedido nao e de um tipo que a trava reconhece
 * (ex.: "Frete Incluso") ela nao bloqueia, e a exigencia vale pela tela e pelo
 * `despachar` (liberacao ativa lida antes de gravar).
 *
 * Sem imports de proposito: roda no navegador e no teste do Node, igual.
 */

export const MOTIVO_RETIRADA_ADM = "cliente retira no balcão";

export const MENSAGEM_RETIRADA_PRECISA_LIBERAR =
  "Despacho como retirada no balcão precisa da liberação de um ADM: use \"Liberar despacho (ADM)\" neste despacho.";

/** A opcao aparece? So ADM pelo cadastro, so com a modalidade travada em CIF, so no despacho (nao na edicao). */
export function podeOferecerRetiradaAdm(entrada: {
  ehAdmNoCadastro: boolean;
  modalidadeInicial: string | null | undefined;
  modoEdicao: boolean;
}): boolean {
  return entrada.ehAdmNoCadastro && !entrada.modoEdicao && entrada.modalidadeInicial === "CIF";
}

/** O tipo de entrega do despacho: RETIRA (como sempre) ou CIF com a retirada do ADM marcada. */
export function tipoEntregaDoDespacho(
  modalidade: string | null | undefined,
  retiradaAdmMarcada: boolean
): "TRANSPORTE" | "RETIRADA" {
  if (modalidade === "RETIRA") return "RETIRADA";
  return retiradaAdmMarcada && modalidade === "CIF" ? "RETIRADA" : "TRANSPORTE";
}

/**
 * A retirada do ADM esta liberada? Pela trava (LIBERADO_ADM, a liberacao que ela vai
 * consumir) ou, quando a trava nao avalia o caso, por uma liberacao ativa no banco.
 */
export function retiradaAdmLiberada(entrada: {
  situacaoDaTrava: string | null | undefined;
  temLiberacaoAtiva: boolean;
}): boolean {
  return entrada.situacaoDaTrava === "LIBERADO_ADM" || entrada.temLiberacaoAtiva;
}
