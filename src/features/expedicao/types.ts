export interface FreteInfo {
  transportadora: string;
  servico: string;
  valor: number;
  prazo: string;
  pesoUsado: number;
  volumes: number;
  observacao: string;
}

export interface ExpedicaoListItem {
  id_int: number;
  cliente: string;
  
  // Dados de Proposta
  statusLogistico: string; // EXPEDICAO, A RETIRAR, EM TRANSITO, ENTREGUE
  isLegacy: boolean; // Indica se veio apenas do public.pedidos por legibilidade
  
  // Dados de Pedido/OS
  idPedido?: string; // id real do pedido na tabela pedidos
  codigoRastreamento?: string;
  statusProducao?: string;
  statusExpedicao?: string;
  dataTermino?: string;
  observacoesOs?: string;
  
  // Dados de Frete
  frete?: FreteInfo;
  isRetiradaLocal: boolean;
  freteDefinido: boolean;
}
