import type { PesoOrigem as PesoOrigemInterna } from "./lib/peso";

/**
 * Modalidade comercial do frete — QUEM PAGA o transporte.
 *
 * Dimensão distinta de `TipoFreteNormalizado`, que diz POR ONDE VAI: um envio
 * pode ser FOB via Braspress ou CIF via Correios. Declarada pelo expedidor no
 * despacho e gravada em `expedicoes.modalidade_frete`.
 *
 * NESTA FASE, `CIF` é apenas RÓTULO: declara que o transporte corre por conta
 * da empresa e libera os Correios no passo 2 do despacho. Não cota, não
 * recota, não altera valor da proposta e não lança nada na Conta Corrente —
 * isso depende da fase de recotação (Parte C do plano), ainda em decisão.
 */
export type ModalidadeFrete = "RETIRA" | "FOB" | "CIF";

/** Modalidades que o despacho oferece, na ordem de exibição. */
export const MODALIDADES_OFERECIDAS: ModalidadeFrete[] = ["RETIRA", "FOB", "CIF"];

export const LABEL_MODALIDADE: Record<ModalidadeFrete, string> = {
  RETIRA: "Retira no balcão",
  FOB: "FOB — por conta do cliente",
  CIF: "CIF — por conta da empresa"
};

/** Categorias canônicas derivadas do texto livre de cotacao_frete.servico. */
export type TipoFreteNormalizado =
  | "CORREIOS"
  | "MOTOBOY"
  | "TRANSPORTADORA"
  | "RETIRA_BALCAO"
  | "SEM_CUSTO"
  | "INDEFINIDO";

/**
 * Transportes oferecidos em cada modalidade de ENVIO. `RETIRA` não aparece
 * aqui: não há transporte a escolher, o submit força `RETIRA_BALCAO`.
 *
 * CORREIOS só existe em CIF — a prepostagem sai pelo cartão de postagem da
 * empresa, e em FOB quem posta é o cliente, com contrato próprio.
 *
 * `SEM_CUSTO` e `INDEFINIDO` continuam na union (98 cotações vivas os produzem
 * e o painel precisa exibi-los), mas não são escolhíveis no despacho.
 */
