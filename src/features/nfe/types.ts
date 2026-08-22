import type { NfeMock } from "@/lib/mocks/nfe.mock";

export type NfeStatus =
  | "PENDENTE"
  | "PRONTA_PARA_ENVIO"
  | "PROCESSANDO"
  | "AUTORIZADA"
  | "ERRO_AUTORIZACAO"
  | "ERRO_ENVIO"
  | "NAO_ENCONTRADA_FOCUS"
  | "CANCELADA"
  | "DENEGADA"
  | string;

export interface SupabaseNfeRow {
  id: string;
  id_int: number;
  id_cliente: number;
  ref: string;
  ambiente: string;
  modelo: string;
  status: string;
  // As quatro sao anulaveis no banco, e precisam ser anulaveis aqui: devolver a
  // nota para rascunho apaga o retorno da tentativa anterior.
  status_focus: string | null;
  status_sefaz: string | null;
  mensagem_sefaz: string | null;
  codigo_status_sefaz: string | null;
  numero_nf: number | null;
  serie: number | null;
  chave_nfe: string | null;
  protocolo: string | null;
  data_autorizacao: string | null;
  data_cancelamento: string | null;
  natureza_operacao: string;
  tipo_documento: number;
  finalidade_emissao: number;
  consumidor_final: number;
  presenca_comprador: number;
  tipo_contribuinte: number;
  modalidade_frete: number;
  id_cotacao_frete: number | null;
  transportadora: string | null;
  valor_frete: number;
  peso_liquido: number;
  peso_bruto: number;
  quantidade_volumes: number;
  especie_volumes: string | null;
  marca_volumes: string | null;
  numeracao_volumes: string | null;
  informacoes_complementares: string | null;
  observacoes_internas: string | null;
  endereco_entrega_observacao: string | null;
  valor_produtos: number;
  valor_desconto: number;
  valor_total_nf: number;
  caminho_xml: string | null;
  caminho_danfe: string | null;
  url_xml: string | null;
  url_danfe: string | null;
  payload_envio: Record<string, unknown> | null;
  payload_retorno: Record<string, unknown> | null;
  payload_webhook: Record<string, unknown> | null;
  erro_codigo: string | null;
  erro_mensagem: string | null;
  erros_validacao: unknown[] | null;
  tentativas_envio: number;
  ultima_tentativa_em: string | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  created_at: string;
  updated_at: string;
  id_empresa: number;
  end_entrega: boolean | null;
  cond_pgto: boolean | null;
  forma_pgto: string | null;
  drop_natureza_op: string | null;
  id_transportadora_cliente: number | null;
  pgto_is_configurado: boolean;
  nome?: string | null;
  fantasia?: string | null;
}

export type NfeReadModel = NfeMock;

export interface SupabaseNfeItemRow {
  id: string;
  id_nota_fiscal: string;
  ref: string;
  id_int: number;
  id_produtos_proposta: number | null;
  id_produto: number;
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade_comercial: string;
  unidade_tributavel: string;
  quantidade: number;
  valor_unitario: number;
  valor_bruto: number;
  quantidade_tributavel: number;
  valor_unitario_tributavel: number;
  icms_origem: number;
  icms_situacao_tributaria: string;
  pis_situacao_tributaria: string;
  cofins_situacao_tributaria: string;
  ativo: boolean;
  editado_manualmente: boolean;
  observacao: string | null;
  origem_item: string | null;
  peso_unitario_gramas: number;
  peso_total_gramas: number;
}

export type NfeItemReadModel = SupabaseNfeItemRow;

export interface SupabaseNfePagamentoRow {
  id: string;
  id_int: number;
  ref: string;
  id_nota_fiscal: string;
  numero_parcela: number;
  total_parcelas: number;
  numero_duplicata: string | null;
  data_vencimento: string;
  valor: number;
  forma_pagamento: string;
  descricao_forma_pagamento: string | null;
  tipo_integracao: string | null;
  origem: string | null;
  observacao: string | null;
  ativo: boolean;
  dias_pra_inicio: number | null;
  intervalo_dias: number | null;
  tipo_registro: string | null;
}

export type NfePagamentoReadModel = SupabaseNfePagamentoRow;
