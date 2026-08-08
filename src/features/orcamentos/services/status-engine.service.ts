/**
 * Engine Pura de Cálculo de Status Interno de Propostas.
 * Esta engine NÃO possui efeitos colaterais. Ela não consulta o Supabase
 * e não realiza escritas. Ela recebe evidências (estado atual de pagamentos,
 * artes, modelos, propostas) e retorna uma recomendação do status.
 *
 * Regra financeira oficial (LIBERADO só com cobertura integral):
 * a soma de pagamentos válidos (`PAID`, ou `A_VENCER` com `confirmado=true`)
 * precisa cobrir `propostas.valor_total` DE FATO, comparando os valores em
 * centavos (arredondados a 2 casas). Saldo devedor real de R$ 0,01/0,02
 * mantém AGUARDANDO — a tolerância vale só para ruído técnico de ponto
 * flutuante que arredonda para zero. Pagamento parcial nunca produz LIBERADO.
 */

// Tolerância monetária oficial (mesma usada em calcularSituacaoQuitacaoProposta).
export const TOLERANCIA_MONETARIA = 0.02;

// Novos estados devem sempre gravar "LIBERADO" — "APROVADO" é mantido apenas
// como valor legado de leitura (propostas antigas), nunca mais escrito por esta engine.
const FAMILIA_FINANCEIRA = ["NOVO", "AGUARDANDO", "APROVADO", "LIBERADO"];

export interface EvidenciaStatus {
  statusInternoAtual: string;
  /** propostas.valor_total — fonte da verdade do total financeiro da proposta. */
  valorTotalProposta: number;
  /** Soma já filtrada pela regra oficial de quitação (calcularSituacaoQuitacaoProposta):
   *  PAID, ou A_VENCER+confirmado=true; CANCELADO/CANCELADA/EXTORNADO/RECUSADO excluídos. */
  valorPagoConfirmado: number;
  /** Existe ao menos uma cobrança ativa (não cancelada/extornada) vinculada à proposta. */
  temCobrancaAtiva: boolean;
  modelos: {
    status_arte: string;
    status_producao: string;
  }[];
  isAvulso: boolean;
  /**
   * Produto de prateleira: todos os itens ativos da proposta são vendidos
   * prontos, então não há arte a criar nem a aprovar. Equivale ao "arte
   * dispensada" da matriz de transições (FLUXO-OFICIAL §13) — não é um status
   * novo, apenas a condição que libera LIBERADO → REVISAO ATENDENTE sem passar
   * por arte. Falso por padrão: na dúvida, exige arte.
   */
  arteDispensada?: boolean;
}

export interface EngineStatusResult {
  statusAtual: string;
  statusRecomendado: string;
  mudariaStatus: boolean;
  motivo: string;
  bloqueios: string[];
  evidenciasUsadas: Record<string, any>;
  nivelConfianca: "ALTO" | "MEDIO" | "BAIXO";
  podeGravarAutomaticamente: boolean;
  emArte: boolean;
}

function baseStatus(status: string): string {
  return (status || "NOVO").toUpperCase().replace(" / EM ARTE", "").trim();
}

