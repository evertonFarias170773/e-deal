export type SupabaseNullableValue = string | number | bigint | boolean | null | undefined;

export type SupabaseClienteRow = {
  id: string;
  id_vendedor?: SupabaseNullableValue;
  nome: SupabaseNullableValue;
  apelido?: SupabaseNullableValue;
  contato?: SupabaseNullableValue;
  documento?: SupabaseNullableValue;
  ins_estadual?: SupabaseNullableValue;
  ins_municipal?: SupabaseNullableValue;
  data_fundacao?: SupabaseNullableValue;
  email_contato?: SupabaseNullableValue;
  email_financeiro?: SupabaseNullableValue;
  telefone_fixo?: SupabaseNullableValue;
  whatsapp_1?: SupabaseNullableValue;
  whatsapp_2?: SupabaseNullableValue;
  ativo?: SupabaseNullableValue;
  restricao?: SupabaseNullableValue;
  limite_credito?: SupabaseNullableValue;
  obs?: SupabaseNullableValue;
  data_criacao?: SupabaseNullableValue;
  id_cliente?: SupabaseNullableValue;
  fantasia?: SupabaseNullableValue;
  email?: SupabaseNullableValue;
  site?: SupabaseNullableValue;
  data_cadastro?: SupabaseNullableValue;
  recebe_email?: SupabaseNullableValue;
  recebe_whatsapp?: SupabaseNullableValue;
  tipo_pessoa?: SupabaseNullableValue;
  nome_vendedor?: SupabaseNullableValue;
  nota?: SupabaseNullableValue;
  categoria?: SupabaseNullableValue;
  risco_credito?: SupabaseNullableValue;
  ultima_compra?: SupabaseNullableValue;
  total_compras?: SupabaseNullableValue;
  verificado?: SupabaseNullableValue;
  data_verificacao?: SupabaseNullableValue;
  padrao_pagamento?: SupabaseNullableValue;
  empresa_padrao?: SupabaseNullableValue;
  tipo_contribuinte?: SupabaseNullableValue;
  motivo_erro?: SupabaseNullableValue;
  cidade_uf?: SupabaseNullableValue;
  cpf_invalido?: SupabaseNullableValue;
  cpf_erro?: SupabaseNullableValue;
  credito?: SupabaseNullableValue;
  is_bonus?: SupabaseNullableValue;
  usa_preco_fixo?: SupabaseNullableValue;
  percentual_bunus?: SupabaseNullableValue;
  id_modelo_cobranca?: SupabaseNullableValue;
};

export type SupabaseEnderecoRow = {
  id: string;
  id_cliente: SupabaseNullableValue;
  cep?: SupabaseNullableValue;
  endereco?: SupabaseNullableValue;
  numero?: SupabaseNullableValue;
  complemento?: SupabaseNullableValue;
  bairro?: SupabaseNullableValue;
  cidade?: SupabaseNullableValue;
  uf?: SupabaseNullableValue;
  tipo_endereco?: SupabaseNullableValue;
  data_criacao?: SupabaseNullableValue;
  obs?: SupabaseNullableValue;
  Latitude?: SupabaseNullableValue;
  longitude?: SupabaseNullableValue;
  distancia?: SupabaseNullableValue;
  recebedor?: SupabaseNullableValue;
  cpf_recebedor?: SupabaseNullableValue;
};

export type SupabaseContatoRow = {
  id: string;
  id_cliente: SupabaseNullableValue;
  nome_contato?: SupabaseNullableValue;
  nome?: SupabaseNullableValue;
  cargo?: SupabaseNullableValue;
  whats?: SupabaseNullableValue;
  e_mail?: SupabaseNullableValue;
  created_at?: SupabaseNullableValue;
};

export type SupabaseClienteSocioRow = {
  id: string;
  id_cliente_principal: SupabaseNullableValue;
  id_cliente_socio: SupabaseNullableValue;
  tipo_relacao?: SupabaseNullableValue;
  data_criacao?: SupabaseNullableValue;
};

export type SupabaseCadastrosClientesListaRow = {
  id?: SupabaseNullableValue;
  id_cliente?: SupabaseNullableValue;
  id_cliente_text?: SupabaseNullableValue;
  nome?: SupabaseNullableValue;
  fantasia?: SupabaseNullableValue;
  apelido?: SupabaseNullableValue;
  documento?: SupabaseNullableValue;
  documento_numeros?: SupabaseNullableValue;
  tipo_pessoa?: SupabaseNullableValue;
  // Só a view vw_cadastros_lista_completa projeta estes dois; na compartilhada
  // eles não são selecionados, por isso seguem opcionais.
  categoria?: SupabaseNullableValue;
  ativo?: SupabaseNullableValue;
  cidade_uf?: SupabaseNullableValue;
  nome_vendedor?: SupabaseNullableValue;
  whatsapp_1?: SupabaseNullableValue;
  whatsapp_2?: SupabaseNullableValue;
  telefone_fixo?: SupabaseNullableValue;
  credito?: SupabaseNullableValue;
  limite_credito?: SupabaseNullableValue;
  risco_credito?: SupabaseNullableValue;
  data_fundacao?: SupabaseNullableValue;
  aniversariante_hoje?: SupabaseNullableValue;
  qtd_pedidos?: SupabaseNullableValue;
  data_ult_pedido?: SupabaseNullableValue;
  busca_geral?: SupabaseNullableValue;
};

export type SupabaseCadastrosAbcClienteRow = {
  posicao?: SupabaseNullableValue;
  id_cliente?: SupabaseNullableValue;
  cliente?: SupabaseNullableValue;
  qtd_pedidos?: SupabaseNullableValue;
  valor_total?: SupabaseNullableValue;
  ultimo_pedido?: SupabaseNullableValue;
};

export type SupabaseCadastrosAbcCidadeRow = {
  posicao?: SupabaseNullableValue;
  cidade_uf?: SupabaseNullableValue;
  qtd_pedidos?: SupabaseNullableValue;
  qtd_clientes?: SupabaseNullableValue;
  valor_total?: SupabaseNullableValue;
  ultimo_pedido?: SupabaseNullableValue;
};

export type SupabaseUsuarioRow = {
  id: string;
  nome?: SupabaseNullableValue;
  email?: SupabaseNullableValue;
};

export type SupabaseUsuarioVendedorRow = {
  user_id?: SupabaseNullableValue;
  nome_usuario?: SupabaseNullableValue;
  meu_vendedor?: SupabaseNullableValue;
  id_vendedor?: SupabaseNullableValue;
  is_vendedor?: SupabaseNullableValue;
  is_super_adm?: SupabaseNullableValue;
};

export type SupabasePropostaRow = {
  id: SupabaseNullableValue;
  id_int?: SupabaseNullableValue;
  id_cliente?: SupabaseNullableValue;
  cliente?: SupabaseNullableValue;
  proposta?: SupabaseNullableValue;
  valor?: SupabaseNullableValue;
  valor_total?: SupabaseNullableValue;
  vendedor?: SupabaseNullableValue;
  status_interno?: SupabaseNullableValue;
  empresa?: SupabaseNullableValue;
  created_at?: SupabaseNullableValue;
  updated_at?: SupabaseNullableValue;
};
