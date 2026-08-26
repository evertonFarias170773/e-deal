/**
 * Regras puras do cancelamento de cobranca JA PAGA (Conferencia de Pagamentos).
 * Sem I/O e sem React de proposito: a rota e a tela consomem daqui, e o
 * comportamento fica testavel isoladamente.
 *
 * Spec: docs/superpowers/specs/2026-08-11-cancelamento-cobranca-paga-design.md
 */
import { getLocalDateInSaoPaulo, getLocalMonthKey } from "@/features/cobrancas/cobrancas-utils";

export type MotivoCancelamentoPago =
  | "DESISTENCIA_CLIENTE"
  | "ENGANO_MODALIDADE"
  | "COBRANCA_DUPLICADA"
  | "VALOR_INCORRETO"
  | "OUTRO";

export type DestinoValorCancelado = "DEVOLVIDO" | "CREDITO" | "NENHUM";

export const MOTIVOS_CANCELAMENTO_PAGO: {
  codigo: MotivoCancelamentoPago;
  rotulo: string;
  destinoSugerido: DestinoValorCancelado;
  exigeTexto: boolean;
}[] = [
  { codigo: "DESISTENCIA_CLIENTE", rotulo: "Desistencia do cliente", destinoSugerido: "DEVOLVIDO", exigeTexto: false },
  { codigo: "ENGANO_MODALIDADE", rotulo: "Engano de modalidade", destinoSugerido: "NENHUM", exigeTexto: false },
  { codigo: "COBRANCA_DUPLICADA", rotulo: "Cobranca duplicada", destinoSugerido: "DEVOLVIDO", exigeTexto: false },
  { codigo: "VALOR_INCORRETO", rotulo: "Valor incorreto", destinoSugerido: "NENHUM", exigeTexto: false },
  { codigo: "OUTRO", rotulo: "Outro motivo", destinoSugerido: "DEVOLVIDO", exigeTexto: true }
];

export const DESTINOS_VALOR_CANCELADO: { codigo: DestinoValorCancelado; rotulo: string }[] = [
  { codigo: "DEVOLVIDO", rotulo: "Valor devolvido ao cliente" },
  { codigo: "CREDITO", rotulo: "Valor lancado como credito na conta corrente" },
  { codigo: "NENHUM", rotulo: "Valor mantido (cobranca sera refeita)" }
];

export function isMotivoCancelamentoPago(valor: unknown): valor is MotivoCancelamentoPago {
  return MOTIVOS_CANCELAMENTO_PAGO.some((m) => m.codigo === valor);
}

export function isDestinoValorCancelado(valor: unknown): valor is DestinoValorCancelado {
  return DESTINOS_VALOR_CANCELADO.some((d) => d.codigo === valor);
}

/**
 * Status que representa dinheiro EFETIVAMENTE recebido, para efeito deste
 * fluxo excepcional. Em producao todo A_VENCER e E-FATURADO: faturado
 * aprovado e recebimento futuro autorizado, nao dinheiro que ja entrou
 * (docs/business/CHECKOUT-PAGAMENTOS.md, secao faturado). `confirmado=true`
 * tambem nao qualifica sozinho — e liberacao operacional, nao contabil.
 * So `PAID` conta.
 */
export function isStatusPagoParaCancelamento(status: string | null | undefined): boolean {
  return String(status || "").trim().toUpperCase() === "PAID";
}

export type TipoCobrancaBloqueadoCancelamentoPago = "E-FATURADO" | "E-CREDITO";

/**
 * Tipos de cobranca que nunca podem entrar neste fluxo, mesmo com status
 * PAID:
 * - E-FATURADO: o normal e ficar em A_VENCER, mas mesmo que o status seja
 *   PAID o titulo em Contas a Receber (public.boletos) continua ativo e
 *   este fluxo nao mexe nele.
 * - E-CREDITO: nasce com status PAID porque o credito ja foi debitado da
 *   conta corrente do cliente (`usar-credito/route.ts`) — cancelar aqui NAO
 *   estorna esse consumo.
 * Retorna o tipo normalizado quando bloqueia, ou null quando nao bloqueia.
 */
