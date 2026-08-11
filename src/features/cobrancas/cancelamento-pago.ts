/**
 * Regras puras do cancelamento de cobranca JA PAGA (Conferencia de Pagamentos).
 * Sem I/O e sem React de proposito: a rota e a tela consomem daqui, e o
 * comportamento fica testavel isoladamente.
 *
 * Spec: docs/superpowers/specs/2026-08-11-cancelamento-cobranca-paga-design.md
 */
import { PROPOSTA_STATUS_PROTEGIDOS } from "@/features/orcamentos/services/status-protegidos";
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
 * Status operacionais que impedem o cancelamento. E a lista protegida MENOS
 * REVISAO ATENDENTE: esse status e justamente a porta de saida — o gerente
 * devolve a proposta para la (devolverPropostaParaRevisaoAtendente, tela de
 * Pedidos) e so entao o financeiro cancela.
 */
export const STATUS_QUE_BLOQUEIAM_CANCELAMENTO_PAGO: readonly string[] =
  PROPOSTA_STATUS_PROTEGIDOS.filter((status) => status !== "REVISAO ATENDENTE");

export function bloqueiaCancelamentoPago(statusProposta: string | null | undefined): boolean {
  const normalizado = String(statusProposta || "").trim().toUpperCase();
  if (!normalizado) return false;
  return STATUS_QUE_BLOQUEIAM_CANCELAMENTO_PAGO.includes(normalizado);
}

export function mensagemBloqueioProducao(idInt: number | null, statusProposta: string): string {
  const proposta = idInt != null ? `Proposta ${idInt}` : "A proposta";
  return `${proposta} esta ${String(statusProposta).trim().toUpperCase()}. ` +
    "Peca ao gerente para devolver a proposta para REVISAO ATENDENTE antes de cancelar a cobranca.";
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
