import type { PesoOrigem as PesoOrigemInterna } from "./lib/peso";
import type { CategoriaFrete } from "@/features/orcamentos/lib/categoria-frete";

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
  /** `expedicoes.categoria_frete` — o que o expedidor registrou. */
  categoriaFrete: CategoriaFrete | null;
  transportadoraNome: string | null;
  idTransportadoraCliente: number | null;
  pesoKg: number | null;
  /** expedicoes.peso_bruto_kg — bruto com embalagem, gravado pela Revisão do boletim. */
  pesoBrutoKg: number | null;
  qtdVolumes: number | null;
  tipoVolume: string | null;
  idEnderecoEntrega: string | null;
  codigoRastreamento: string | null;
  /**
   * `clientes.id_cliente` em nome de quem a etiqueta sai, escolhido no despacho
   * quando o pagador difere do cliente. Nulo = cliente da proposta.
   */
  idClienteDestinatarioEtiqueta: number | null;
  correiosIdPrepostagem: string | null;
  correiosCodigoObjeto: string | null;
  /**
   * Quando o cancelamento da prepostagem foi MARCADO no ERP (o cancelamento em
   * si acontece no portal dos Correios). Preenchido = o objeto nao vale mais:
   * a tela esconde rastreio, etiqueta oficial e rastreamento, e a geracao de
   * uma nova prepostagem fica liberada.
   */
  prepostagemCanceladaEm: string | null;
  /**
   * Prepostagem da geracao ANTERIOR, preservada quando uma nova e criada.
   * Preenchida = ja houve pelo menos uma regeracao. NAO limita novas geracoes:
   * desde 24/08/2026 nao ha teto, e cada nova sobrescreve estas duas colunas.
   * Sao elas que o modal Despachar mostra na confirmacao, para o operador copiar
   * o codigo antes de ele sumir do registro.
   */
  correiosIdPrepostagemAnterior: string | null;
  /** correios_codigo_objeto_anterior — o rastreio da geracao anterior. */
  correiosCodigoObjetoAnterior: string | null;
  dataPronto: string | null;
  dataDespacho: string | null;
  /**
   * `expedicoes.coletado_em` — quando a transportadora/motoboy retirou o volume
   * (02/09/2026). Nula com `data_despacho` preenchida, status `EXPEDICAO` e
   * transporte `TRANSPORTADORA`/`MOTOBOY` significa **aguardando coleta**.
   * Correios e retirada não usam: a postagem e a retirada já são a saída.
   */
  coletadoEm: string | null;
  dataEntrega: string | null;
  despachadoPor: string | null;
  retiradoPor: string | null;
  obs: string | null;
  /** `expedicoes.obs_etiqueta` — o texto IMPRESSO no volume. Distinto de `obs`. */
  obsEtiqueta: string | null;
  /** `expedicoes.nf_numero_manual` — fallback; `notas_fiscais.numero_nf` vence. */
  nfNumeroManual: string | null;
  /**
   * `expedicoes.telefone_etiqueta` NÃO é lida (04/09/2026). A coluna existe no
   * banco — houve um campo de telefone editável por remessa, removido por
   * decisão do dono — e ficou lá, sem leitura nem escrita, com todas as linhas
   * nulas. O telefone impresso vem do cadastro, por
   * `lib/telefone-destinatario.ts`.
   */
  /** Última geração da etiqueta interna 10x15 (ISO) — gravada pela rota da etiqueta. */
  etiquetaImpressaEm: string | null;
}

/**
 * CPF/CNPJ e telefone de um dos cadastros que podem receber o volume.
 *
 * Ambos já formatados para exibição — a máscara vive em `lib/formatters`, e
 * quem consome só imprime. Strings vazias quando o cadastro não tem o dado.
 */
export interface ContatoDestinatario {
  /** `clientes.documento`, mascarado como CPF ou CNPJ conforme o tamanho. */
  documento: string;
  /** `clientes.whatsapp_1` › `telefone_fixo`, mesma preferência da etiqueta. */
  telefone: string;
}

