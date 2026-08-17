export function humanizeStatus(status: string) {
  const statusMap: Record<string, string> = {
    // PedidoStatus
    BOLETIM_FINALIZADO: "Boletim Finalizado",
    BLOQUEADO: "Bloqueado",
    NOVO: "Novo",
    NOVO_ARTE_APROVADA: "Novo / Arte aprovada",
    AGUARDANDO_ARTE_APROVADA: "Aguardando / Arte aprovada",
    ARTE_EM_ANDAMENTO: "Arte em Andamento",
    AGUARDANDO_APROVACAO_CLIENTE: "Aguardando Cliente",
    AGUARDANDO_APROVACAO_ATENDENTE: "Aguardando Atendente",
    AGUARDANDO_OS: "Aguardando OS",
    EM_IMPRESSAO: "Em Impressão",
    EM_ACABAMENTO: "Em Acabamento",
    REVISAO_FINAL: "Revisão Final",
    PRONTO_EXPEDICAO: "Pronto p/ Expedição",
    EXPEDIDO: "Expedido",
    EXPEDICAO: "Na Expedição",
    "A RETIRAR": "A Retirar",
    "EM TRANSITO": "Em Trânsito",
    ENTREGUE: "Entregue",
    "AGUARDANDO TRANSPORTADORA": "Aguardando transportadora",

    // ArteStatus
    EM_CRIACAO: "Em Criação",
    EM_REVISAO_INTERNA: "Revisão Interna",
    AGUARDANDO_CLIENTE: "Aguardando Cliente",
    REPROVADA_CLIENTE: "Reprovada p/ Cliente",
    APROVADA_CLIENTE: "Aprovada p/ Cliente",
    LIBERADA: "Arte Liberada",
    IMPRESSA: "Arte Impressa",
    NAO_NECESSARIA: "Sem Arte",
    DESIGN_ATRIBUIDO: "Design Atribuído",

    // ProducaoStatus
    CONCLUIDA: "OS Concluída",
    PAUSADA: "Produção Pausada",

    PRONTA_PARA_ENVIO: "Pronta para Envio",
    // Existing statuses
    DEPOSITO_CONTA: "Depósito em conta",
    BOLETO_REGISTRADO: "Boleto registrado",
    A_RECEBER_CRIADO: "A receber criado — boleto não registrado",
    A_RECEBER: "A receber",
    A_VENCER: "A vencer",
    PAID: "Pago",
    CANCELADO: "Cancelado",
    CARD_PARCELADO: "Cartão de crédito",
    VENCIDO: "Vencido",
    PRORROGADO: "Prorrogado",
    AGUARDANDO_CREDITO: "Aguardando análise de crédito",
    LIBERADA_PARA_PEDIDO: "Liberada para pedido",
    PRONTA_PARA_LIBERACAO: "Pronta para liberar",
    AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
    PARCIALMENTE_APROVADA: "Parcialmente paga",
    APROVADO: "Aprovado",
    AGUARDANDO: "Aguardando",
    PENDENTE: "Pendente",
    PROCESSANDO: "Processando",
    AUTORIZADA: "Autorizada",
    REJEITADA: "Rejeitada",
    ERRO_AUTORIZACAO: "Rejeitada",
    BLOQUEADA_VALIDACAO: "Bloqueada",
    RASCUNHO: "Rascunho",
    CONFIRMADO: "Confirmado",
    NAO_CONFIRMADO: "Não confirmado",
    // Dinheiro já entrou; falta só a conferência do financeiro. Distinguir de
    // NAO_CONFIRMADO evita o vendedor ler "não confirmado" como "não pago".
    PAGO_A_LIBERAR: "Pago / A liberar",
    OBRIGATORIA: "Obrigatória",
    OPCIONAL: "Opcional",
    MULTIPLA: "Múltipla",
    ESCOLHA_UNICA: "Escolha única",
    ATIVO: "Ativo",
    INATIVO: "Inativo",
    FALHA_INTEGRACAO: "Falha de integração/envio",
    RETORNO_FOCUS: "Retorno Focus",
    NAO_ENCONTRADA_FOCUS: "Não encontrada no Focus"
  };

  return statusMap[status] ?? status;
}