export function tipoCobrancaBloqueiaCancelamentoPago(
  tipoCobranca: string | null | undefined
): TipoCobrancaBloqueadoCancelamentoPago | null {
  const normalizado = String(tipoCobranca || "").trim().toUpperCase().replace(/_/g, "-");
  if (normalizado === "E-FATURADO") return "E-FATURADO";
  if (normalizado === "E-CREDITO") return "E-CREDITO";
  return null;
}

export function mensagemTipoCobrancaBloqueado(tipo: TipoCobrancaBloqueadoCancelamentoPago): string {
  if (tipo === "E-FATURADO") {
    return "Cobranca faturada nao entra neste fluxo: o valor pode nao ter sido recebido e o titulo em Contas a Receber continuaria ativo.";
  }
  return "Cobranca paga com credito do cliente nao entra neste fluxo: o cancelamento nao estorna o credito consumido.";
}

/**
 * Criterio UNICO de "cobranca paga" para o fluxo excepcional de
 * cancelamento — combina `isStatusPagoParaCancelamento` e
 * `tipoCobrancaBloqueiaCancelamentoPago`. A rota aplica os dois separados
 * (mensagens de bloqueio diferentes); as telas (CobrancaActionsMenu,
 * CobrancaDetail) usam esta funcao combinada para decidir se mostram o
 * fluxo de cobranca paga, e por isso nunca podem divergir do resultado
 * final da rota.
 */
export function isCobrancaPagaParaCancelamento(cobranca: {
  status: string | null | undefined;
  tipo_cobranca?: string | null | undefined;
}): boolean {
  if (!isStatusPagoParaCancelamento(cobranca.status)) return false;
  return tipoCobrancaBloqueiaCancelamentoPago(cobranca.tipo_cobranca) === null;
}

/**
 * Referencia de data para decidir se a confirmacao caiu em mes fechado.
 * Mesmo fallback que o dashboard financeiro usa para datar a receita
 * (`dashboard-financeiro.service.ts:getFaturamentoReference`): paid_at,
 * senao data_confirmacao, senao created_at — existem 74 cobrancas
 * confirmadas com os dois primeiros campos nulos, e sem o created_at no
 * fim da cadeia elas nunca disparariam a confirmacao de mes fechado.
 */
export function referenciaConfirmacaoParaMesFechado(cobranca: {
  paid_at?: string | null;
  data_confirmacao?: string | null;
  created_at?: string | null;
}): string | null {
  return cobranca.paid_at || cobranca.data_confirmacao || cobranca.created_at || null;
}

/**
 * Status que so existem DEPOIS da revisao do gerente — a partir de
 * REVISAO PRODUCAO a proposta ja entrou na producao.
 *
 * Lista explicita de proposito. Ate 13/08/2026 ela era derivada de
 * PROPOSTA_STATUS_PROTEGIDOS menos REVISAO ATENDENTE, e estava errada:
 * aquela constante existe para outro fim (impedir que o cancelamento de uma
 * cobranca rebaixe o status da proposta automaticamente) e inclui APROVADO e
 * LIBERADO, que vem ANTES da revisao. No fluxo oficial LIBERADO significa
 * "condicao financeira aceita" (docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md
 * secao 6.6) — e o status normal de toda cobranca recem-confirmada. O
 * resultado era um bloqueio em 99,8% das cobrancas pagas, e sem saida: a
 * mensagem pedia ao gerente para devolver a proposta para REVISAO ATENDENTE,
 * que nem e devolucao (e transicao para frente) nem esta ao alcance dele,
 * porque a lista de Pedidos onde mora esse botao filtra is_prd_aprovado.
 *
 * REVISAO ATENDENTE fica de fora: e a porta de saida — o gerente devolve a
 * proposta para la (devolverPropostaParaRevisaoAtendente, tela de Pedidos) e
 * so entao o financeiro cancela.
 */
export const STATUS_QUE_BLOQUEIAM_CANCELAMENTO_PAGO: readonly string[] = [
  "REVISAO PRODUCAO",
  "EM PRODUCAO",
  "EM IMPRESSAO", "EM IMPRESSAO / PENDENTE",
  "EM ACABAMENTO", "EM ACABAMENTO / PENDENTE",
  "EXPEDICAO", "A RETIRAR", "EM TRANSITO", "ENTREGUE"
];

