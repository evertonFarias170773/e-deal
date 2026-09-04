import type { ModalidadeFrete, PedidoExpedicao, TipoFreteNormalizado } from "../types";

/** Ordem de exibição no select de filtro da tela. */
export const TIPOS_FRETE: TipoFreteNormalizado[] = [
  "CORREIOS",
  "MOTOBOY",
  "TRANSPORTADORA",
  "RETIRA_BALCAO",
  "SEM_CUSTO",
  "INDEFINIDO"
];

const LABELS: Record<TipoFreteNormalizado, string> = {
  CORREIOS: "Correios",
  MOTOBOY: "Motoboy",
  TRANSPORTADORA: "Transportadora",
  RETIRA_BALCAO: "Retira balcão",
  SEM_CUSTO: "Sem custo",
  INDEFINIDO: "A definir"
};

export function labelTipoFrete(tipo: TipoFreteNormalizado): string {
  return LABELS[tipo];
}

/**
 * Normaliza o texto LIVRE de cotacao_frete.servico nas categorias canônicas.
 * Vocabulário levantado do banco em 15/08/2026: SEDEX(490), FRETE INCLUSO(1077),
 * SEM CUSTO(97), MOTOBOY(69), SÃO MIGUEL(28), AZUL ECOMM/ECOMM/AZUL(34),
 * VEPPO/VEPPO-RS(23), RETIRA*(25), UNESUL(5), BRASPRESS/BRASPESS(3), TROCA(2),
 * TRANSPORTADORA PARCEIRA(5) e lixo ("12", "AS", "DD", "NÃO", "FRETE"...).
 * "RETIRA" antes de "TRANSPORTADORA"; acentos são removidos antes do match.
 * IMPORTANTE: "SEM CUSTO" é envio grátis, NÃO retirada (corrige a heurística
 * antiga da tela, que jogava SEM CUSTO em retirada local).
 */
export function normalizarTipoFrete(
  servico: string | null | undefined
): TipoFreteNormalizado {
  const s = (servico ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!s) return "INDEFINIDO";
  if (/(^|[^A-Z])(SEDEX|PAC)([^A-Z]|$)/.test(s)) return "CORREIOS";
  if (s.includes("MOTOBOY")) return "MOTOBOY";
  if (s.includes("RETIRA") || s.includes("BALCAO")) return "RETIRA_BALCAO";
  if (s.includes("SEM CUSTO")) return "SEM_CUSTO";
  if (
    s.includes("SAO MIGUEL") ||
    s.includes("UNESUL") ||
    s.includes("BRASPRESS") ||
    s.includes("BRASPESS") ||
    s.includes("AZUL") ||
    s.includes("ECOMM") ||
    s.includes("VEPPO") ||
    s.includes("TROCA") ||
    s.includes("TRANSPORTADORA")
  ) {
    return "TRANSPORTADORA";
  }
  return "INDEFINIDO";
}

/**
 * Modalidade com que o modal de despacho ABRE.
 *
 * PRECEDÊNCIA, e o porquê de cada degrau:
 *   1. `expedicoes.modalidade_frete` DE DESPACHO CONFIRMADO — o que o expedidor
 *      declarou na bancada quando o volume saiu. Soberana: é o que de fato
 *      aconteceu.
 *   2. Cotação `RETIRA_BALCAO` — a mercadoria é buscada no balcão, então não há
 *      transporte para ninguém pagar. Vence a modalidade do orçamento, EXCETO
 *      quando ela é FOB.
 *   3. `propostas.modalidade_frete` — o que o vendedor declarou.
 *   4. `expedicoes.modalidade_frete` AINDA EM RASCUNHO — só como último recurso.
 *   5. nada, e o modal exige escolha explícita.
 *
 * POR QUE O DEGRAU 1 EXIGE DESPACHO CONFIRMADO (04/09/2026)
 *   A linha de `expedicoes` nasce muito antes do despacho: `marcarPronto` já a
 *   cria, e ela vai sendo preenchida enquanto o volume está na bancada. Até o
 *   despacho ser confirmado ela é RASCUNHO — uma pré-seleção, não um fato.
 *
 *   Tratá-la como soberana desde o nascimento congelava a modalidade: o pedido
 *   21000 foi corrigido de RETIRA para FOB na proposta, com transportadora SVT
 *   declarada, e o modal seguia abrindo em "Retira no balcão" porque o rascunho
 *   dizia RETIRA. Pior, sem saída: a modalidade virou somente leitura no
 *   despacho (03/09/2026), então não havia como corrigir o resíduo pela tela.
 *   E confirmar assim não era só cosmético — `tipoEntrega` sai da modalidade, e
 *   RETIRA força `RETIRA_BALCAO`, `transportadora_nome = "Retira balcão"`,
 *   `id_transportadora_cliente = null` e a transição para `A RETIRAR`.
 *
 *   Depois do despacho confirmado NADA MUDA: ali a linha deixou de ser rascunho
 *   e volta a ser soberana, que é o que a etiqueta, a declaração e a prepostagem
 *   de um pedido já despachado precisam.
 *
 *   O rascunho não é descartado, só rebaixado ao ÚLTIMO degrau: proposta sem
 *   modalidade e sem cotação de balcão continua abrindo com o que o rascunho
 *   tiver, e o modal não volta a exigir escolha onde hoje não exige. Medido em
 *   04/09/2026: ZERO pedidos nesse estado, e 6 rascunhos vivos no total.
 *
 * POR QUE O DEGRAU 2 VENCE O 3 (e como isso dispensa coluna nova)
 *   Desde 19/08/2026 o orçamento nasce em CIF por padrão. Sem o degrau 2, uma
 *   venda de balcão em que o vendedor não trocou a modalidade chegaria ao
 *   despacho pré-selecionada como CIF — e a inferência de RETIRA, que existia
 *   antes, nunca mais rodaria.
 *
 *   Distinguir "CIF escolhido" de "CIF por default" parece exigir uma coluna
 *   nova, mas não exige: RETIRA e FOB só existem por escolha explícita — nenhum
 *   dos dois é, ou pode ser, o padrão. CIF é o ÚNICO valor que chega sem alguém
 *   ter escolhido. Logo "CIF vindo do orçamento" já É o caso ambíguo, por
 *   construção do vocabulário, e tratá-lo como evidência mais fraca que uma
 *   cotação de balcão não perde informação nenhuma.
 *
 *   FOB fica de fora do degrau 2 de propósito: é sempre escolha deliberada, e
 *   carrega uma transportadora obrigatória junto. Sobrepor RETIRA a um FOB
 *   explícito descartaria uma decisão real do vendedor.
 *
 *   O limite, dito com todas as letras: um CIF escolhido a dedo numa venda de
 *   balcão também abre como RETIRA. É combinação contraditória — quem retira no
 *   balcão não tem frete para a empresa pagar — e continua sendo só uma
 *   pré-seleção, que o expedidor troca em um clique.
 */
