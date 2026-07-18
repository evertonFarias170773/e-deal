export type SupabaseValue = string | number | bigint | boolean | null | undefined | Array<unknown> | Record<string, unknown>;

export type SupabasePropostaRow = Record<string, SupabaseValue> & {
  id?: SupabaseValue;
  id_int?: SupabaseValue;
  id_cliente?: SupabaseValue;
  id_faturado?: SupabaseValue;
  id_endereco_ent?: SupabaseValue;
  id_contato?: SupabaseValue;
  cliente?: SupabaseValue;
  contato?: SupabaseValue;
  cep?: SupabaseValue;
  os_ideal?: SupabaseValue;
  created_at?: SupabaseValue;
  vendedor?: SupabaseValue;
  status_interno?: SupabaseValue;
  valor_total?: SupabaseValue;
  valor?: SupabaseValue;
  valor_frete?: SupabaseValue;
  frete_escolhido?: SupabaseValue;
  is_avulso?: SupabaseValue;
  texto_whatsapp?: SupabaseValue;
  obs_proposta?: SupabaseValue;
  proposta?: SupabaseValue;
  user_id?: SupabaseValue;

  // Relational aggregates
  tipos_cobranca?: string[];
  cobranca_status?: string | string[];
  tipo_cobranca?: string | string[];
  em_arte?: boolean;
  is_prd_aprovado?: boolean;
};

export type SupabasePagamentoTipoCobrancaRow = {
  id_int?: SupabaseValue;
  tipo_cobranca?: SupabaseValue;
  status?: SupabaseValue;
};

export type SupabaseProdutoPropostaRow = {
  id: number;
  id_int: number;
  id_produto: number;
  nome_produto?: string | null;
  modelo_descri?: string | null;
  valor_unt?: number | null;
  qtd?: number | null;
  fixo?: number | null;
  valor_sub_total?: number | null;
  peso_uni?: number | null;
  peso_total?: number | null;
  peso_base?: number | null;
  peso_extra?: number | null;
  valor_base?: number | null;
  valor_extra?: number | null;
  ncm?: string | null;
  cfop?: string | null;
  status_item?: string | null;
};

export type SupabaseProdutoPropostaVariacaoRow = {
  id: number;
  id_produto_proposta: number;
  id_variacao: number;
  id_tipo_variacao: number;
  nome_variacao?: string | null;
  v_extra?: number | null;
  peso_uni?: number | null;
};
