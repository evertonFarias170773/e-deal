export function humanizeStatus(status: string) {
  const statusMap: Record<string, string> = {
    A_RECEBER: "A receber",
    A_VENCER: "A vencer",
    PAID: "Pago",
    CANCELADO: "Cancelado",
    CARD_PARCELADO: "Cartão parcelado",
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
    NAO_CONFIRMADO: "Não confirmado"
  };

  return statusMap[status] ?? status;
}
