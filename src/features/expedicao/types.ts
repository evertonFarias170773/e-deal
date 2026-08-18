import type { PesoOrigem as PesoOrigemInterna } from "./lib/peso";

/** Categorias canônicas derivadas do texto livre de cotacao_frete.servico. */
export type TipoFreteNormalizado =
  | "CORREIOS"
  | "MOTOBOY"
  | "TRANSPORTADORA"
  | "RETIRA_BALCAO"
  | "SEM_CUSTO"
  | "INDEFINIDO";

/** Etapa do funil logístico, derivada de propostas.status_interno. */
export type EtapaExpedicao =
  | "PRODUCAO"
  | "ACABAMENTO"
  | "PRONTO"
  | "A_RETIRAR"
  | "EM_TRANSITO"
  | "ENTREGUE";

export type NfStatusExpedicao = "AUTORIZADA" | "PENDENTE" | "SEM_NF";

// Origem do peso exibido — a precedência vive em lib/peso.ts, fonte única.
export type { PesoOrigem } from "./lib/peso";

/** Linha de public.expedicoes (execução da expedição), em camelCase. */
export interface ExpedicaoRegistro {
  idInt: number;
  tipoFrete: TipoFreteNormalizado | null;
  transportadoraNome: string | null;
  idTransportadoraCliente: number | null;
  pesoKg: number | null;
  /** expedicoes.peso_bruto_kg — bruto com embalagem, gravado pela Revisão do boletim. */
  pesoBrutoKg: number | null;
  qtdVolumes: number | null;
  tipoVolume: string | null;
  idEnderecoEntrega: string | null;
  codigoRastreamento: string | null;
  correiosIdPrepostagem: string | null;
  correiosCodigoObjeto: string | null;
  dataPronto: string | null;
  dataDespacho: string | null;
  dataEntrega: string | null;
  despachadoPor: string | null;
  retiradoPor: string | null;
  obs: string | null;
  /** Última geração da etiqueta interna 10x15 (ISO) — gravada pela rota da etiqueta. */
  etiquetaImpressaEm: string | null;
}

/** Item do painel de Expedição (projeção sobre 6 tabelas — ver expedicao.service). */
export interface PedidoExpedicao {
  idInt: number;
  cliente: string;
  idCliente: number | null;
  cidadeUf: string;
  empresa: string;
  statusInterno: string;
  etapa: EtapaExpedicao;
  /** propostas_os.data_termino (ISO) — a promessa exibida. */
  dataPromessa: string | null;
  /** Dias de atraso (0 = em dia). Só conta para etapa != ENTREGUE. */
  atrasadoDias: number;
  prometidoHoje: boolean;
  /** expedicoes.tipo_frete (definido no despacho) > normalização da cotação. */
  tipoFrete: TipoFreteNormalizado;
  /** Texto cru do serviço cotado (ex: "SEDEX", "FRETE INCLUSO"). */
  freteServico: string;
  /** CEP da cotação escolhida — usado no default do endereço de entrega. */
  freteCep: string | null;
  /** Nome resolvido: expedicoes.transportadora_nome > cotação. */
  transportadoraNome: string;
  freteValor: number | null;
  pesoKg: number | null;
  pesoOrigem: PesoOrigemInterna | null;
  volumes: number | null;
  nfStatus: NfStatusExpedicao;
  nfNumero: string | null;
  liberaNf: boolean;
  codigoRastreamento: string;
  obsOs: string;
  /** Já existe etiqueta/rastreio para o envio: prepostagem Correios OU rastreio OU 10x15 gerada. */
  etiquetaGerada: boolean;
  expedicao: ExpedicaoRegistro | null;
}