export function modalidadeInicialDoDespacho(
  doDespacho: ModalidadeFrete | null | undefined,
  doOrcamento: ModalidadeFrete | null | undefined,
  tipoFreteCotado: TipoFreteNormalizado,
  /** `expedicoes.data_despacho` preenchida. Sem isto a linha é rascunho. */
  despachoConfirmado: boolean
): ModalidadeFrete | null {
  if (despachoConfirmado && doDespacho) return doDespacho;
  if (tipoFreteCotado === "RETIRA_BALCAO" && doOrcamento !== "FOB") return "RETIRA";
  return doOrcamento ?? doDespacho ?? null;
}

/** De onde saiu a modalidade que o modal exibe. */
export type OrigemModalidade = "DESPACHO" | "COTACAO_BALCAO" | "ORCAMENTO";

/**
 * Qual dos degraus de `modalidadeInicialDoDespacho` respondeu.
 *
 * Existe porque o modal parou de OFERECER a modalidade e passou a EXIBI-LA
 * (03/09/2026): mostrar "CIF" sem dizer quem decidiu deixaria o expedidor sem
 * saber onde reclamar. `null` quando ninguém decidiu — e aí, só aí, a tela
 * volta a oferecer os botões.
 *
 * NÃO REESCREVE A PRECEDÊNCIA: chama `modalidadeInicialDoDespacho` e apenas lê
 * de volta qual entrada bate com a saída. As fontes são três e só três, então a
 * leitura é exata — se a regra lá em cima mudar, esta função acompanha sozinha,
 * que é justamente o que duplicar os `if` não daria.
 *
 * Orçamento e cotação de balcão concordando (`RETIRA` nos dois) é creditado ao
 * ORÇAMENTO de propósito: quando as duas dizem o mesmo, a declaração do vendedor
 * é a atribuição útil para quem lê a tela.
 */
export function origemDaModalidadeInicial(
  doDespacho: ModalidadeFrete | null | undefined,
  doOrcamento: ModalidadeFrete | null | undefined,
  tipoFreteCotado: TipoFreteNormalizado,
  despachoConfirmado: boolean
): OrigemModalidade | null {
  const escolhida = modalidadeInicialDoDespacho(doDespacho, doOrcamento, tipoFreteCotado, despachoConfirmado);
  if (escolhida === null) return null;
  if (despachoConfirmado && doDespacho) return "DESPACHO";
  if (escolhida === doOrcamento) return "ORCAMENTO";
  // Sobrou o degrau do rascunho, abaixo do orçamento.
  if (escolhida === doDespacho) return "DESPACHO";
  return "COTACAO_BALCAO";
}

/**
 * "CORREIOS" AQUI É RESÍDUO DE COTAÇÃO, NÃO TRANSPORTE (02/09/2026).
 *
 * Sob **FOB** os Correios não são transporte possível — `TRANSPORTES_POR_MODALIDADE.FOB`
 * é `["TRANSPORTADORA", "MOTOBOY"]`, e a prepostagem sai pelo cartão da empresa,
 * que em FOB não se usa. Ainda assim o pedido guarda uma `cotacao_frete` com
 * serviço "SEDEX" e valor **zero**, gerada pelo Orçamento e nunca contratada.
 * `normalizarTipoFrete` classifica esse texto como `CORREIOS`, e quem decide
 * por `tipoFrete` acaba tratando o pedido como envio dos Correios.
 *
 * `despachoConfirmado` desliga a regra: com despacho confirmado, `tipoFrete` vem
 * de `expedicoes.tipo_frete`, que é a declaração do expedidor e é soberana.
 *
 * NÃO alcança CIF, onde os Correios são transporte legítimo, nem MOTOBOY e
 * RETIRA sob FOB, que são classificações válidas.
 *
 * NASCEU no agrupamento do Kanban (`e1855ed`) e subiu para cá quando o alerta de
 * troca de transporte do `DespacharModal` precisou do MESMO critério — a regra
 * mora num lugar só, e os dois chamadores leem daqui. **A lógica não mudou na
 * mudança de casa.** Cada chamador acrescenta as suas próprias guardas: o modal,
 * por exemplo, ainda exige que não haja prepostagem nem tipo declarado em
 * rascunho antes de silenciar o aviso.
 */
export function correiosResiduoDeCotacaoFob(p: PedidoExpedicao): boolean {
  return (
    p.tipoFrete === "CORREIOS" &&
    !p.despachoConfirmado &&
    p.modalidadeOrcamento === "FOB" &&
    p.idTransportadoraOrcamento !== null
  );
}
