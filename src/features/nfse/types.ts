import type { NfseMock } from "@/lib/mocks/nfse.mock";

export type NfseStatus =
  | "PENDENTE"
  | "PRONTA_PARA_ENVIO"
  | "PROCESSANDO"
  | "AUTORIZADA"
  | "ERRO_ENVIO"
  | "REJEITADA"
  | "CANCELADA"
  | string;

export interface SupabaseNfseRow {
  id: string;
  id_int: number;
  ref: string;
  id_empresa: number;
  id_cliente: number;
  status: string;
  status_focus: string;
  status_prefeitura: string | null;
  mensagem_prefeitura: string | null;
  ambiente: string;
  municipio_prestacao: string;
  uf_prestacao: string;
  id_servico_padrao: number;
  codigo_servico: string;
  codigo_tributario_municipio: string | null;
  item_lista_servico: string;
  cnae: string | null;
  discriminacao: string;
  valor_servicos: number;
  valor_deducoes: number;
  valor_pis: number;
  valor_cofins: number;
  valor_inss: number;
  valor_ir: number;
  valor_csll: number;
  aliquota_iss: number;
  iss_retido: boolean;
  aliquota_pis: number;
  aliquota_cofins: number;
  aliquota_csll: number;
  aliquota_ir: number;
  aliquota_inss: number;
  numero_nfse: number | null;
  codigo_verificacao: string | null;
  caminho_xml: string | null;
  caminho_pdf: string | null;
  url_xml: string | null;
  url_pdf: string | null;
  erro_codigo: string | null;
  erro_mensagem: string | null;
  payload_envio: Record<string, unknown> | null;
  payload_retorno: Record<string, unknown> | null;
  criado_por_nome: string | null;
  ultima_tentativa_em: string | null;
  tentativas_envio: number;
  serie_dps: string | null;
  numero_dps: string | null;
  id_natureza_operacao: number | null;
  natureza_operacao: string | null;
  codigo_nbs: string | null;
  codigo_tributacao_nacional_iss: string | null;
  regime_especial_tributacao: string | null;
  codigo_opcao_simples_nacional: string | null;
  situacao_tributaria_pis_cofins: string | null;
  ibs_cbs_situacao_tributaria: string | null;
  ibs_cbs_classificacao_tributaria: string | null;
  codigo_indicador_operacao: string | null;
  indicador_destinatario: number | null;
  aliquota_cbs: number;
  valor_cbs: number;
  aliquota_ibs_estadual: number;
  valor_ibs_estadual: number;
  aliquota_ibs_municipal: number;
  valor_ibs_municipal: number;
  forma_pagamento: string | null;
  informacoes_complementares: string | null;
  informacoes_fisco: string | null;
  valor_desconto: number;
  base_calculo_iss: number;
  valor_iss: number;
  valor_liquido: number;
  created_at: string;
  updated_at: string;
  nome?: string | null;
  fantasia?: string | null;
}

export type NfseReadModel = NfseMock;

export interface SupabaseNfseServicoPadraoRow {
  id: number;
  nome: string;
  descricao_padrao: string;
  municipio_prestacao: string;
  uf_prestacao: string;
  codigo_servico: string;
  codigo_tributario_municipio: string | null;
  item_lista_servico: string;
  cnae: string | null;
  aliquota_iss: number;
  iss_retido: boolean;
  ativo: boolean;
  codigo_nbs: string | null;
}

export type NfseServicoPadraoReadModel = SupabaseNfseServicoPadraoRow;
