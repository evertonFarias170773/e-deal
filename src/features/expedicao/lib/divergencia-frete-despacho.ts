import { avaliarFreteParaCobranca } from "@/features/orcamentos/services/frete-desatualizado";
import type { SituacaoFreteCobranca } from "@/features/orcamentos/services/frete-desatualizado";
import { normalizarTipoFrete } from "./tipo-frete";
import type { ModalidadeFrete, TipoFreteNormalizado } from "../types";

/**
 * O envio que esta sendo despachado ainda corresponde ao frete que a proposta
 * cobra? Desde 20/08/2026 esta pergunta BLOQUEIA o despacho, nao so avisa.
 *
 * TRES DIMENSOES
 *   1. TRANSPORTE  — o "COMO VAI" mudou em relacao ao que originou a cotacao;
 *   2. PESO        — aferido acima do cotado com margem SUPERIOR A 5%;
 *   3. DESTINO     — CEP de entrega diferente do que originou a cotacao.
 *
 *   Qualquer uma exige recotacao, que por sua vez depende de liberacao de um
 *   admin (secao 5.1 do EXPEDICAO.md). Peso MENOR que o cotado nunca bloqueia:
 *   a empresa nao perde dinheiro enviando mais leve do que cobrou.
 *
 * SO BLOQUEIA EM CIF
 *   Fora de CIF a recotacao nem existe — a rota `cotar` recusa pedido sem
 *   modalidade e recusa FOB e RETIRA. Bloquear ali prenderia o expedidor num
 *   pedido sem saida possivel: nao teria como recotar para destravar. Medido em
 *   20/08/2026, dois dos tres pedidos entao em EXPEDICAO estavam exatamente
 *   nessa situacao. Entao fora de CIF as tres dimensoes continuam sendo
 *   CALCULADAS e exibidas na faixa, mas nao travam o botao.
 *   Retirada no balcao cai aqui por consequencia: sem transporte contratado nao
 *   ha o que recotar, e a modalidade RETIRA nunca e CIF.
 *
 * A MARGEM DE 5% VALE SO AQUI
 *   `frete-desatualizado.ts` usa tolerancia de 1 g e bloqueia nos dois sentidos,
 *   porque no fluxo de cobranca qualquer divergencia contra a ancora importa.
 *   No despacho a pergunta e outra — "o frete cobrado ainda paga este envio?" —
 *   e a resposta tolera 5% para mais. O modulo de origem NAO e alterado: dele
 *   se reusa `avaliarFreteParaCobranca` apenas para saber se ha o que comparar
 *   (existe cotacao, existe ancora de peso, existe frete a defender).
 *
 * QUAL E A "COTACAO VIGENTE"
 *   `cotacao_frete` e imutavel para a Expedicao (secao 2 do EXPEDICAO.md): os
 *   tres triggers dela reescreveriam `valor_total` e `status_interno`. Aplicar
 *   uma recotacao NAO a altera — grava `propostas.valor_frete` e uma linha em
 *   `expedicao_recotacoes`. Por isso a referencia de peso e CEP e a ULTIMA
 *   recotacao aplicada quando houver, e so na falta dela a `cotacao_frete`. E o
 *   que faz "aplicar limpa o bloqueio" ser verdade, e nao so intencao.
 */

/** A referencia contra a qual o despacho e comparado. */
export type CotacaoVigente = {
  /** Peso que originou o frete cobrado, em gramas. */
  pesoGramas: number | null | undefined;
  /** CEP que originou o frete cobrado. */
  cep: string | null | undefined;
  /** `propostas.valor_frete` — o que a proposta cobra hoje. */
  valor: number | null | undefined;
  /** Texto do servico cotado (`cotacao_frete.servico`), para normalizar. */
  servico: string | null | undefined;
  /** Existe cotacao escolhida? */
  existe: boolean;
};

export type DivergenciaFreteDespacho = {
  /** Trava o botao "Confirmar despacho"? So verdadeiro em CIF. */
  bloqueia: boolean;
  /** Ha algo a exibir na faixa, bloqueando ou nao? */
  temAviso: boolean;
  /** Frases do que divergiu, para a tela e para a mensagem de recusa. */
  motivos: string[];
  /** Peso aferido excede o cotado em mais de 5%. */
  pesoExcedeuMargem: boolean;
  /** Quanto o aferido esta acima do cotado, em pontos percentuais. */
  percentualAcimaDoCotado: number | null;
  /** Veredito de `avaliarFreteParaCobranca` — usado so como porteiro. */
  peso: SituacaoFreteCobranca;
  cepMudou: boolean;
  cepCotado: string | null;
  cepDespacho: string | null;
  /** O transporte escolhido difere da referencia confiavel. */
  transporteMudou: boolean;
  /** A referencia usada. Null = nao ha referencia confiavel do que foi cotado. */
  transporteReferencia: TipoFreteNormalizado | null;
};

/** Margem tolerada para MAIS no peso. Acima disso, recotar. */
export const MARGEM_PESO_PARA_MAIS = 0.05;

/** Os unicos tipos que o despacho oferece — e portanto os unicos comparaveis. */
const TIPOS_COMPARAVEIS: TipoFreteNormalizado[] = ["CORREIOS", "MOTOBOY", "TRANSPORTADORA"];

const soDigitos = (v: string | null | undefined): string | null => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length > 0 ? d : null;
};

