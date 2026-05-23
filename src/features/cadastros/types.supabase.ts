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
  percentual_bunus?: SupabaseNullableValue;
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

export type SupabaseUsuarioRow = {
  id: string;
  nome?: SupabaseNullableValue;
  email?: SupabaseNullableValue;
};