export function calcularStatusRecomendado(evidencias: EvidenciaStatus): EngineStatusResult {
  const { statusInternoAtual, valorTotalProposta, valorPagoConfirmado, temCobrancaAtiva, modelos, isAvulso, arteDispensada } = evidencias;

  let statusRecomendado = statusInternoAtual || "NOVO";
  const bloqueios: string[] = [];
  let motivo = "Nenhuma alteração calculada";
  let nivelConfianca: "ALTO" | "MEDIO" | "BAIXO" = "BAIXO";
  let podeGravarAutomaticamente = false;
  let emArte = false;

  // REGRA FINANCEIRA
  // Só reavalia dentro da família comercial/financeira (NOVO/AGUARDANDO/APROVADO[legado]/LIBERADO).
  // Estados de Produção/Expedição/Entrega e CANCELADO nunca são tocados por esta engine —
  // evidência financeira não é autorização para avançar ou regredir etapas produtivas
  // (FLUXO-OFICIAL-STATUS-PROPOSTAS.md §1.4).
  //
  // Quando não há nenhuma cobrança ativa, a engine não recomenda nada (evita regressão
  // silenciosa para NOVO, proibida em §12) — esse caso já é tratado pelo mecanismo de
  // reversão dedicado (reverterStatusPropostaSeSemCobranca / checkAndRevertPropostaStatus).
  const dentroDaFamiliaFinanceira = FAMILIA_FINANCEIRA.includes(baseStatus(statusInternoAtual));

  if (dentroDaFamiliaFinanceira && temCobrancaAtiva) {
    // Comparação em CENTAVOS dos valores arredondados a 2 casas: cobertura
    // integral exige pago >= total DE FATO. Um saldo devedor REAL de
    // R$ 0,01/0,02 mantém a proposta AGUARDANDO — nunca é "quitado por
    // tolerância" (regressão #19514). O arredondamento a 2 casas continua
    // absorvendo apenas ruído técnico de ponto flutuante (frações menores
    // que meio centavo, que arredondam para zero).
    const totalCents = Math.round(valorTotalProposta * 100);
    const pagoCents = Math.round(valorPagoConfirmado * 100);
    const cobreIntegralmente = totalCents > 0 && pagoCents >= totalCents;
    const valorPagoFmt = (pagoCents / 100).toFixed(2);
    const valorTotalFmt = (totalCents / 100).toFixed(2);

    if (cobreIntegralmente) {
      statusRecomendado = "LIBERADO";
      motivo = `Cobertura financeira integral: R$ ${valorPagoFmt} de R$ ${valorTotalFmt}`;
      nivelConfianca = "ALTO";
      podeGravarAutomaticamente = true;
    } else {
      statusRecomendado = "AGUARDANDO";
      motivo = `Cobertura financeira parcial: R$ ${valorPagoFmt} de R$ ${valorTotalFmt} — saldo pendente R$ ${(valorTotalProposta - valorPagoConfirmado).toFixed(2)}`;
      nivelConfianca = "ALTO";
      podeGravarAutomaticamente = true;
    }
  }

  // PRODUTO DE PRATELEIRA — arte dispensada.
  // Proposta 100% prateleira não tem arte a aprovar, então a etapa é pulada:
  // assim que a cobertura financeira fecha (LIBERADO), segue direto para a
  // conferência do atendente. Não antecipa produção — a entrada na fila
  // continua dependendo de is_prd_aprovado, por ação manual (§9.1).
  //
  // Vem antes do bloco de arte de propósito: se a proposta é toda de
  // prateleira, modelos porventura existentes não representam trabalho de arte
  // e não devem segurar a transição.
  if (!isAvulso && arteDispensada === true) {
    const financeiramenteLiberado = statusRecomendado === "APROVADO" || statusRecomendado === "LIBERADO";
    if (financeiramenteLiberado) {
      statusRecomendado = "REVISAO ATENDENTE";
      motivo = "Liberado financeiramente e arte dispensada (todos os itens são produtos de prateleira)";
      nivelConfianca = "ALTO";
    }

    const mudariaStatusPrateleira = (statusInternoAtual || "NOVO") !== statusRecomendado;
    return {
      statusAtual: statusInternoAtual || "NOVO",
      statusRecomendado,
      mudariaStatus: mudariaStatusPrateleira,
      motivo,
      bloqueios,
      evidenciasUsadas: evidencias,
      nivelConfianca,
      podeGravarAutomaticamente,
      emArte: false
    };
  }

  // REGRAS DE ARTE / PRODUCAO (inalteradas na semântica; passam a reconhecer LIBERADO
  // além do legado APROVADO como o estado "financeiramente liberado").
  if (!isAvulso && modelos.length > 0) {
    const statusesAprovados = ["APROVADA", "APROVADO", "APROVADA_CLIENTE", "LIBERADA", "IMPRESSA", "NAO_NECESSARIA"];
    const todosAprovados = modelos.every(m => m.status_arte && statusesAprovados.includes(m.status_arte.toUpperCase()));
    const financeiramenteLiberado = statusRecomendado === "APROVADO" || statusRecomendado === "LIBERADO";

    if (todosAprovados) {
      if (financeiramenteLiberado) {
        statusRecomendado = "REVISAO ATENDENTE";
        motivo = "Liberado financeiramente e todas as artes aprovadas";
        nivelConfianca = "ALTO";
      } else if (statusRecomendado === "NOVO") {
        statusRecomendado = "NOVO_ARTE_APROVADA";
        motivo = "Sem cobrança válida confirmada, mas com todas as artes aprovadas";
        nivelConfianca = "ALTO";
      } else if (statusRecomendado === "AGUARDANDO") {
        statusRecomendado = "AGUARDANDO_ARTE_APROVADA";
        motivo = "Aguardando confirmação financeira, mas com todas as artes aprovadas";
        nivelConfianca = "ALTO";
      }
    } else {
      emArte = true;
      if (statusRecomendado === "NOVO") {
        motivo = "Sem cobrança válida confirmada, mas com arte em andamento";
        nivelConfianca = "MEDIO";
      } else if (statusRecomendado === "AGUARDANDO") {
        motivo = "Aguardando confirmação financeira, mas com arte em andamento";
        nivelConfianca = "MEDIO";
      } else if (financeiramenteLiberado) {
        motivo = "Liberado financeiramente, mas modelos encontram-se em fase de arte";
        nivelConfianca = "MEDIO";
      }
    }
  }

  const mudariaStatus = (statusInternoAtual || "NOVO") !== statusRecomendado;

  return {
    statusAtual: statusInternoAtual || "NOVO",
    statusRecomendado,
    mudariaStatus,
    motivo,
    bloqueios,
    evidenciasUsadas: evidencias,
    nivelConfianca,
    podeGravarAutomaticamente,
    emArte
  };
}
