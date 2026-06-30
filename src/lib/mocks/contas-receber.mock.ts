import type { StatusTone } from "@/lib/types";

export type RecebivelStatus = "A_RECEBER" | "A_VENCER" | "PAID" | "CANCELADO";
export type RecebivelTipo = "PIX" | "BOLETO" | "CREDIT_CARD" | "CARD_PARCELADO" | "E-FATURADO";
export type RecebimentoOperacionalTipo = "BOLETO" | "DEPOSITO" | "CARTAO" | "E-FATURADO" | "OUTRO_RECEBIVEL";
export type RecebimentoOperacionalStatus = "A_VENCER" | "A_RECEBER" | "PAID" | "CANCELADO" | "VENCIDO";

/** @deprecated Use RecebimentoOperacionalTipo instead */
export type BoletoDepositoTipo = RecebimentoOperacionalTipo;
/** @deprecated Use RecebimentoOperacionalStatus instead */
export type BoletoDepositoStatus = RecebimentoOperacionalStatus;

export type RecebivelMock = {
  id: string;
  id_pagamento: string;
  id_int: number;
  os_ideal: string;
  id_cliente: number;
  cliente: string;
  documento: string;
  empresa: string;
  empresa_original?: string;
  id_empresa: number;
  tipo: RecebivelTipo;
  status: RecebivelStatus;
  valor: number;
  vencimento: string;
  confirmado: boolean;
  paid_at?: string;
  created_at?: string;
  parcela?: number;
  total_parcelas?: number;
  linha_digitavel?: string;
  codigo_barras?: string;
  url_pdf?: string;
  pdf_storage?: string;
  id_boleto_c6?: string;
  nosso_numero?: string;
  referencia?: string;
  ext_reference?: string;
  deposito_conta?: boolean;
  confirmado_por?: string;
  data_vencido?: string;
  is_prorrogado?: boolean;
  motivo_prorg?: string;
  dias_prorg?: number;
  dias_atraso?: number;
  valor_atualizado?: number;
  is_avulso?: boolean;
  is_faturado?: boolean;
  multa?: number;
  juros_dia?: number;
  observacao: string;
};

export type RecebimentoOperacional = Omit<RecebivelMock, "tipo" | "status"> & {
  tipo: RecebimentoOperacionalTipo;
  status: RecebimentoOperacionalStatus;
};

/** @deprecated Use RecebimentoOperacional instead */
export type BoletoDepositoMock = RecebimentoOperacional;