export type PropostaParaBloqueioCancelamento = {
  status_interno?: string | null;
  is_prd_aprovado?: boolean | null;
};

/**
 * `is_prd_aprovado` entra junto com o status porque e a flag REAL de "esta na
 * producao": e o que a liberacao liga (junto com REVISAO PRODUCAO), o que
 * retirarPropostaDaProducao desliga e o filtro da lista de Pedidos
 * (pedidos-producao.service.ts) — ou seja, e o que faz a proposta aparecer na
 * tela onde existe o botao de devolver para REVISAO ATENDENTE. Bloquear por
 * ela mantem a mensagem honesta: so ouve "peca ao gerente" quem o gerente
 * consegue alcancar.
 */
export function bloqueiaCancelamentoPago(proposta: PropostaParaBloqueioCancelamento): boolean {
  if (proposta.is_prd_aprovado === true) return true;
  const normalizado = String(proposta.status_interno || "").trim().toUpperCase();
  if (!normalizado) return false;
  return STATUS_QUE_BLOQUEIAM_CANCELAMENTO_PAGO.includes(normalizado);
}

export function mensagemBloqueioProducao(
  idInt: number | null,
  proposta: PropostaParaBloqueioCancelamento
): string {
  const prefixo = idInt != null ? `Proposta ${idInt}` : "A proposta";
  const status = String(proposta.status_interno || "").trim().toUpperCase();

  if (STATUS_QUE_BLOQUEIAM_CANCELAMENTO_PAGO.includes(status)) {
    return `${prefixo} está ${status}. ` +
      "Peça ao gerente para devolver a proposta para REVISAO ATENDENTE antes de cancelar a cobrança.";
  }

  // Sobrou o caso da flag: status ainda anterior a producao, mas a proposta
  // consta liberada. A acao do gerente aqui e retirar da producao, nao devolver.
  return `${prefixo} consta liberada para a produção. ` +
    "Peça ao gerente para retirá-la da produção antes de cancelar a cobrança.";
}

/**
 * A confirmacao caiu em mes anterior ao corrente (America/Sao_Paulo)? E o
 * unico caso em que um faturamento ja fechado muda, e por isso exige
 * confirmacao extra do usuario.
 *
 * `getLocalMonthKey` sozinho nao converte fuso: para uma string ISO em UTC
 * (sufixo "Z") ele apenas recorta a data literal do texto, o que erra a
 * virada de mes perto da meia-noite em SP. Por isso a data primeiro passa
 * por `getLocalDateInSaoPaulo` — a mesma normalizacao que `CobrancasList`
 * ja usa para comparar datas de confirmacao — antes de extrair o mes.
 */
export function isConfirmacaoDeMesAnterior(
  dataConfirmacao: string | null | undefined,
  agora: Date = new Date()
): boolean {
  if (!dataConfirmacao) return false;
  const mesConfirmacao = getLocalMonthKey(getLocalDateInSaoPaulo(dataConfirmacao));
  const mesAtual = getLocalMonthKey(getLocalDateInSaoPaulo(agora));
  if (!mesConfirmacao || !mesAtual) return false;
  return mesConfirmacao < mesAtual;
}

export function rotuloMotivo(motivo: MotivoCancelamentoPago): string {
  return MOTIVOS_CANCELAMENTO_PAGO.find((m) => m.codigo === motivo)?.rotulo ?? String(motivo);
}

/** Texto unico gravado em pagamentos_v2.motivo_cancela. */
export function montarMotivoCancela(
  motivo: MotivoCancelamentoPago,
  texto: string | null,
  destino: DestinoValorCancelado
): string {
  const base = motivo === "OUTRO"
    ? `${rotuloMotivo(motivo)}: ${String(texto || "").trim()}`
    : rotuloMotivo(motivo);
  const destinoRotulo = DESTINOS_VALOR_CANCELADO.find((d) => d.codigo === destino)?.rotulo ?? destino;
  return `${base} | ${destinoRotulo}`;
}
