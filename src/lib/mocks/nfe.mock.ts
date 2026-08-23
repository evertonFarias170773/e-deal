export interface NfeMock {
  id: string;
  id_int: number;
  id_cliente: number;
  ref: string;
  ambiente: "homologacao" | "producao" | string;
  modelo: "55" | string;
  status: string;
  // Anulaveis: 17 das 48 notas ja tem esses campos nulos no banco, e devolver
  // uma nota para rascunho apaga o retorno da tentativa anterior.
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
  isMock: boolean;
  os_ideal?: string;
  // Vindos da proposta de origem, para a lista mostrar sem abrir a nota.
  vendedor_pedido?: string | null;
  status_pedido?: string | null;
  socio_pagador_nome?: string | null;
  cliente_principal_nome?: string | null;
  cliente_principal_id?: number | null;
  /** Forma de cobrança negociada, de pagamentos_v2. Decide o alerta de recebíveis. */
  tipo_cobranca?: string | null;
}

export const nfeMocks: NfeMock[] = [
  {
    id: "nfe-mock-1",
    id_int: 16604,
    id_cliente: 922723,
    ref: "NFE-16604-001",
    ambiente: "homologacao",
    modelo: "55",
    status: "AUTORIZADA",
    status_focus: "autorizado",
    status_sefaz: "100 - Autorizado o uso do DF-e",
    mensagem_sefaz: "Autorizada com sucesso",
    codigo_status_sefaz: "100",
    numero_nf: 1024,
    serie: 1,
    chave_nfe: "35260514152597000102550010000010241000010248",
    protocolo: "135260000123456",
    data_autorizacao: "2026-05-13T10:05:00Z",
    data_cancelamento: null,
    natureza_operacao: "VENDA DENTRO DO ESTADO - PRODUÇÃO PRÓPRIA",
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 9,
    tipo_contribuinte: 9,
    modalidade_frete: 0,
    id_cotacao_frete: null,
    transportadora: null,
    valor_frete: 0,
    peso_liquido: 1.25,
    peso_bruto: 1.35,
    quantidade_volumes: 1,
    especie_volumes: "CAIXA",
    marca_volumes: "IDEAL",
    numeracao_volumes: "1",
    informacoes_complementares: "NFS-e Ref OS 16604. Venda de producao do estabelecimento.",
    observacoes_internas: "Boleto emitido e enviado junto.",
    endereco_entrega_observacao: null,
    valor_produtos: 120.00,
    valor_desconto: 0,
    valor_total_nf: 120.00,
    caminho_xml: "nfe-documentos/NFE-16604-001/nfe.xml",
    caminho_danfe: "nfe-documentos/NFE-16604-001/danfe.pdf",
    url_xml: "https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object/sign/nfe-documentos/NFE-16604-001/nfe.xml?token=mocked",
    url_danfe: "https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object/sign/nfe-documentos/NFE-16604-001/danfe.pdf?token=mocked",
    payload_envio: null,
    payload_retorno: null,
    payload_webhook: null,
    erro_codigo: null,
    erro_mensagem: null,
    erros_validacao: null,
    tentativas_envio: 1,
    ultima_tentativa_em: "2026-05-13T10:04:00Z",
    criado_por: "usr-caroline",
    criado_por_nome: "Caroline",
    created_at: "2026-05-13T10:00:00Z",
    updated_at: "2026-05-13T10:05:00Z",
    id_empresa: 1,
    end_entrega: null,
    cond_pgto: true,
    forma_pgto: "PIX",
    drop_natureza_op: "5101",
    id_transportadora_cliente: null,
    pgto_is_configurado: true,
    nome: "Marcio Roberto Rocha Cardoso",
    fantasia: "Marcio Roberto Rocha Cardoso",
    isMock: true
  },
  {
    id: "nfe-mock-2",
    id_int: 16790,
    id_cliente: 120017,
    ref: "NFE-16790-001",
    ambiente: "homologacao",
    modelo: "55",
    status: "PENDENTE",
    status_focus: "pendente",
    status_sefaz: "",
    mensagem_sefaz: "",
    codigo_status_sefaz: "",
    numero_nf: null,
    serie: null,
    chave_nfe: null,
    protocolo: null,
    data_autorizacao: null,
    data_cancelamento: null,
    natureza_operacao: "VENDA DENTRO DO ESTADO - PRODUÇÃO PRÓPRIA",
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 9,
    tipo_contribuinte: 9,
    modalidade_frete: 0,
    id_cotacao_frete: null,
    transportadora: null,
    valor_frete: 15.00,
    peso_liquido: 0.5,
    peso_bruto: 0.6,
    quantidade_volumes: 1,
    especie_volumes: "PACOTE",
    marca_volumes: "IDEAL",
    numeracao_volumes: null,
    informacoes_complementares: null,
    observacoes_internas: "Revisar NCM antes de emitir",
    endereco_entrega_observacao: null,
    valor_produtos: 8420.00,
    valor_desconto: 420.00,
    valor_total_nf: 8015.00,
    caminho_xml: null,
    caminho_danfe: null,
    url_xml: null,
    url_danfe: null,
    payload_envio: null,
    payload_retorno: null,
    payload_webhook: null,
    erro_codigo: null,
    erro_mensagem: null,
    erros_validacao: null,
    tentativas_envio: 0,
    ultima_tentativa_em: null,
    criado_por: "usr-everton",
    criado_por_nome: "Everton",
    created_at: "2026-05-18T14:30:00Z",
    updated_at: "2026-05-18T14:30:00Z",
    id_empresa: 1,
    end_entrega: null,
    cond_pgto: false,
    forma_pgto: "BOLETO",
    drop_natureza_op: "5101",
    id_transportadora_cliente: null,
    pgto_is_configurado: false,
    nome: "Carol Embalagens Ltda",
    fantasia: "Carol Embalagens",
    isMock: true
  }
];
