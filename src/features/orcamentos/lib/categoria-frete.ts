/**
 * Categoria do frete — POR ONDE O VOLUME VAI, na leitura do painel da Expedição.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ISTO NÃO É `transporte-categoria.ts`. SÃO DUAS DIMENSÕES DIFERENTES.
 * ═══════════════════════════════════════════════════════════════════════════
 *   `TransporteCategoria` (RETIRA / MOTOBOY / CORREIOS / TRANSPORTADORA) já
 *   existe, mora em `propostas.transporte_categoria`, e continua exatamente como
 *   está — nada aqui a substitui, altera ou deprecia. Ela responde "que tipo de
 *   transporte é este", com quatro valores e uma leitura tolerante do rótulo
 *   antigo.
 *
 *   `CategoriaFrete` responde outra pergunta: "em QUAL COLUNA do painel este
 *   pedido aparece". São sete, fixas, e a diferença não é de granularidade —
 *   é de propósito. VEPPO e AEREO seriam ambas "TRANSPORTADORA" na outra
 *   dimensão, e é justamente essa fusão que o painel não pode fazer.
 *
 *   As duas convivem. Um pedido tem as duas, e elas concordam sem serem iguais.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS SETE, E POR QUE SÃO ESTAS
 * ═══════════════════════════════════════════════════════════════════════════
 *   CORREIOS      SEDEX e PAC. Prepostagem pelo cartão de postagem da empresa.
 *
 *   MOTOBOY       Entrega urbana por moto.
 *
 *   RETIRA        O cliente busca no balcão. Não há transporte, logo não há
 *                 transportadora — e é por isso que ela sai de
 *                 `propostas.modalidade_frete`, e NÃO de um cadastro fictício
 *                 de transportadora em `clientes`.
 *
 *   RODOVIARIO    Transportadora de estrada.
 *
 *   AEREO         Carga aérea.
 *
 *   VEPPO         RODOVIÁRIO TAMBÉM, E MESMO ASSIM TEM COLUNA PRÓPRIA. Não é
 *                 inconsistência do modelo: a VEPPO embarca em ônibus de linha,
 *                 na rodoviária, e o volume tem de estar lá na hora do ônibus.
 *                 É a única categoria com controle de HORÁRIO, e misturá-la com
 *                 o rodoviário comum esconde exatamente o que a bancada precisa
 *                 ver. Quem quiser somar rodoviário + VEPPO num relatório soma;
 *                 o painel não pode.
 *
 *   EXTRAS        Frete contratado à parte, muitas vezes pelo próprio cliente —
 *                 Melhor Envio e semelhantes. O MEIO NEM SEMPRE É CONHECIDO, e
 *                 essa é a característica da categoria, não uma falha dela.
 *                 "Frete Incluso" e "À definir" moram aqui.
 *
 *   NULL          Não classificada. O painel a EXIBE EM EXTRAS — mas os dois
 *                 estados seguem distintos no banco, porque "ninguém sabe o
 *                 meio" e "ninguém classificou ainda" são coisas diferentes, e
 *                 só o segundo é dívida a resolver.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A CATEGORIA PERTENCE AO SERVIÇO, NÃO À EMPRESA
 * ═══════════════════════════════════════════════════════════════════════════
 *   A mesma transportadora oferece rodoviário E aéreo. O cadastro 808 já prova
 *   isso hoje: ele é a loja parceira da Azul (AEREO quando vem da cotação) e
 *   aparece como "SVT TRANSPORTES" no drop de FOB, onde o meio não é declarado.
 *
 *   Por isso a categoria NÃO é campo do cadastro da transportadora. Ela é
 *   decidida por cotação, no momento da escolha, e gravada na proposta.
 */

import {
  resolverTransportadoraParceira,
  TRANSPORTADORAS_PARCEIRAS
} from "./transportadoras-parceiras";
import type { ModalidadeFrete } from "./modalidade-frete";

/** As sete, na ordem em que as colunas aparecem no painel. */
export const CATEGORIAS_FRETE = [
  "CORREIOS",
  "MOTOBOY",
  "RETIRA",
  "RODOVIARIO",
  "AEREO",
  "VEPPO",
  "EXTRAS"
] as const;

export type CategoriaFrete = (typeof CATEGORIAS_FRETE)[number];

export const LABEL_CATEGORIA_FRETE: Record<CategoriaFrete, string> = {
  CORREIOS: "Correios",
  MOTOBOY: "Motoboy",
  RETIRA: "Retira balcão",
  RODOVIARIO: "Rodoviário",
  AEREO: "Aéreo",
  VEPPO: "Veppo",
  EXTRAS: "Extras"
};

/** Aceita só os sete valores canônicos; qualquer outra coisa vira null. */
export function ehCategoriaFrete(valor: unknown): valor is CategoriaFrete {
  return typeof valor === "string" && (CATEGORIAS_FRETE as readonly string[]).includes(valor);
}

/**
 * A coluna em que um pedido aparece, dada uma categoria possivelmente nula.
 *
 * Ponto único da regra "NULL cai em EXTRAS", para o painel não decidir isso por
 * conta própria e o banco não precisar de default.
 */
export function categoriaExibida(categoria: CategoriaFrete | null | undefined): CategoriaFrete {
  return ehCategoriaFrete(categoria) ? categoria : "EXTRAS";
}

