export type SupabaseValue = string | number | boolean | null | undefined | Array<unknown> | Record<string, unknown>;

export type SupabaseProdutoRow = {
  id?: SupabaseValue;
  created_at?: SupabaseValue;
  id_produto?: SupabaseValue;
  nomeReal?: SupabaseValue;
  categoria?: SupabaseValue;
  formato?: SupabaseValue;
  valorUnt?: SupabaseValue;
  valorFixo?: SupabaseValue;
  valor_custo?: SupabaseValue;
  peso?: SupabaseValue;
  prazo?: SupabaseValue;
  nivelSeg?: SupabaseValue;
  fraseCons?: SupabaseValue;
  descricao?: SupabaseValue;
  personalizacao?: SupabaseValue;
  apelidos?: SupabaseValue;
  ativo?: SupabaseValue;
  is_estoque?: SupabaseValue;
  is_variacao?: SupabaseValue;
  is_multiplo?: SupabaseValue;
  cod_beneficio?: SupabaseValue;
  ncm?: SupabaseValue;
  descri_ncm?: SupabaseValue;
  cest?: SupabaseValue;
  origem?: SupabaseValue;
  cod_origem?: SupabaseValue;
  cod_bar?: SupabaseValue;
  und_medida?: SupabaseValue;
  cfop_interno?: SupabaseValue;
  cfop_interestadual?: SupabaseValue;
  unidade_comercial?: SupabaseValue;
  unidade_tributavel?: SupabaseValue;
  icms_origem?: SupabaseValue;
  icms_situacao_tributaria?: SupabaseValue;
  pis_situacao_tributaria?: SupabaseValue;
  informacoes_fiscais?: SupabaseValue;
  id_formato?: SupabaseValue;
  id_modelo_cor?: SupabaseValue;
  quantidade_minima_venda?: SupabaseValue;
  tipo_blocagem?: SupabaseValue;
};

export type SupabaseProdutoFotoRow = {
  id?: SupabaseValue;
  nomeProduto?: SupabaseValue;
  imagensURL?: SupabaseValue;
  idProduto?: SupabaseValue;
};

export type SupabaseProdutoVariacaoRow = {
  id?: SupabaseValue;
  id_produto?: SupabaseValue;
  id_variacao?: SupabaseValue;
  nome?: SupabaseValue;
  is_obrigatorio?: SupabaseValue;
  is_multiplo?: SupabaseValue;
};
