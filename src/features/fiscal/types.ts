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
  /**
   * Notas fiscais VIVAS que esta origem já tem (cancelada e denegada não
   * contam). Zero significa "ainda não virou documento fiscal". Maior que zero
   * some da fila por padrão, e o filtro "Mostrar já faturadas" traz de volta —
   * faturamento parcial é legítimo e não pode perder o caminho.
   */
  notas_vivas?: number;
}