/** Item do painel de Expedição (projeção sobre 6 tabelas — ver expedicao.service). */
export interface PedidoExpedicao {
  idInt: number;
  cliente: string;
  /**
   * Nome CURTO do cliente — `clientes.fantasia` quando existe, senão o mesmo
   * `cliente` acima (02/09/2026).
   *
   * Existe separado de `cliente` de propósito: aquele é a RAZÃO gravada em
   * `propostas.cliente`, que a lista, a busca e os documentos continuam usando.
   * Este é só EXIBIÇÃO, para o card do Kanban, onde "LISITON DOCUMENTOS
   * SEGUROS LTDA" ocupa duas linhas e "DSEG IMPRESSOS" ocupa meia — e é o nome
   * pelo qual a bancada conhece o cliente.
   *
   * Zero consulta a mais: `fantasia` já vem no MESMO `in` de `clientes` que a
   * lista já fazia, ao lado de `nome` e `cidade_uf`.
   */
  clienteExibicao: string;
  /**
   * O ENDEREÇO DE ENTREGA QUE VALE, já resolvido (02/09/2026).
   *
   * Precedência, e o porquê de cada degrau:
   *   1. despacho CONFIRMADO → `expedicoes.id_endereco_entrega`. O que já saiu
   *      não se reescreve: é o endereço que foi para a etiqueta e para a
   *      prepostagem, e o despacho é soberano no resto do módulo inteiro;
   *   2. senão → `propostas.id_endereco_ent`, o endereço definido na PROPOSTA.
   *
   * `null` = a proposta não definiu endereço e não há despacho. O modal
   * Despachar mostra aviso e bloqueia, coerente com `camposMinimosDespacho`,
   * que já exigia `idEnderecoEntrega`.
   *
   * Resolvido no pipeline da lista, num `in` de `enderecos` — nenhuma consulta
   * por linha. Substituiu o SELECT do modal, que listava também os endereços do
   * pagador e deixava o expedidor escolher: trocar endereço é operação da
   * proposta, não da expedição.
   */
  enderecoEntrega: {
    id: string;
    /** "Rua X, 123 - Bairro - Cidade/UF (CEP 00000-000)" — pronto para exibir. */
    rotulo: string;
    cep: string | null;
    /**
     * "Santarém/PA" — a cidade PARA ONDE O VOLUME VAI (03/09/2026).
     *
     * Distinta de `cidadeUf` do pedido, que é do CADASTRO do cliente. Nos 18
     * pedidos do 8469 o cadastro diz "Santa Cruz do Sul - RS" e a entrega vai
     * para Santarém/PA, Goiânia/GO, Porto Velho/RO — o card mostrava a primeira
     * e a etiqueta imprimia a segunda.
     *
     * Zero consulta a mais: `cidade` e `uf` já vinham no `in` de `enderecos`,
     * consumidas só para montar o `rotulo` acima.
     */
    cidadeUf: string;
    /** De onde veio, para a interface poder explicar. */
    origem: "PROPOSTA" | "DESPACHO";
  } | null;
  idCliente: number | null;
  /**
   * `propostas.id_faturado` — o PAGADOR, quando difere do cliente. Entrou em
   * 24/08/2026 para o modal Despachar poder oferecer tambem os enderecos dele:
   * ha entrega que vai para endereco do pagador, e ate aqui esse endereco nao
   * aparecia na lista. Null quando a proposta nao registra pagador proprio.
   */
  idFaturado: number | null;
  /**
   * Nome do PAGADOR, e vazio quando quem paga e o proprio cliente do pedido.
   *
   * Existe para a coluna do cliente poder dizer quem paga sem abrir o pedido: e
   * o pagador que recebe o documento fiscal, e ate 24/08/2026 a lista nao dava
   * como perceber que ele era outro. Resolvido no MESMO `in` de `clientes` que
   * a lista ja fazia — sem consulta a mais.
   */
  pagador: string;
  /**
   * Contato dos DOIS destinatários possíveis (02/09/2026).
   *
   * O modal Despachar exibe CPF/CNPJ e telefone ao lado do endereço, e quem
   * recebe pode ser o cliente OU o pagador — a escolha é do drop "Em nome de
   * quem sai a etiqueta" e muda sem recarregar. Por isso os dois vêm juntos:
   * trocar o destinatário troca o contato exibido na hora, sem ida ao banco.
   *
   * `contatoPagador` é `null` quando não há pagador distinto — mesma condição
   * de `temPagadorDistinto` que governa o drop.
   *
   * Zero consulta a mais: as três colunas entraram no `in` de `clientes` que a
   * lista já fazia.
   */
  contatoCliente: ContatoDestinatario;
  contatoPagador: ContatoDestinatario | null;
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
  /**
   * Dias de atraso (0 = em dia).
   *
   * Conta apenas enquanto o pedido está com a Expedição: para em `ENTREGUE` e,
   * desde 25/08/2026, também no DESPACHO — com `expedicoes.data_despacho`
   * preenchida a contagem congela em 0. `data_termino` mede a promessa da
   * PRODUÇÃO; depois que a mercadoria sai, o relógio que corre é o da
   * transportadora, que este campo não mede.
   */
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
  /**
   * O pedido foi entregue dentro da janela do CARD "Entregues" (7 dias).
   *
   * NAO se confunde com estar no painel: a permanencia e de 30 dias, e as duas
   * janelas sao diferentes de proposito — ver o cabecalho das constantes em
   * `expedicao.service.ts`. Falso para tudo que nao e ENTREGUE e para entregue
   * sem `data_entrega`.
   */
  entregueNaJanelaDoCard: boolean;
  /**
   * A CATEGORIA QUE VALE, ja resolvida por `categoriaFreteVigente` no service:
   * o despacho confirmado vence, senao a proposta, senao o rascunho. O painel
   * NAO reaplica precedencia — ela mora num lugar so.
   *
   * `null` = nao classificada, e o painel a exibe em EXTRAS.
   */
  categoriaFrete: CategoriaFrete | null;
  /** `propostas.id_transportadora_cliente` — transportadora definida no orçamento. */
  idTransportadoraOrcamento: number | null;
  /** Texto cru do serviço cotado (ex: "SEDEX", "FRETE INCLUSO"). */
  freteServico: string;
  /** CEP da cotação escolhida — usado no default do endereço de entrega. */
  freteCep: string | null;
  /** Nome resolvido: expedicoes.transportadora_nome > cotação. */
  transportadoraNome: string;
  /**
   * O que a coluna FRETE escreve. Só exibição — a regra e o porquê de cada
   * degrau estão em `expedicao.service.ts`, onde ele é montado.
   *
   * Existe separado de `transportadoraNome` de propósito: aquele alimenta o
   * agrupamento "Por transportadora", a busca textual e o pré-preenchimento do
   * DespacharModal, e mudá-lo mexeria nos três.
   *
   * Nunca vazio: o último degrau é `labelTipoFrete`, que já devolve "A definir".
   */
  rotuloTransporte: string;
  freteValor: number | null;
  /**
   * `propostas.valor_frete` — o que a proposta cobra hoje, e o que o card do
   * Kanban exibe. `freteValor` acima e o valor COTADO (`cotacao_frete.valor`),
   * que a recotacao nao atualiza. Ver o comentario em `expedicao.service.ts`.
   */
  freteCobrado: number | null;
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
  /**
   * AGUARDANDO COLETA — estado DERIVADO, não status (02/09/2026, Etapa 7).
   *
   * `data_despacho` preenchida + `coletado_em` nula + etapa `PRONTO` (status
   * `EXPEDICAO`) + transporte `TRANSPORTADORA` ou `MOTOBOY`. O volume está
   * rotulado, na casa, esperando o carro.
   *
   * Não existe `status_interno` novo: o pedido segue em `EXPEDICAO`, um status
   * que as dez funções do banco já conhecem, e `confirmarColeta` o leva a
   * `EM TRANSITO` pelo `transicionar` de sempre.
   *
   * Derivado UMA VEZ, aqui no pipeline: a cor do card, a ação primária e o card
   * "Pronto p/ expedir" leem este campo, nunca recalculam a condição.
   */
  aguardandoColeta: boolean;
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
