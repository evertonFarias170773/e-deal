import { normalizarTipoFrete } from "@/features/expedicao/lib/tipo-frete";

/**
 * Categoria do transporte da proposta — lista FECHADA de quatro valores.
 *
 * ONDE MORA
 *   `propostas.transporte_categoria` (migration 20260822). Nula = ninguem
 *   escolheu ainda.
 *
 * O QUE NAO E
 *   Nao e `propostas.modalidade_frete` (RETIRA/FOB/CIF), que diz quem PAGA.
 *   Nao e `propostas.frete_escolhido`, que continua sendo o ROTULO livre: nome
 *   da transportadora em FOB, texto do frete manual nas avulsas, e estados
 *   temporarios como "Frete Incluso".
 *
 * SEDEX e PAC sao servicos dos Correios, nao categorias: entram como CORREIOS.
 * "Parceira" tambem nao e categoria — e a transportadora com cotacao
 * automatizada (Veppo, Azul, Sao Miguel, Motoboy), e cada uma cai numa das
 * quatro.
 */
export const TRANSPORTE_CATEGORIAS = ["RETIRA", "MOTOBOY", "CORREIOS", "TRANSPORTADORA"] as const;

export type TransporteCategoria = (typeof TRANSPORTE_CATEGORIAS)[number];

export const LABEL_TRANSPORTE_CATEGORIA: Record<TransporteCategoria, string> = {
  RETIRA: "Retira",
  MOTOBOY: "Motoboy",
  CORREIOS: "Correios",
  TRANSPORTADORA: "Transportadora"
};

/** Aceita so os quatro valores canonicos; qualquer outra coisa vira null. */
export function ehTransporteCategoria(valor: unknown): valor is TransporteCategoria {
  return typeof valor === "string" && (TRANSPORTE_CATEGORIAS as readonly string[]).includes(valor);
}

/** Sem caixa e sem acento — a comparacao nunca deve depender de como foi digitado. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim();
}

/**
 * LEITURA TOLERANTE do rotulo antigo, para EXIBIR — nunca para reescrever.
 *
 * POR QUE EXISTE
 *   `frete_escolhido` acumulou 62 valores distintos em 8.377 propostas: a mesma
 *   coisa em grafias diferentes (SEDEX/sedex/Sedex, RETIRADA/Retira/RETIRA
 *   BALCAO/Retirada Local), transportadoras soltas e lixo de digitacao. Enquanto
 *   `transporte_categoria` for nula — o caso de TODA proposta anterior a
 *   22/08/2026, porque nao houve backfill — e daqui que sai a classificacao.
 *
 * COMO CLASSIFICA
 *   Reaproveita `normalizarTipoFrete`, o MESMO normalizador que a Expedicao usa
 *   para decidir a etiqueta, em vez de manter duas tabelas de sinonimos que
 *   divergiriam com o tempo. Aquele modulo fica INTOCADO: aqui so se traduz o
 *   resultado dele para as quatro categorias, e se cobre o vocabulario que ele
 *   nao ve — ele foi afinado para `cotacao_frete.servico`, e `frete_escolhido`
 *   tem palavras proprias (o literal "Correios", por exemplo, que nao contem
 *   SEDEX nem PAC e passaria batido).
 *
 * O QUE DEVOLVE NULL, DE PROPOSITO
 *   Estado temporario ("Frete Incluso" 1.353x, "A definir" 186x, "Sem custo"
 *   28x, "Acompanha outro pedido", "Por conta de Dseg") e lixo ("as", "dd",
 *   "12", "Nao sei"). Eles nao nomeiam transporte nenhum, entao NAO viram
 *   categoria: o chamador exibe o texto cru como esta. Inventar categoria aqui
 *   seria pior do que nao classificar — e exatamente o erro que esta etapa
 *   existe para acabar.
 */
export function classificarTransporte(freteEscolhido: string | null | undefined): TransporteCategoria | null {
  const texto = normalizar(freteEscolhido);
  if (!texto) return null;

  // 1) O normalizador da Expedicao resolve a maior parte do vocabulario.
  //    SEM_CUSTO e INDEFINIDO NAO viram categoria: "sem custo" e preco, nao
  //    transporte, e indefinido e a ausencia de resposta.
  switch (normalizarTipoFrete(freteEscolhido)) {
    case "CORREIOS":
      return "CORREIOS";
    case "MOTOBOY":
      return "MOTOBOY";
    case "RETIRA_BALCAO":
      return "RETIRA";
    case "TRANSPORTADORA":
      return "TRANSPORTADORA";
    default:
      break;
  }

  // 2) Segunda passada sem espacos, pelo MESMO normalizador. Pega a grafia
  //    partida que a primeira nao ve — o caso real e "BRAS PRESS", que so casa
  //    com a lista de transportadoras depois de colar as duas palavras.
  const semEspacos = texto.replace(/\s+/g, "");
  if (semEspacos !== texto) {
    switch (normalizarTipoFrete(semEspacos)) {
      case "CORREIOS":
        return "CORREIOS";
      case "MOTOBOY":
        return "MOTOBOY";
      case "RETIRA_BALCAO":
        return "RETIRA";
      case "TRANSPORTADORA":
        return "TRANSPORTADORA";
      default:
        break;
    }
  }

  // 3) Vocabulario proprio de `frete_escolhido`, que a cotacao nao usa.
  if (texto.includes("CORREIO")) return "CORREIOS";
  // "AEREO EXPRESSO" e "AVI AZUL": modal aereo contratado, sempre transportadora.
  if (/(^|[^A-Z])(AEREO|AVI)([^A-Z]|$)/.test(texto)) return "TRANSPORTADORA";

  // 4) Nao encaixou: quem chama exibe o texto cru, sem categoria falsa.
  return null;
}

/**
 * A categoria que vale para ler uma proposta: a escolhida, quando existe; senao
 * a deduzida do rotulo antigo. Null quando nem uma nem outra respondem.
 *
 * Esta e a funcao que o resto do codigo deve usar — nunca comparar
 * `frete_escolhido` com string na mao, que e a origem do bug das 27 propostas
 * gravadas como `sedex`, `Sedex`, `RETIRA BALCAO`, `Retirada Local` e `Retira`.
 */
export function categoriaEfetiva(
  transporteCategoria: string | null | undefined,
  freteEscolhido: string | null | undefined
): TransporteCategoria | null {
  if (ehTransporteCategoria(transporteCategoria)) return transporteCategoria;
  return classificarTransporte(freteEscolhido);
}
