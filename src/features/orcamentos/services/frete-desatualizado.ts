/**
 * O frete cotado ainda vale para o peso atual da proposta?
 *
 * POR QUE ISSO EXISTE
 *   O frete é cotado na aba Fretes, para um peso. Depois disso a quantidade
 *   dos itens pode mudar — e vai mudar mais, quando a montagem do pedido
 *   passar a ser feita pela aba Pedido. O valor do frete NÃO acompanha: ele
 *   fica congelado no que foi cotado. Cobrar do cliente um frete calculado
 *   para outro peso é prejuízo silencioso, para um lado ou para o outro.
 *   Decisão do dono: não recalcular sozinho, e sim impedir a GERAÇÃO DA
 *   COBRANÇA até o frete ser refeito na aba Fretes.
 *
 * O QUE NÃO BLOQUEIA, E POR QUÊ
 *   As duas exceções vêm dos dados, não de teoria. Em 13/08/2026 havia 1.871
 *   cotações escolhidas na base: 1.217 com valor zero e 1.196 sem peso
 *   registrado. Bloquear qualquer uma das duas transformaria o alerta em
 *   ruído diário sobre frete que não custa nada, ou travaria todo o histórico
 *   anterior à correção que passou a gravar o peso cotado.
 *
 * Sem I/O de propósito: a rota lê o banco e a tela decide o que mostrar, as
 * duas a partir daqui.
 */

/**
 * Diferença abaixo disto é arredondamento, não mudança de pedido.
 *
 * As duas pontas não têm a mesma precisão: a cotação grava o peso em gramas
 * INTEIRAS (1.717 das 1.874 cotações escolhidas), enquanto o peso do item é
 * fracionário (peso_uni × qtd). Comparar com tolerância zero bloqueava 15 das
 * 26 propostas divergentes por MENOS DE UM GRAMA — e em 12 delas o modal
 * mostrava o mesmo número dos dois lados ("269 g na cotação, 269 g agora"),
 * sem nada para o usuário corrigir. Como a âncora é no máximo o arredondamento
 * para cima do total, 1 grama cobre exatamente esse ruído: uma mudança real de
 * pedido move centenas de gramas.
 */
const TOLERANCIA_GRAMAS = 1;

export type MotivoFreteCobranca =
  | "EM_DIA"
  | "SEM_COTACAO"
  | "FRETE_SEM_CUSTO"
  | "SEM_ANCORA"
  | "SEM_ITENS"
  | "PESO_DIVERGENTE";

export type SituacaoFreteCobranca = {
  /** Impede gerar cobrança? Só `PESO_DIVERGENTE` impede. */
  bloqueia: boolean;
  motivo: MotivoFreteCobranca;
  /** Peso com que o frete foi cotado, em gramas. Null quando não há âncora. */
  pesoCotadoGramas: number | null;
  /** Peso atual da proposta, em gramas. */
  pesoAtualGramas: number;
  /** Positivo = pedido ficou mais pesado que o cotado. */
  diferencaGramas: number;
  valorFrete: number;
  servico: string | null;
};

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export function formatarPesoGramas(gramas: number): string {
  if (Math.abs(gramas) < 1000) return `${Math.round(gramas)} g`;
  const kg = gramas / 1000;
  return `${kg.toFixed(kg >= 100 ? 0 : 1).replace(".", ",")} kg`;
}

export function avaliarFreteParaCobranca(entrada: {
  /** `cotacao_frete.peso` da linha escolhida. */
  pesoCotadoGramas: number | null | undefined;
  /** Soma de `produtos_proposta.peso_total` dos itens não cancelados. */
  pesoAtualGramas: number | null | undefined;
  /** `cotacao_frete.valor` da linha escolhida. */
  valorFrete: number | null | undefined;
  servico?: string | null;
  /** Existe linha escolhida em `cotacao_frete`? */
  temCotacao: boolean;
  /** A proposta tem ao menos um item ativo? Sem item não há peso a comparar. */
  temItens: boolean;
}): SituacaoFreteCobranca {
  const pesoAtual = numero(entrada.pesoAtualGramas);
  const valorFrete = numero(entrada.valorFrete);
  const pesoCotadoBruto = numero(entrada.pesoCotadoGramas);
  const pesoCotado = pesoCotadoBruto > 0 ? pesoCotadoBruto : null;

  const base = {
    pesoCotadoGramas: pesoCotado,
    pesoAtualGramas: pesoAtual,
    diferencaGramas: pesoCotado === null ? 0 : Math.round((pesoAtual - pesoCotado) * 100) / 100,
    valorFrete,
    servico: entrada.servico ?? null
  };

  // Proposta sem frete escolhido: não há o que comparar, e o próprio fluxo de
  // salvamento já exige frete antes de fechar o orçamento.
  if (!entrada.temCotacao) {
    return { ...base, bloqueia: false, motivo: "SEM_COTACAO" };
  }

  // Frete sem custo (retirada no balcão, incluso, por conta da empresa): o
  // peso não muda o que o cliente paga.
  if (valorFrete === 0) {
    return { ...base, bloqueia: false, motivo: "FRETE_SEM_CUSTO" };
  }

  // Cotação anterior à gravação do peso cotado: não dá para saber se mudou.
  // Não inventar divergência — bloquear aqui travaria o histórico inteiro.
  if (pesoCotado === null) {
    return { ...base, bloqueia: false, motivo: "SEM_ANCORA" };
  }

  // Proposta sem item ativo pesa zero, e zero contra qualquer âncora pareceria
  // divergência máxima. Não é: é proposta que ainda não tem produto, estado
  // que o salvamento trata explicitamente para não derrubar o saldo da
  // cobrança que o usuário está tentando gerar. Além disso não teria saída —
  // a aba Fretes desabilita a recotação justamente quando não há peso.
  if (!entrada.temItens) {
    return { ...base, bloqueia: false, motivo: "SEM_ITENS" };
  }

  if (Math.abs(base.diferencaGramas) >= TOLERANCIA_GRAMAS) {
    return { ...base, bloqueia: true, motivo: "PESO_DIVERGENTE" };
  }

  return { ...base, bloqueia: false, motivo: "EM_DIA" };
}

/** Texto do modal de bloqueio. Fala de peso e de dinheiro, não de tabela. */
export function mensagemFreteDesatualizado(situacao: SituacaoFreteCobranca): string {
  if (situacao.motivo !== "PESO_DIVERGENTE" || situacao.pesoCotadoGramas === null) {
    return "";
  }
  const direcao = situacao.diferencaGramas > 0 ? "mais pesado" : "mais leve";
  const servico = situacao.servico ? ` (${situacao.servico})` : "";
  return (
    `O pedido está ${direcao} do que foi cotado: ` +
    `${formatarPesoGramas(situacao.pesoCotadoGramas)} na cotação, ` +
    `${formatarPesoGramas(situacao.pesoAtualGramas)} agora. ` +
    `O frete de R$ ${situacao.valorFrete.toFixed(2).replace(".", ",")}${servico} ` +
    "foi calculado para o peso antigo. Atualize o frete na aba Fretes antes de gerar a cobrança."
  );
}
