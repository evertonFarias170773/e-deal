export type TipoOrigem = "PEDIDO" | "OS" | "AVULSO" | "CONTRATO";

export type FaturavelStatus = "PENDENTE" | "PARCIAL" | "FATURADO";

export interface FaturavelItem {
  id: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  ncm: string;
  cfop: string;
}

export interface FaturavelOrigem {
  id: string;
  tipo: TipoOrigem;
  ref_origem: string;
  id_cliente: number;
  cliente_nome: string;
  cliente_fantasia: string;
  id_empresa: number;
  status: FaturavelStatus;
  valor_total: number;
  os_ideal?: string;
  itens: FaturavelItem[];
  created_at: string;
  tipo_cobranca?: string;
}