export const contasReceberMock: RecebivelMock[] = [
  {
    id: "rec_pix_pago_1",
    id_pagamento: "PG-CR-0001",
    id_int: 16790,
    os_ideal: "OS-IDEAL-2101",
    id_cliente: 770001,
    cliente: "Entre Pontos Express LTDA",
    documento: "11222333000144",
    empresa: "Ideal Grafica",
    id_empresa: 1,
    tipo: "PIX",
    status: "PAID",
    valor: 700,
    vencimento: "2026-05-20",
    confirmado: true,
    paid_at: "2026-05-20T10:20:00-03:00",
    observacao: "PIX recebido e conciliado no mock."
  },
  {
    id: "rec_pix_pendente_1",
    id_pagamento: "PG-CR-0002",
    id_int: 16803,
    os_ideal: "OS-IDEAL-2120",
    id_cliente: 770014,
    cliente: "Agência Mira Comunicação",
    documento: "00999888000122",
    empresa: "Ideal Grafica",
    id_empresa: 1,
    tipo: "PIX",
    status: "A_RECEBER",
    valor: 2480,
    vencimento: "2026-05-30",
    confirmado: false,
    observacao: "PIX enviado ao cliente, mantido fora da carteira principal por ainda estar em A_RECEBER."
  },
  {
    id: "rec_boleto_a_vencer_1",
    id_pagamento: "PG-CR-0003",
    id_int: 16821,
    os_ideal: "OS-E3-8840",
    id_cliente: 770055,
    cliente: "Prefeitura Municipal de Nova Aurora",
    documento: "88444111000122",
    empresa: "E3 Brindes",
    id_empresa: 3,
    tipo: "BOLETO",
    status: "A_VENCER",
    valor: 5860,
    vencimento: "2026-06-03",
    confirmado: true,
    parcela: 1,
    total_parcelas: 1,
    linha_digitavel: "34191.79001 00003 00000 5 00005.86000",
    codigo_barras: "34190000000000586001790010000300000500000000",
    url_pdf: "/documentos/mock-boleto-pg-cr-0003.pdf",
    observacao: "Boleto aprovado na carteira, aguardando vencimento."
  },
  {
    id: "rec_boleto_vencido_1",
    id_pagamento: "PG-CR-0004",
    id_int: 16804,
    os_ideal: "OS-BIRO-4472",
    id_cliente: 922723,
    cliente: "Gremio Football Porto Alegrense",
    documento: "92783550000120",
    empresa: "Ideal Biro",
    id_empresa: 2,
    tipo: "BOLETO",
    status: "A_VENCER",
    valor: 1890,
    vencimento: "2026-05-12",
    confirmado: true,
    parcela: 1,
    total_parcelas: 1,
    linha_digitavel: "34191.79001 00004 00000 5 00001.89000",
    codigo_barras: "34190000000000189001790010000400000500000000",
    url_pdf: "/documentos/mock-boleto-pg-cr-0004.pdf",
    dias_atraso: 10,
    valor_atualizado: 1936.5,
    observacao: "Boleto aprovado vencido visualmente por data, mantendo status financeiro A_VENCER."
  },
  {
    id: "rec_boleto_hoje_1",
    id_pagamento: "PG-CR-0005",
    id_int: 16833,
    os_ideal: "OS-IDEAL-2144",
    id_cliente: 771003,
    cliente: "Studio Norte Eventos",
    documento: "55222111000188",
    empresa: "Ideal Grafica",
    id_empresa: 1,
    tipo: "BOLETO",
    status: "A_VENCER",
    valor: 3120,
    vencimento: "2026-05-22",
    confirmado: true,
    linha_digitavel: "34191.79001 00005 00000 5 00003.12000",
    codigo_barras: "34190000000000312001790010000500000500000000",
    url_pdf: "/documentos/mock-boleto-pg-cr-0005.pdf",
    observacao: "Boleto aprovado vencendo hoje."
  },
  {
    id: "rec_boleto_pago_1",
    id_pagamento: "PG-CR-0006",
    id_int: 16844,
    os_ideal: "OS-E3-8901",
    id_cliente: 770055,
    cliente: "Prefeitura Municipal de Nova Aurora",
    documento: "88444111000122",
    empresa: "E3 Brindes",
    id_empresa: 3,
    tipo: "BOLETO",
    status: "PAID",
    valor: 4100,
    vencimento: "2026-05-18",
    confirmado: true,
    paid_at: "2026-05-18T14:12:00-03:00",
    linha_digitavel: "34191.79001 00006 00000 5 00004.10000",
    url_pdf: "/documentos/mock-boleto-pg-cr-0006.pdf",
    observacao: "Boleto pago no período."
  },
  {
    id: "rec_boleto_cancelado_1",
    id_pagamento: "PG-CR-0007",
    id_int: 16845,
    os_ideal: "OS-IDEAL-2150",
    id_cliente: 771004,
    cliente: "Alpha Merchandising",
    documento: "33444555000166",
    empresa: "Ideal Grafica",
    id_empresa: 1,
    tipo: "BOLETO",
    status: "CANCELADO",
    valor: 980,
    vencimento: "2026-05-28",
    confirmado: false,
    linha_digitavel: "34191.79001 00007 00000 5 00000.98000",
    url_pdf: "/documentos/mock-boleto-pg-cr-0007.pdf",
    observacao: "Boleto cancelado no mock."
  },
  {
    id: "rec_cartao_futuro_1",
    id_pagamento: "PG-CR-0008",
    id_int: 16850,
    os_ideal: "OS-IDEAL-2160",
    id_cliente: 771005,
    cliente: "Loja Central de Brindes",
    documento: "12121212000199",
    empresa: "Ideal Grafica",
    id_empresa: 1,
    tipo: "CREDIT_CARD",
    status: "A_VENCER",
    valor: 6200,
    vencimento: "2026-06-18",
    confirmado: true,
    referencia: "Recebimento futuro cartão aprovado",
    observacao: "Cartão aprovado com repasse futuro."
  },
  {
    id: "rec_cartao_parcelado_1",
    id_pagamento: "PG-CR-0009",
    id_int: 16821,
    os_ideal: "OS-E3-8840",
    id_cliente: 770055,
    cliente: "Prefeitura Municipal de Nova Aurora",
    documento: "88444111000122",
    empresa: "E3 Brindes",
    id_empresa: 3,
    tipo: "CARD_PARCELADO",
    status: "A_VENCER",
    valor: 7800,
    vencimento: "2026-06-22",
    confirmado: true,
    parcela: 1,
    total_parcelas: 3,
    referencia: "Parcela 1/3 cartão aprovado",
    observacao: "Cartão parcelado é tipo de cobrança, não status."
  },
  {
    id: "rec_faturado_aprovado_1",
    id_pagamento: "PG-CR-0010",
    id_int: 16821,
    os_ideal: "OS-E3-8840",
    id_cliente: 770055,
    cliente: "Prefeitura Municipal de Nova Aurora",
    documento: "88444111000122",
    empresa: "E3 Brindes",
    id_empresa: 3,
    tipo: "E-FATURADO",
    status: "A_VENCER",
    valor: 14200,
    vencimento: "2026-06-13",
    confirmado: true,
    referencia: "Faturado aprovado 28 dias",
    observacao: "Faturado aprovado por limite disponível."
  },
  {
    id: "rec_faturado_pendente_1",
    id_pagamento: "PG-CR-0011",
    id_int: 16804,
    os_ideal: "OS-BIRO-4472",
    id_cliente: 922723,
    cliente: "Gremio Football Porto Alegrense",
    documento: "92783550000120",
    empresa: "Ideal Biro",
    id_empresa: 2,
    tipo: "E-FATURADO",
    status: "A_RECEBER",
    valor: 9800,
    vencimento: "2026-06-20",
    confirmado: false,
    referencia: "Crédito pendente",
    observacao: "Faturado aguardando análise do financeiro, fora da carteira principal."
  },
  {
    id: "rec_multiplo_pix_1",
    id_pagamento: "PG-CR-0012-A",
    id_int: 16900,
    os_ideal: "OS-MULTI-0100",
    id_cliente: 771006,
    cliente: "Festival Sul Produções",
    documento: "77888999000155",
    empresa: "Ideal Grafica",
    id_empresa: 1,
    tipo: "PIX",
    status: "PAID",
    valor: 5000,
    vencimento: "2026-05-21",
    confirmado: true,
    paid_at: "2026-05-21T09:10:00-03:00",
    observacao: "Proposta com múltiplos pagamentos: entrada PIX."
  },
  {
    id: "rec_multiplo_faturado_1",
    id_pagamento: "PG-CR-0012-B",
    id_int: 16900,
    os_ideal: "OS-MULTI-0100",
    id_cliente: 771006,
    cliente: "Festival Sul Produções",
    documento: "77888999000155",
    empresa: "Ideal Grafica",
    id_empresa: 1,
    tipo: "E-FATURADO",
    status: "A_VENCER",
    valor: 3000,
    vencimento: "2026-06-21",
    confirmado: true,
    parcela: 1,
    total_parcelas: 2,
    referencia: "Faturado 1/2",
    observacao: "Proposta com múltiplos pagamentos: faturado aprovado."
  }
];

