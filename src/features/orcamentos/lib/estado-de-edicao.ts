/**
 * O ESTADO DE EDIÇÃO de uma proposta com cobrança — a regra do aviso amarelo.
 *
 * Fonte única (08/10/2026): a tela de EDIÇÃO e a de VISUALIZAÇÃO decidem por
 * aqui. Antes a visualização tinha a sua própria regra — "Edição Bloqueada"
 * sempre que existisse qualquer cobrança, inclusive só cancelada — e dizia o
 * contrário da edição ("Faturado a Vencer — Alteração Liberada") no mesmo pedido.
 *
 * `estadoDeEdicaoDaProposta` é a cadeia de condições que morava no JSX do
 * formulário, na MESMA ordem: a primeira que vale ganha. Nada da regra mudou.
 *
 * `avaliarEstadoDeEdicao` monta as entradas a partir do que as duas telas têm
 * (cobranças, títulos, permissões), com as mesmas contas do formulário, para a
 * visualização não repetir nenhuma delas.
 */
import { calcularValorPagoConfirmado } from "@/features/cobrancas/cobrancas-utils";
import type { Cobranca } from "@/features/cobrancas/types";
import {
  avaliarElegibilidadeFaturado,
  type CobrancaParaFaturado,
  type ElegibilidadeFaturado,
  type TituloParaFaturado
} from "@/features/orcamentos/services/faturado-editavel";

export type EstadoDeEdicao =
  /** Nenhuma cobrança ativa: não há aviso. Cobrança cancelada não conta. */
  | "SEM_COBRANCA_ATIVA"
  | "AVULSA_PAGA_BLOQUEADA"
  | "FATURADO_A_VENCER_LIBERADA"
  | "FATURADO_BLOQUEADA"
  | "EDICAO_AUTORIZADA_PAGA"
  | "COBRANCA_ATIVA_NAO_CONFIRMADA"
  | "COBRANCAS_GERADAS";

export type EntradaDoEstadoDeEdicao = {
  hasActiveCobranca: boolean;
  bloqueioAvulsaPaga: boolean;
  podeEditarPeloFaturado: boolean;
  canEditarFaturado: boolean;
  canEditarPropostaPaga: boolean;
  faturadoElegivel: boolean;
  /** Só quando o faturado NÃO é elegível. */
  motivoFaturado: string | null;
  isPropostaPaga: boolean;
};

/** A cadeia do aviso, na ordem em que o formulário sempre decidiu. */
export function estadoDeEdicaoDaProposta(e: EntradaDoEstadoDeEdicao): EstadoDeEdicao {
  if (!e.hasActiveCobranca) return "SEM_COBRANCA_ATIVA";
  if (e.bloqueioAvulsaPaga) return "AVULSA_PAGA_BLOQUEADA";
  if (e.podeEditarPeloFaturado) return "FATURADO_A_VENCER_LIBERADA";
  if (e.canEditarFaturado && !e.canEditarPropostaPaga && !e.faturadoElegivel && e.motivoFaturado !== "SEM_FATURADO") {
    return "FATURADO_BLOQUEADA";
  }
  if (e.canEditarPropostaPaga && e.isPropostaPaga) return "EDICAO_AUTORIZADA_PAGA";
  if (e.canEditarPropostaPaga && !e.isPropostaPaga) return "COBRANCA_ATIVA_NAO_CONFIRMADA";
  return "COBRANCAS_GERADAS";
}

/** O título do aviso de cada estado — o mesmo texto nas duas telas. */
export const TITULO_DO_ESTADO_DE_EDICAO: Record<Exclude<EstadoDeEdicao, "SEM_COBRANCA_ATIVA">, string> = {
  AVULSA_PAGA_BLOQUEADA: "Proposta avulsa já paga não pode ser alterada",
  FATURADO_A_VENCER_LIBERADA: "Faturado a Vencer — Alteração Liberada",
  FATURADO_BLOQUEADA: "Alteração Bloqueada",
  EDICAO_AUTORIZADA_PAGA: "Modo Edição Autorizada — Proposta com Pagamento Confirmado",
  COBRANCA_ATIVA_NAO_CONFIRMADA: "Cobrança Ativa — Pagamento Ainda Não Confirmado",
  COBRANCAS_GERADAS: "Atenção: Cobranças Geradas"
};

