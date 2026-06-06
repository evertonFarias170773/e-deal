export interface NfseMock {
  id: string;
  id_int: number;
  ref: string;
  id_empresa: number;
  id_cliente: number;
  status: string;
  status_focus: string;
  status_prefeitura: string | null;
  mensagem_prefeitura: string | null;
  ambiente: "homologacao" | "producao" | string;
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
  valor_desconto: number;
  base_calculo_iss: number;
  valor_iss: number;
  valor_liquido: number;
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
  created_at: string;
  updated_at: string;
  nome?: string | null;
  fantasia?: string | null;
  isMock: boolean;
}

export const nfseMocks: NfseMock[] = [
  {
    id: "nfse-mock-1",
    id_int: 16251,
    ref: "NFS-16251-001",
    id_empresa: 2,
    id_cliente: 11311,
    status: "AUTORIZADA",
    status_focus: "autorizado",
    status_prefeitura: "100 - Autorizado",
    mensagem_prefeitura: "NFS-e Autorizada com sucesso",
    ambiente: "homologacao",
    municipio_prestacao: "Porto Alegre",
    uf_prestacao: "RS",
    id_servico_padrao: 1,
    codigo_servico: "13.05.01",
    codigo_tributario_municipio: null,
    item_lista_servico: "13.05",
    cnae: null,
    discriminacao: "Composição gráfica e impressão de credenciais de identificação e pulseiras conforme proposta comercial.",
    valor_servicos: 2100.00,
    valor_deducoes: 0,
    valor_desconto: 0,
    base_calculo_iss: 2100.00,
    valor_iss: 105.00,
    valor_liquido: 2100.00,
    valor_pis: 0,
    valor_cofins: 0,
    valor_inss: 0,
    valor_ir: 0,
    valor_csll: 0,
    aliquota_iss: 5.0,
    iss_retido: false,
    aliquota_pis: 0,
    aliquota_cofins: 0,
    aliquota_csll: 0,
    aliquota_ir: 0,
    aliquota_inss: 0,
    numero_nfse: 504,
    codigo_verificacao: "VERIF504",
    caminho_xml: "nfse-documentos/NFS-16251-001/nfse.xml",
    caminho_pdf: "nfse-documentos/NFS-16251-001/nfse.pdf",
    url_xml: "https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object/sign/nfse-documentos/NFS-16251-001/nfse.xml?token=mocked",
    url_pdf: "https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object/sign/nfse-documentos/NFS-16251-001/nfse.pdf?token=mocked",
    erro_codigo: null,
    erro_mensagem: null,
    payload_envio: null,
    payload_retorno: null,
    criado_por_nome: "Caroline",
    ultima_tentativa_em: "2026-05-18T09:12:00Z",
    tentativas_envio: 1,
    serie_dps: "1",
    numero_dps: "504",
    id_natureza_operacao: 1,
    natureza_operacao: "Tributável no município",
    codigo_nbs: "121012200",
    codigo_tributacao_nacional_iss: "130501",
    regime_especial_tributacao: "0",
    codigo_opcao_simples_nacional: "1",
    situacao_tributaria_pis_cofins: "07",
    ibs_cbs_situacao_tributaria: "000",
    ibs_cbs_classificacao_tributaria: "000001",
    codigo_indicador_operacao: "050201",
    indicador_destinatario: 0,
    aliquota_cbs: 0,
    valor_cbs: 0,
    aliquota_ibs_estadual: 0,
    valor_ibs_estadual: 0,
    aliquota_ibs_municipal: 0,
    valor_ibs_municipal: 0,
    forma_pagamento: "1",
    informacoes_complementares: "NBS:121012200. Serviços prestados em Porto Alegre.",
    informacoes_fisco: null,
    created_at: "2026-05-18T09:00:00Z",
    updated_at: "2026-05-18T09:12:00Z",
    nome: "Marcio Roberto Rocha Cardoso",
    fantasia: "Marcio Roberto Rocha Cardoso",
    isMock: true
  },
  {
    id: "nfse-mock-2",
    id_int: 16477,
    ref: "NFS-16477-001",
    id_empresa: 2,
    id_cliente: 922723,
    status: "PENDENTE",
    status_focus: "pendente",
    status_prefeitura: null,
    mensagem_prefeitura: null,
    ambiente: "homologacao",
    municipio_prestacao: "Porto Alegre",
    uf_prestacao: "RS",
    id_servico_padrao: 1,
    codigo_servico: "13.05.01",
    codigo_tributario_municipio: null,
    item_lista_servico: "13.05",
    cnae: null,
    discriminacao: "Serviço de diagramação e composição gráfica de credenciais.",
    valor_servicos: 500.00,
    valor_deducoes: 0,
    valor_desconto: 0,
    base_calculo_iss: 500.00,
    valor_iss: 25.00,
    valor_liquido: 500.00,
    valor_pis: 0,
    valor_cofins: 0,
    valor_inss: 0,
    valor_ir: 0,
    valor_csll: 0,
    aliquota_iss: 5.0,
    iss_retido: false,
    aliquota_pis: 0,
    aliquota_cofins: 0,
    aliquota_csll: 0,
    aliquota_ir: 0,
    aliquota_inss: 0,
    numero_nfse: null,
    codigo_verificacao: null,
    caminho_xml: null,
    caminho_pdf: null,
    url_xml: null,
    url_pdf: null,
    erro_codigo: null,
    erro_mensagem: null,
    payload_envio: null,
    payload_retorno: null,
    criado_por_nome: "Everton",
    ultima_tentativa_em: null,
    tentativas_envio: 0,
    serie_dps: null,
    numero_dps: null,
    id_natureza_operacao: null,
    natureza_operacao: null,
    codigo_nbs: "121012200",
    codigo_tributacao_nacional_iss: "130501",
    regime_especial_tributacao: null,
    codigo_opcao_simples_nacional: null,
    situacao_tributaria_pis_cofins: null,
    ibs_cbs_situacao_tributaria: "000",
    ibs_cbs_classificacao_tributaria: "000001",
    codigo_indicador_operacao: "050201",
    indicador_destinatario: 0,
    aliquota_cbs: 0,
    valor_cbs: 0,
    aliquota_ibs_estadual: 0,
    valor_ibs_estadual: 0,
    aliquota_ibs_municipal: 0,
    valor_ibs_municipal: 0,
    forma_pagamento: null,
    informacoes_complementares: "NBS:121012200",
    informacoes_fisco: null,
    created_at: "2026-05-18T14:30:00Z",
    updated_at: "2026-05-18T14:30:00Z",
    nome: "Carol Embalagens Ltda",
    fantasia: "Carol Embalagens",
    isMock: true
  }
];
