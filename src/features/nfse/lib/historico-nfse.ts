/**
 * Histórico NFS-e (página Notas Fiscais) — o que a lista mostra de cada nota.
 *
 * Módulo puro (sem imports): o selo do ambiente, o filtro por ambiente, o status
 * exibido e o item "Cancelar NFS-e" do menu.
 *
 * POR QUE EXISTE (07/10/2026, antes de a Birô emitir em produção)
 *   - Nota de teste e nota com valor fiscal vão conviver na mesma lista: cada
 *     uma precisa dizer de qual ambiente é.
 *   - O cancelamento de NFS-e ainda não funciona pelo Vibe: o primeiro
 *     cancelamento é pelo portal nacional. O item fica à vista, desligado, para
 *     ninguém procurar por ele nem achar que cancelou.
 *   - Status que a tela não conhece (ERRO_AUTORIZACAO, RETORNO_FOCUS, o que
 *     vier) aparece como "Em análise", com o status real na dica, e nunca some
 *     da lista nem escapa do filtro.
 */

/* ---------------------------------------------------------------- ambiente */

export type AmbienteDaNfse = "producao" | "homologacao";

/**
 * O ambiente da nota. Só "producao" é produção; vazio, nulo ou qualquer outro
 * texto é HOMOLOGAÇÃO — o mesmo lado para onde o n8n cai quando não reconhece o
 * ambiente. Uma nota nunca é dita de produção por engano.
 */
export function ambienteDaNfse(valor: string | null | undefined): AmbienteDaNfse {
  return String(valor ?? "").trim().toLowerCase() === "producao" ? "producao" : "homologacao";
}

export function seloDoAmbiente(valor: string | null | undefined): { ambiente: AmbienteDaNfse; rotulo: string } {
  const ambiente = ambienteDaNfse(valor);
  return { ambiente, rotulo: ambiente === "producao" ? "PRODUÇÃO" : "HOMOLOGAÇÃO" };
}

/** Valores do filtro "Ambiente" (vazio = Todos). */
export const FILTRO_AMBIENTE_NFSE = ["", "producao", "homologacao"] as const;
export type FiltroAmbienteNfse = (typeof FILTRO_AMBIENTE_NFSE)[number];

export function notaPassaNoFiltroDeAmbiente(ambienteDaNota: string | null | undefined, filtro: string): boolean {
  if (filtro !== "producao" && filtro !== "homologacao") return true;
  return ambienteDaNfse(ambienteDaNota) === filtro;
}

/* ------------------------------------------------------------------ status */

/** O status que agrupa tudo o que a tela não conhece. */
export const STATUS_EM_ANALISE = "EM_ANALISE";

/** Os status que a lista conhece, com o texto do filtro. A ordem é a do filtro. */
export const STATUS_CONHECIDOS_NFSE: readonly { valor: string; rotulo: string }[] = [
  { valor: "PENDENTE", rotulo: "Pendente" },
  { valor: "PRONTA_PARA_ENVIO", rotulo: "Pronta para envio" },
  { valor: "PROCESSANDO", rotulo: "Processando" },
  { valor: "AUTORIZADA", rotulo: "Autorizada" },
  { valor: "ERRO_ENVIO", rotulo: "Erro de Envio" },
  { valor: "REJEITADA", rotulo: "Rejeitada" },
  { valor: "CANCELADA", rotulo: "Cancelada" }
];

/** Valores do filtro "Status" (vazio = Todos), com "Em análise" no fim. */
export const FILTRO_STATUS_NFSE = [
  "",
  "PENDENTE",
  "PRONTA_PARA_ENVIO",
  "PROCESSANDO",
  "AUTORIZADA",
  "ERRO_ENVIO",
  "REJEITADA",
  "CANCELADA",
  STATUS_EM_ANALISE
] as const;

export type StatusExibidoDaNfse = {
  /** O valor que o filtro compara: um status conhecido ou `EM_ANALISE`. */
  chave: string;
  rotulo: string;
  /** O status gravado na nota, para a dica. */
  real: string;
  emAnalise: boolean;
};

/**
 * O status que a lista mostra. Conhecido: ele mesmo. ERRO_AUTORIZACAO,
 * RETORNO_FOCUS, vazio ou qualquer outro: "Em análise", com o real guardado.
 */
export function statusExibidoDaNfse(status: string | null | undefined): StatusExibidoDaNfse {
  const real = String(status ?? "").trim().toUpperCase();
  const conhecido = STATUS_CONHECIDOS_NFSE.find((s) => s.valor === real);
  if (conhecido) return { chave: conhecido.valor, rotulo: conhecido.rotulo, real, emAnalise: false };
  return { chave: STATUS_EM_ANALISE, rotulo: "Em análise", real: real || "(sem status)", emAnalise: true };
}

/** A nota passa no filtro de status? Vazio = todas. Filtro que a tela não conhece não esconde nada. */
export function notaPassaNoFiltroDeStatus(statusDaNota: string | null | undefined, filtro: string): boolean {
  const pedido = String(filtro ?? "").trim().toUpperCase();
  if (!pedido) return true;
  if (!(FILTRO_STATUS_NFSE as readonly string[]).includes(pedido)) return true;
  return statusExibidoDaNfse(statusDaNota).chave === pedido;
}

/* ---------------------------------------------------------------- cancelar */

export const DICA_CANCELAR_NFSE =
  "Cancelamento de NFS-e ainda não está disponível no Vibe. Cancele pelo portal nacional (www.nfse.gov.br) e avise o fiscal.";

/**
 * O item "Cancelar NFS-e" do menu da nota: à vista, DESLIGADO e sem ação. Não
 * chama rota nenhuma. O cancelamento de NF-e é outro item, em outro menu, e
 * continua como está.
 */
export function itemCancelarNfse(): { label: string; disabled: true; title: string } {
  return { label: "Cancelar NFS-e", disabled: true, title: DICA_CANCELAR_NFSE };
}
