/**
 * Engine Pura de Cálculo de Status Interno de Propostas.
 * Esta engine NÃO possui efeitos colaterais. Ela não consulta o Supabase 
 * e não realiza escritas. Ela recebe evidências (estado atual de pagamentos, 
 * artes, modelos, propostas) e retorna uma recomendação do status.
 *
 * Utilizada para a Fase 1 (Shadow Mode) da transição de arquitetura.
 */

export interface EvidenciaStatus {
  statusInternoAtual: string;
  pagamentosAtivos: {
    status: string; // 'PAID', 'A_RECEBER', 'A_VENCER', etc
    confirmado: boolean;
  }[];
  modelos: {
    status_arte: string;
    status_producao: string;
  }[];
  isAvulso: boolean;
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

export function calcularStatusRecomendado(evidencias: EvidenciaStatus): EngineStatusResult {
  const { statusInternoAtual, pagamentosAtivos, modelos, isAvulso } = evidencias;
  
  let statusRecomendado = statusInternoAtual || "NOVO";
  const bloqueios: string[] = [];
  let motivo = "Nenhuma alteração calculada";
  let nivelConfianca: "ALTO" | "MEDIO" | "BAIXO" = "BAIXO";
  let podeGravarAutomaticamente = false;
  let emArte = false;

  // REGRAS FINANCEIRAS
  // Para uma proposta ser considerada financeiramente aprovada, todos os registros 
  // válidos de pagamentos_v2 do mesmo id_int precisam estar confirmados/aprovados.
  const temPagamentos = pagamentosAtivos.length > 0;
  const todosPagamentosConfirmados = temPagamentos && pagamentosAtivos.every(p => p.confirmado === true || p.status === "PAID");
  const possuiPagamentoPendente = temPagamentos && !todosPagamentosConfirmados;

  if (statusInternoAtual === "NOVO" && temPagamentos) {
    if (todosPagamentosConfirmados) {
      statusRecomendado = "APROVADO";
      motivo = "Todos os pagamentos foram confirmados";
      nivelConfianca = "ALTO";
      podeGravarAutomaticamente = true;
    } else if (possuiPagamentoPendente) {
      statusRecomendado = "AGUARDANDO";
      motivo = "Existem pagamentos pendentes aguardando confirmação";
      nivelConfianca = "ALTO";
      podeGravarAutomaticamente = true;
    }
  }

  // REGRAS DE ARTE / PRODUCAO
  if (!isAvulso && modelos.length > 0) {
    const statusesAprovados = ["APROVADA", "APROVADA_CLIENTE", "LIBERADA", "IMPRESSA", "NAO_NECESSARIA"];
    const todosAprovados = modelos.every(m => m.status_arte && statusesAprovados.includes(m.status_arte.toUpperCase()));
    
    if (todosAprovados) {
      if (statusRecomendado === "APROVADO") {
        statusRecomendado = "REVISAO ATENDENTE";
        motivo = "Aprovado financeiramente e todas as artes aprovadas";
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
      } else if (statusRecomendado === "APROVADO") {
        motivo = "Aprovado financeiramente, mas modelos encontram-se em fase de arte";
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