/** A frase curta que a VISUALIZAÇÃO mostra embaixo do título. */
export function resumoDoEstadoDeEdicao(estado: EstadoDeEdicao, mensagemDoFaturado: string | null): string {
  switch (estado) {
    case "AVULSA_PAGA_BLOQUEADA":
      return "Esta proposta já possui pagamento confirmado e não tem produtos a alterar. A edição está bloqueada para todos os perfis.";
    case "FATURADO_A_VENCER_LIBERADA":
      return "O valor ainda não foi recebido: o pedido pode ser alterado na edição, e a cobrança acompanha o novo total.";
    case "FATURADO_BLOQUEADA":
      return mensagemDoFaturado || "Esta proposta não pode ser alterada pelo caminho do faturado.";
    case "EDICAO_AUTORIZADA_PAGA":
      return "Você tem permissão para editar esta proposta mesmo com pagamento confirmado. A diferença de valor é tratada ao salvar.";
    case "COBRANCA_ATIVA_NAO_CONFIRMADA":
      return "Há cobrança em aberto, ainda não paga. Revise antes de alterar valores, para não divergir da cobrança emitida.";
    case "COBRANCAS_GERADAS":
      return "Esta proposta possui cobranças geradas. Revise os pagamentos antes de alterar valores.";
    default:
      return "";
  }
}

export type AvaliacaoDoEstadoDeEdicao = {
  estado: EstadoDeEdicao;
  elegibilidadeFaturado: ElegibilidadeFaturado;
  hasActiveCobranca: boolean;
  isPropostaPaga: boolean;
  podeEditarPeloFaturado: boolean;
  bloqueioAvulsaPaga: boolean;
};

/**
 * As mesmas contas do formulário, a partir dos dados crus.
 *
 * `titulos === null` quer dizer "ainda não li" (ou a leitura falhou): como no
 * formulário, o caminho do faturado não destrava sem os títulos.
 */
export function avaliarEstadoDeEdicao(e: {
  cobrancas: Cobranca[];
  titulos: TituloParaFaturado[] | null;
  /** A tela está em modo de edição de uma proposta que existe. A visualização responde como a edição. */
  modoEdicao: boolean;
  canEditarPropostaPaga: boolean;
  canEditarFaturado: boolean;
  isAvulso: boolean;
  temProdutosAtivos: boolean;
}): AvaliacaoDoEstadoDeEdicao {
  const hasActiveCobranca = e.cobrancas.some((c) => c.status !== "CANCELADO");
  const isPropostaPaga = calcularValorPagoConfirmado(e.cobrancas) > 0;
  const elegibilidadeFaturado = avaliarElegibilidadeFaturado({
    cobrancas: e.cobrancas as unknown as CobrancaParaFaturado[],
    titulos: e.titulos ?? []
  });
  const podeEditarPeloFaturado =
    e.modoEdicao && e.titulos !== null && elegibilidadeFaturado.elegivel && e.canEditarFaturado;
  const bloqueioAvulsaPaga =
    e.modoEdicao && isPropostaPaga && !podeEditarPeloFaturado && (e.isAvulso || !e.temProdutosAtivos);

  const estado = estadoDeEdicaoDaProposta({
    hasActiveCobranca,
    bloqueioAvulsaPaga,
    podeEditarPeloFaturado,
    canEditarFaturado: e.canEditarFaturado,
    canEditarPropostaPaga: e.canEditarPropostaPaga,
    faturadoElegivel: elegibilidadeFaturado.elegivel,
    motivoFaturado: elegibilidadeFaturado.elegivel ? null : elegibilidadeFaturado.motivo,
    isPropostaPaga
  });

  return { estado, elegibilidadeFaturado, hasActiveCobranca, isPropostaPaga, podeEditarPeloFaturado, bloqueioAvulsaPaga };
}

/* ------------------------------------------------------------ selo de status */

export type TomDoStatus = "info" | "success" | "warning" | "neutral";

/** O tom do selo de status do cabeçalho — a mesma escolha na edição e na visualização. */
export function tomDoStatusDoCabecalho(status: string | null | undefined): TomDoStatus {
  if (status === "NOVO") return "info";
  if (status === "APROVADO") return "success";
  if (status === "AGUARDANDO") return "warning";
  return "neutral";
}