/** Sem acento, maiúsculas, espaços colapsados — mesmo critério das parceiras. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rótulos que declaram "não há meio a declarar" — o vocabulário de EXTRAS.
 *
 * São os dois textos que a base realmente produz: "Frete Incluso" (o atalho da
 * aba Fretes, 1.889 propostas) e as variantes de "à definir" (187). Medido em
 * 05/09/2026 sobre as 9.032 propostas.
 *
 * `DEFINIR` sem acento e sem preposição de propósito: casa "À definir",
 * "à definir" e "Transportadora a definir", que são as três grafias vivas.
 */
const ROTULOS_EXTRAS = ["FRETE INCLUSO", "DEFINIR"];

/**
 * A categoria de um transporte, a partir do que se sabe no momento da escolha.
 *
 * FUNÇÃO PURA: não lê banco, não tem I/O, e é a única fonte da derivação —
 * orçamento, correção de frete e qualquer classificação futura chamam esta.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PRECEDÊNCIA, E O PORQUÊ DE CADA DEGRAU
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. `modalidade === "RETIRA"` VENCE TUDO, inclusive um SEDEX cotado. Quem
 *      retira no balcão não tem transporte, e a cotação que sobrou na tela é
 *      resíduo — é a mesma razão pela qual `resolverTransportadoraParceira`
 *      testa retirada antes de qualquer parceira.
 *
 *   2. A PARCEIRA, por `resolverTransportadoraParceira`. Não se reescreve o
 *      reconhecimento aqui: ele já existe, já é testado, já trata a fronteira
 *      de palavra de PAC (senão "PACOTE" viraria Correios) e já carrega a
 *      exceção honesta da Azul (AZUL ou ECOMM, porque o serviço é ecoado da API
 *      dela). Duplicá-lo seria criar duas verdades sobre a mesma pergunta.
 *
 *      O mapa parceira → categoria é o único acréscimo, e é direto:
 *      CORREIOS→CORREIOS, MOTOBOY→MOTOBOY, VEPPO→VEPPO, SÃO MIGUEL→RODOVIARIO,
 *      AZUL→AEREO.
 *
 *   3. Texto de retirada sem modalidade declarada. São 100 das 138 retiradas da
 *      base — propostas anteriores a 18/08/2026, quando `modalidade_frete`
 *      nasceu. Sem este degrau elas cairiam em NULL.
 *
 *   4. Rótulo de EXTRAS, pelo vocabulário acima.
 *
 *   5. NULL. E aqui está o que esta função DELIBERADAMENTE NÃO FAZ.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ELA NÃO ADIVINHA
 * ═══════════════════════════════════════════════════════════════════════════
 *   Seis nomes reais sobraram na base sem meio declarado — Transportadora
 *   Parceira (10), Unesul (5), Braspress (5, em quatro grafias), Troca (3),
 *   Aéreo Expresso (2) e SVT (1). Todos caem em NULL, de propósito.
 *
 *   "Braspress é rodoviário" é verdade e ainda assim não entra aqui: seria uma
 *   tabela de nomes que envelhece calada, e a próxima transportadora chegaria
 *   sem ninguém perceber. Onde o meio não é derivável, a resposta certa é
 *   PERGUNTAR — no drop de FOB e no frete manual —, não deduzir do nome.
 *
 *   "Aéreo Expresso" se autodeclara e mesmo assim fica em NULL: casar por
 *   substring de "AEREO" pegaria qualquer rótulo com a palavra, e a base tem
 *   texto digitado à mão.
 */
export function categoriaDoServico(
  transportadora: string | null | undefined,
  servico: string | null | undefined,
  modalidade: ModalidadeFrete | null | undefined
): CategoriaFrete | null {
  // ── 1. Retirada declarada vence a cotação ────────────────────────────────
  if (modalidade === "RETIRA") return "RETIRA";

  // ── 2. Parceira reconhecida ──────────────────────────────────────────────
  const parceira = resolverTransportadoraParceira({ transportadora, servico });
  if (parceira !== null) {
    switch (parceira) {
      case TRANSPORTADORAS_PARCEIRAS.CORREIOS:
        return "CORREIOS";
      case TRANSPORTADORAS_PARCEIRAS.MOTOBOY:
        return "MOTOBOY";
      case TRANSPORTADORAS_PARCEIRAS.VEPPO:
        return "VEPPO";
      case TRANSPORTADORAS_PARCEIRAS.SAO_MIGUEL:
        return "RODOVIARIO";
      case TRANSPORTADORAS_PARCEIRAS.AZUL:
        return "AEREO";
      default:
        // Parceira nova sem categoria mapeada: NULL, não um chute. Se aparecer,
        // o mapa acima é o lugar de resolver.
        return null;
    }
  }

  const texto = `${normalizar(transportadora)} ${normalizar(servico)}`.trim();
  if (texto === "") return null;

  // ── 3. Retirada dita no texto, sem modalidade ────────────────────────────
  if (texto.includes("RETIRA") || texto.includes("BALCAO")) return "RETIRA";

  // ── 4. Vocabulário de EXTRAS ─────────────────────────────────────────────
  if (ROTULOS_EXTRAS.some((rotulo) => texto.includes(rotulo))) return "EXTRAS";

  // ── 5. Não classificada ──────────────────────────────────────────────────
  return null;
}