/**
 * De onde sai o "o que foi cotado" da dimensao TRANSPORTE.
 *
 * `expedicoes.tipo_frete` primeiro: num redespacho ou numa edicao ele e a
 * escolha explicita que ja foi feita, e nao ha ambiguidade.
 *
 * Na falta dele, o normalizado de `cotacao_frete.servico` — mas SO quando cair
 * num dos tres tipos que o despacho oferece. Medido em 20/08/2026: das 2.137
 * cotacoes escolhidas da base, 1.408 (66%) normalizam para INDEFINIDO,
 * SEM_CUSTO ou RETIRA_BALCAO, e `transporteInicial` do modal as converte em
 * TRANSPORTADORA ao abrir. Comparar contra isso acusaria "trocou o transporte"
 * em dois de cada tres pedidos sem ninguem ter tocado em nada — o texto da
 * cotacao e que era ambiguo, nao a escolha do expedidor. Sem referencia
 * confiavel, a dimensao nao bloqueia.
 */
export function referenciaTransporte(
  tipoFreteJaDespachado: TipoFreteNormalizado | null | undefined,
  servicoCotado: string | null | undefined
): TipoFreteNormalizado | null {
  if (tipoFreteJaDespachado) return tipoFreteJaDespachado;
  const normalizado = normalizarTipoFrete(servicoCotado ?? "");
  return TIPOS_COMPARAVEIS.includes(normalizado) ? normalizado : null;
}

export function divergenciaFreteDoDespacho(entrada: {
  cotacao: CotacaoVigente;
  /** Peso que o expedidor informou, em gramas. Null = nao informado. */
  pesoAferidoGramas: number | null | undefined;
  /** CEP do endereco de entrega selecionado no despacho. */
  cepDestino: string | null | undefined;
  /** Modalidade efetiva (despacho > orcamento). So CIF bloqueia. */
  modalidadeEfetiva: ModalidadeFrete | null;
  /** O "COMO VAI" selecionado agora. */
  tipoFreteEscolhido: TipoFreteNormalizado;
  /** `expedicoes.tipo_frete` ja gravado, quando houver. */
  tipoFreteJaDespachado?: TipoFreteNormalizado | null;
}): DivergenciaFreteDespacho {
  // Porteiro: existe cotacao, existe ancora de peso, existe frete a defender?
  // Reusa a semantica de `frete-desatualizado.ts` sem herdar a tolerancia dele.
  const peso = avaliarFreteParaCobranca({
    pesoCotadoGramas: entrada.cotacao.pesoGramas,
    pesoAtualGramas: entrada.pesoAferidoGramas,
    valorFrete: entrada.cotacao.valor,
    servico: entrada.cotacao.servico,
    temCotacao: entrada.cotacao.existe,
    temItens: entrada.pesoAferidoGramas !== null && entrada.pesoAferidoGramas !== undefined
  });

  // O porteiro decide se ha o que comparar. `EM_DIA` e `PESO_DIVERGENTE` sao os
  // unicos vereditos em que existe ancora de peso E frete a defender; os demais
  // (SEM_COTACAO, SEM_ANCORA, SEM_ITENS, FRETE_SEM_CUSTO) dizem que a pergunta
  // nao se aplica.
  //
  // FRETE_SEM_CUSTO merece nota: frete zerado nao bloqueia, e nao e so porque
  // nao ha dinheiro em risco. Bloquear ali criaria a armadilha que esta regra
  // existe para evitar — a saida seria recotar, mas recotar a partir de zero so
  // pode ENCARECER, e o CHECK `exp_recot_dif_etapa2_ck` recusa exatamente isso.
  // O pedido ficaria travado sem caminho nenhum.
  const haComparacaoDePeso =
    (peso.motivo === "EM_DIA" || peso.motivo === "PESO_DIVERGENTE") &&
    peso.pesoCotadoGramas !== null &&
    peso.pesoCotadoGramas > 0 &&
    peso.pesoAtualGramas > 0;

  const percentualAcimaDoCotado = haComparacaoDePeso
    ? (peso.pesoAtualGramas - peso.pesoCotadoGramas!) / peso.pesoCotadoGramas!
    : null;

  // "margem SUPERIOR a 5%": exatamente 5% ainda passa.
  const pesoExcedeuMargem =
    percentualAcimaDoCotado !== null && percentualAcimaDoCotado > MARGEM_PESO_PARA_MAIS;

  const cepCotado = soDigitos(entrada.cotacao.cep);
  const cepDespacho = soDigitos(entrada.cepDestino);
  const cepMudou = Boolean(cepCotado && cepDespacho && cepCotado !== cepDespacho);

  const transporteReferencia = referenciaTransporte(entrada.tipoFreteJaDespachado, entrada.cotacao.servico);
  const transporteMudou = transporteReferencia !== null && entrada.tipoFreteEscolhido !== transporteReferencia;

  const motivos: string[] = [];
  if (transporteMudou) motivos.push("o transporte mudou em relação ao cotado");
  if (pesoExcedeuMargem) {
    motivos.push(`o peso está ${(percentualAcimaDoCotado! * 100).toFixed(1)}% acima do cotado`);
  }
  if (cepMudou) motivos.push("o endereço de entrega mudou");

  // Fora de CIF nao ha recotacao possivel — informa, nao trava.
  const bloqueia = entrada.modalidadeEfetiva === "CIF" && motivos.length > 0;

  return {
    bloqueia,
    temAviso: motivos.length > 0,
    motivos,
    pesoExcedeuMargem,
    percentualAcimaDoCotado,
    peso,
    cepMudou,
    cepCotado,
    cepDespacho,
    transporteMudou,
    transporteReferencia
  };
}

/** "90620-130" a partir de "90620130". Devolve o que veio quando nao da 8. */
export function formatarCep(cep: string | null): string {
  if (!cep) return "—";
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

/** "o peso está 7.7% acima do cotado e o endereço de entrega mudou" */
export function frasearMotivos(motivos: string[]): string {
  if (motivos.length === 0) return "";
  if (motivos.length === 1) return motivos[0];
  return `${motivos.slice(0, -1).join(", ")} e ${motivos[motivos.length - 1]}`;
}
