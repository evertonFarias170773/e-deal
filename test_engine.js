function calcularStatusRecomendado(evidencias) {
  const { statusInternoAtual, pagamentosAtivos, modelos, isAvulso } = evidencias;
  
  let statusRecomendado = statusInternoAtual || "NOVO";
  const bloqueios = [];
  let motivo = "Nenhuma alteração calculada";
  let nivelConfianca = "BAIXO";
  let podeGravarAutomaticamente = false;
  let emArte = false;

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

const evidencias = {
  statusInternoAtual: "APROVADO",
  pagamentosAtivos: [
    {
      status: "PAID",
      confirmado: true
    }
  ],
  modelos: [
    { status_arte: 'APROVADO', status_producao: 'PENDENTE' },
    { status_arte: 'APROVADO', status_producao: 'PENDENTE' }
  ],
  isAvulso: false
};

const result = calcularStatusRecomendado(evidencias);
console.log("=== ENGINE RESULT ===");
console.log(result);
