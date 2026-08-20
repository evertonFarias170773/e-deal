import {
  avaliarFreteParaCobranca,
  formatarPesoGramas
} from "@/features/orcamentos/services/frete-desatualizado";
import type { SituacaoFreteCobranca } from "@/features/orcamentos/services/frete-desatualizado";

/**
 * O envio que esta sendo despachado ainda corresponde ao frete que a proposta
 * cobra?
 *
 * POR QUE EXISTE
 *   Ate 20/08/2026 nao havia comparacao nenhuma. `cotacao_frete.peso` era lido
 *   em tres lugares do modulo, e nos tres apenas como DEGRAU DE PRECEDENCIA em
 *   `resolverPesoExpedicao` — nunca confrontado com o peso que o expedidor
 *   digitou. O CEP da cotacao so servia para casar o endereco na cascata.
 *   Resultado: dava para trocar o destino e pesar bem acima do estimado, e o
 *   `valor_frete` da proposta seguia o antigo, sem aviso.
 *
 *   Evidencia real, pedido 20961: cotado SEDEX a R$ 18,84 com 3.120 g,
 *   despachado com 3.500 g, frete inalterado. Os mesmos numeros travariam uma
 *   cobranca por PESO_DIVERGENTE.
 *
 * POR QUE REUSAR `frete-desatualizado.ts`
 *   `avaliarFreteParaCobranca` nao e acoplada a cobranca: ela recebe os dois
 *   pesos por parametro. No fluxo de cobranca, `pesoAtualGramas` e o peso
 *   TEORICO (soma de `produtos_proposta.peso_total`); aqui passamos o peso
 *   AFERIDO na balanca, e a comparacao vira exatamente a que interessa no
 *   despacho — cotado x real. Vem junto a tolerancia de arredondamento de 1 g,
 *   calibrada em 15 casos reais de producao, e os motivos SEM_COTACAO,
 *   SEM_ANCORA e FRETE_SEM_CUSTO.
 *
 *   O que NAO se reusa e `mensagemFreteDesatualizado`: ela manda o usuario para
 *   a aba Fretes do orcamento, destino errado para quem esta na bancada. O
 *   texto daqui e proprio.
 *
 *   O modulo de origem nao e alterado, so importado.
 *
 * O QUE ELA NAO FAZ
 *   Nao bloqueia despacho e nao recota. A regra do modulo e que falta de NF-e
 *   nunca bloqueia despacho, e isto segue a mesma regra: informa, e a decisao
 *   continua do expedidor. Trocar o valor depende da recotacao, que por sua vez
 *   depende de liberacao de um admin.
 */

export type DivergenciaFreteDespacho = {
  /** Ha algo que valha um aviso na tela? */
  temAviso: boolean;
  /** Veredito de peso, vindo de `avaliarFreteParaCobranca`. */
  peso: SituacaoFreteCobranca;
  /** O destino do despacho tem CEP diferente do que originou a cotacao. */
  cepMudou: boolean;
  /** CEP da cotacao, so digitos. Null quando a cotacao nao guardou CEP. */
  cepCotado: string | null;
  /** CEP do endereco escolhido no despacho, so digitos. */
  cepDespacho: string | null;
  /** Frase pronta do peso: "3,1 kg cotados contra 3,5 kg no despacho". */
  resumoPeso: string;
};

const soDigitos = (v: string | null | undefined): string | null => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length > 0 ? d : null;
};

export function divergenciaFreteDoDespacho(entrada: {
  cotacao: {
    /** `cotacao_frete.peso` da linha escolhida, em gramas. */
    pesoGramas: number | null | undefined;
    /** `cotacao_frete.cep` da linha escolhida. */
    cep: string | null | undefined;
    /** `propostas.valor_frete` — o que a proposta cobra hoje. */
    valor: number | null | undefined;
    servico: string | null | undefined;
    /** Existe linha escolhida em `cotacao_frete`? */
    existe: boolean;
  };
  /** Peso que o expedidor informou, em gramas. Null = nao informado. */
  pesoAferidoGramas: number | null | undefined;
  /** CEP do endereco de entrega selecionado no despacho. */
  cepDestino: string | null | undefined;
}): DivergenciaFreteDespacho {
  const peso = avaliarFreteParaCobranca({
    pesoCotadoGramas: entrada.cotacao.pesoGramas,
    // Aqui entra o AFERIDO, nao o teorico — e a diferenca entre esta chamada e
    // a do fluxo de cobranca.
    pesoAtualGramas: entrada.pesoAferidoGramas,
    valorFrete: entrada.cotacao.valor,
    servico: entrada.cotacao.servico,
    temCotacao: entrada.cotacao.existe,
    // Sem peso aferido nao ha o que comparar: `temItens: false` faz a funcao
    // devolver SEM_ITENS em vez de acusar divergencia maxima contra zero.
    temItens: entrada.pesoAferidoGramas !== null && entrada.pesoAferidoGramas !== undefined
  });

  const cepCotado = soDigitos(entrada.cotacao.cep);
  const cepDespacho = soDigitos(entrada.cepDestino);
  // Só acusa quando os DOIS existem e diferem. Cotação sem CEP gravado não vira
  // alarme — é o caso de boa parte do histórico.
  const cepMudou = Boolean(cepCotado && cepDespacho && cepCotado !== cepDespacho);

  const resumoPeso =
    peso.pesoCotadoGramas !== null && peso.pesoAtualGramas > 0
      ? `${formatarPesoGramas(peso.pesoCotadoGramas)} cotados contra ${formatarPesoGramas(peso.pesoAtualGramas)} no despacho`
      : "";

  return {
    temAviso: peso.bloqueia || cepMudou,
    peso,
    cepMudou,
    cepCotado,
    cepDespacho,
    resumoPeso
  };
}

/** "90620-130" a partir de "90620130". Devolve o que veio quando nao da 8. */
export function formatarCep(cep: string | null): string {
  if (!cep) return "—";
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}