export const boletosDepositosMock: RecebimentoOperacional[] = [
  ...contasReceberMock
    .filter((item) => item.tipo === "BOLETO")
    .map((item) => ({
      ...item,
      tipo: "BOLETO" as const,
      status: item.status === "PAID" ? "PAID" as const : item.status === "CANCELADO" ? "CANCELADO" as const : "A_VENCER" as const
    })),
  {
    id: "dep_futuro_1",
    id_pagamento: "PG-CR-0013",
    id_int: 16910,
    os_ideal: "OS-DEP-3001",
    id_cliente: 771007,
    cliente: "Rede Farma Oeste",
    documento: "66555444000177",
    empresa: "E3 Brindes",
    id_empresa: 3,
    tipo: "DEPOSITO",
    status: "A_VENCER",
    valor: 3500,
    vencimento: "2026-06-05",
    confirmado: true,
    parcela: 1,
    total_parcelas: 1,
    referencia: "Depósito futuro confirmado",
    observacao: "Recebimento programado sem boleto bancário."
  },
  {
    id: "outro_recebivel_1",
    id_pagamento: "PG-CR-0014",
    id_int: 16911,
    os_ideal: "OS-OUT-3002",
    id_cliente: 771008,
    cliente: "Associação Atlética Rio Verde",
    documento: "44555666000110",
    empresa: "Ideal Grafica",
    id_empresa: 1,
    tipo: "OUTRO_RECEBIVEL",
    status: "A_VENCER",
    valor: 1250,
    vencimento: "2026-06-11",
    confirmado: false,
    referencia: "Recebível aprovado",
    observacao: "Recebível manual mockado para agenda financeira."
  }
];

export function getRecebivelStatusTone(status: RecebivelStatus | RecebimentoOperacionalStatus): StatusTone {
  if (status === "PAID") return "success";
  if (status === "A_VENCER") return "warning";
  if (status === "A_RECEBER") return "info";
  return "neutral";
}

export function getTipoRecebivelLabel(tipo: RecebivelTipo | RecebimentoOperacionalTipo) {
  const labels: Record<string, string> = {
    PIX: "PIX",
    BOLETO: "Boleto",
    CREDIT_CARD: "Cartão de crédito",
    CARD_PARCELADO: "Cartão de crédito",
    "E-FATURADO": "Faturado",
    DEPOSITO: "Depósito futuro",
    CARTAO: "Cartão",
    OUTRO_RECEBIVEL: "Outro recebível"
  };

  return labels[tipo] ?? tipo;
}