export const TRANSPORTES_POR_MODALIDADE: Record<"FOB" | "CIF", TipoFreteNormalizado[]> = {
  FOB: ["TRANSPORTADORA", "MOTOBOY"],
  CIF: ["CORREIOS", "TRANSPORTADORA", "MOTOBOY"]
};

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
  /** expedicoes.modalidade_frete — quem paga (nula em linhas anteriores a 18/08/2026). */
  modalidadeFrete: ModalidadeFrete | null;
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
  /**
   * `propostas.id_faturado` — o PAGADOR, quando difere do cliente. Entrou em
   * 24/08/2026 para o modal Despachar poder oferecer tambem os enderecos dele:
   * ha entrega que vai para endereco do pagador, e ate aqui esse endereco nao
   * aparecia na lista. Null quando a proposta nao registra pagador proprio.
   */
  idFaturado: number | null;
  cidadeUf: string;
  empresa: string;
  /**
   * `propostas.vendedor` — quem vendeu o pedido. Vive na MESMA linha que a lista
   * já lê; entra aqui para a bancada saber a quem perguntar sem abrir o pedido.
   * Vazio quando a proposta não registrou vendedor.
   */
  vendedor: string;
  /**
   * Soma de `propostas_os_setores.peso_real_kg` de TODOS os setores da OS — o
   * que cada setor pesou na balança durante a Revisão do boletim.
   *
   * É a origem do "Peso aferido" no despacho: peso medido, não estimado. Difere
   * de `expedicoes.peso_bruto_kg` (bruto do pedido inteiro, também da Revisão) e
   * das fontes de `lib/peso.ts`, que incluem cotado e teórico.
   *
   * `null` quando NENHUM setor tem peso — soma de zero medições não é zero quilo.
   * Setor sem peso apenas não entra na soma; `setoresSemPesoReal` conta quantos
   * ficaram de fora, para a tela poder dizer que o número está incompleto.
   */
  pesoRealSetoresKg: number | null;
  /** Quantos setores da OS estão sem `peso_real_kg`. 0 = soma completa. */
  setoresSemPesoReal: number;
  statusInterno: string;
  etapa: EtapaExpedicao;
  /** propostas_os.data_termino (ISO) — a promessa exibida. */
  dataPromessa: string | null;
  /** Dias de atraso (0 = em dia). Só conta para etapa != ENTREGUE. */
  atrasadoDias: number;
  prometidoHoje: boolean;
  /** expedicoes.tipo_frete (definido no despacho) > normalização da cotação. */
  tipoFrete: TipoFreteNormalizado;
  /**
   * `propostas.modalidade_frete` — o que o VENDEDOR declarou na aba Fretes do
   * orçamento. Nunca vence a declaração do expedidor (`expedicoes.modalidade_frete`):
   * serve para pré-selecionar o despacho e para mostrar divergência.
   */
  modalidadeOrcamento: ModalidadeFrete | null;
  /** `propostas.id_transportadora_cliente` — transportadora definida no orçamento. */
  idTransportadoraOrcamento: number | null;
  /** Texto cru do serviço cotado (ex: "SEDEX", "FRETE INCLUSO"). */
  freteServico: string;
  /** CEP da cotação escolhida — usado no default do endereço de entrega. */
  freteCep: string | null;
  /** Nome resolvido: expedicoes.transportadora_nome > cotação. */
  transportadoraNome: string;
  freteValor: number | null;
  pesoKg: number | null;
  pesoOrigem: PesoOrigemInterna | null;
  /**
   * `cotacao_frete.peso` da linha escolhida, em gramas — o peso que ORIGINOU o
   * frete cobrado. Exposto para o despacho poder confrontar com o peso aferido
   * (lib/divergencia-frete-despacho.ts); a precedencia de `pesoKg` nao muda.
   */
  pesoCotadoGramas: number | null;
  /**
   * Ultima recotacao APLICADA (expedicao_recotacoes), quando houver. Passa a ser
   * a "cotacao vigente" para comparar peso e destino no despacho: aplicar uma
   * recotacao nao altera `cotacao_frete`, que e imutavel para a Expedicao — sem
   * isto o bloqueio de divergencia nunca limparia.
   */
  recotacaoVigente: { pesoGramas: number | null; cep: string | null } | null;
  /**
   * O despacho foi CONFIRMADO, ou o que esta em `expedicoes` e rascunho?
   *
   * Marcador = `expedicoes.data_despacho IS NOT NULL`. Nao ha coluna propria:
   * so `despachar()` escreve essa data, e ela ja e a fonte da `etapa`. Uma
   * coluna nova seria uma segunda verdade sobre o mesmo fato, livre para
   * divergir. Ver EXPEDICAO.md secao 2.2.
   *
   * Rascunho alimenta a PRECEDENCIA DE PESO e a divergencia de frete (peso real
   * medido, e o expedidor precisa pedir liberacao com os dados persistidos),
   * mas NAO alimenta transporte na lista, na visao por transportadora nem na
   * etiqueta — la vale o estado confirmado.
   */
  despachoConfirmado: boolean;
  volumes: number | null;
  /**
   * Liberacao ATIVA da recotacao de frete (Parte C). Null = bloqueado: o
   * expedidor nao recota por conta propria, um admin libera caso a caso pelo
   * menu Acoes. E de uso unico — a aplicacao consome. Vem carregada com a
   * lista, para o menu e o modal lerem a mesma fonte.
   */
  liberacaoRecotacao: { id: number; liberadoEm: string; liberadoPorNome: string | null } | null;
  nfStatus: NfStatusExpedicao;
  nfNumero: string | null;
  liberaNf: boolean;
  codigoRastreamento: string;
  obsOs: string;
  /** Já existe etiqueta/rastreio para o envio: prepostagem Correios OU rastreio OU 10x15 gerada. */
  etiquetaGerada: boolean;
  expedicao: ExpedicaoRegistro | null;
}
