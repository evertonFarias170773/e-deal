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

/**
 * A CATEGORIA QUE VALE, entre a declarada no orçamento e a registrada no despacho.
 *
 * PRECEDÊNCIA — a MESMA de `modalidadeInicialDoDespacho`, de propósito:
 *   1. `expedicoes.categoria_frete` DE DESPACHO CONFIRMADO. Ali o expedidor
 *      declarou o que de fato saiu, e isso é soberano.
 *   2. `propostas.categoria_frete` — a declaração comercial.
 *   3. `expedicoes.categoria_frete` AINDA EM RASCUNHO.
 *   4. A DERIVAÇÃO NA LEITURA, a partir do que a proposta já carrega.
 *   5. `null` — não classificada. O painel a exibe em EXTRAS.
 *
 * O DEGRAU 4, E POR QUE ELE NÃO É UM BACKFILL DISFARÇADO (05/09/2026)
 *   As 9.032 propostas do histórico nasceram sem `categoria_frete`, e o painel
 *   as mostraria todas em EXTRAS — uma coluna só, que é o problema que as sete
 *   vieram resolver. Classificá-las no banco está PROIBIDO: `propostas` tem dois
 *   triggers BEFORE UPDATE sem `UPDATE OF` que carimbam `now()`
 *   incondicionalmente, e um UPDATE em massa destruiria a ordenação por
 *   `updated_at` sem volta.
 *
 *   Então a classificação acontece na LEITURA, e só ali. Nada é gravado — nem
 *   "aproveitando" que a linha está sendo lida. O degrau some sozinho conforme
 *   as propostas vão sendo salvas com a categoria gravada, porque os degraus 1
 *   e 2 passam a responder antes dele. É reversível por construção: apagar o
 *   parâmetro devolve o comportamento anterior.
 *
 *   QUEM DERIVA É O CHAMADOR, não esta função. Ela não conhece cotação,
 *   modalidade nem despacho — recebe o resultado pronto e apenas o coloca na
 *   ordem certa. É o que a mantém pura e testável, e o que garante que o degrau
 *   4 nunca passe na frente do 1: em pedido despachado, a categoria registrada
 *   no despacho responde antes, e a derivação nem é consultada.
 *
 * O DEGRAU 1 EXIGE DESPACHO CONFIRMADO pelo motivo que a modalidade já ensinou
 * em 04/09/2026: a linha de `expedicoes` nasce em `marcarPronto`, muito antes do
 * despacho, e tratá-la como soberana desde o nascimento congela o pedido num
 * rascunho — foi o que prendeu o 21000 em "Retira no balcão" depois de a
 * proposta já ter sido corrigida para FOB.
 *
 * É POR ISTO QUE A RECOTAÇÃO NÃO PRECISA ESCREVER EM `propostas`. Ela troca a
 * transportadora de verdade, mas o registro disso vive no despacho; a proposta
 * guarda o que foi vendido, a expedição guarda o que aconteceu, e esta função é
 * quem concilia as duas na leitura. Retroalimentar a proposta apagaria a
 * declaração comercial com um fato logístico.
 *
 * FUNÇÃO ÚNICA: o painel, os cards e qualquer relatório leem daqui. Espalhar a
 * regra pelos chamadores é o que produziu as duas definições dos chips da
 * Expedição e dos cards de Orçamentos.
 */
export function categoriaFreteVigente(
  daProposta: CategoriaFrete | null | undefined,
  daExpedicao: CategoriaFrete | null | undefined,
  /** `expedicoes.data_despacho` preenchida. Sem isto a linha é rascunho. */
  despachoConfirmado: boolean,
  /**
   * O degrau 4: a categoria DERIVADA na leitura, quando nada foi gravado.
   *
   * Opcional de propósito — omitir devolve exatamente o comportamento de antes
   * de 05/09/2026, e é assim que os chamadores que não derivam nada continuam
   * funcionando sem saber que este degrau existe.
   */
  derivadaDaLeitura?: CategoriaFrete | null
): CategoriaFrete | null {
  if (despachoConfirmado && ehCategoriaFrete(daExpedicao)) return daExpedicao;
  if (ehCategoriaFrete(daProposta)) return daProposta;
  if (ehCategoriaFrete(daExpedicao)) return daExpedicao;
  return ehCategoriaFrete(derivadaDaLeitura) ? derivadaDaLeitura : null;
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
 * ═══════════════════════════════════════════════════════════════════════════
 * A TABELA DE NOMES. ISTO NÃO É UMA REGRA — É UMA LISTA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O QUE ELA É
 *   Nove nomes de transportadora, com a categoria que o dono decidiu para cada
 *   um em 05/09/2026. Nada aqui é derivado de coisa nenhuma: é a resposta que
 *   alguém deu, escrita à mão.
 *
 * POR QUE ISSO É DIFERENTE DE `categoriaDoServico`
 *   Aquela função RECONHECE: SEDEX é dos Correios, VEPPO é a VEPPO, retirada não
 *   tem transporte. São fatos que se sustentam sozinhos, e por isso ela pode
 *   vencer até a declaração do usuário.
 *
 *   Esta tabela apenas LEMBRA. "Braspress é rodoviário" é verdade hoje, para
 *   esta empresa, com este contrato — e nada no código percebe quando deixar de
 *   ser. Ela envelhece calada: a transportadora troca de modal, a empresa troca
 *   de transportadora, e a lista continua respondendo com confiança o que já não
 *   é verdade. É o custo que se aceita conscientemente para não deixar 40 e
 *   poucos pedidos reais parados em EXTRAS.
 *
 * POR ISSO ELA É O DEGRAU MAIS FRACO
 *   A DECLARAÇÃO DO USUÁRIO SEMPRE VENCE — o drop de FOB, o frete manual e a
 *   correção de frete falam do pedido que está na mão; a tabela fala de um nome.
 *   Quem escolheu "aéreo" para uma carga da Braspress sabe algo que a lista não
 *   sabe. A ordem em cada gravação é: derivação forte, depois a declaração,
 *   depois esta tabela.
 *
 *   E ela nunca reclassifica proposta que já tem `categoria_frete` gravada: na
 *   leitura ela mora no degrau 4, atrás das duas colunas.
 *
 * COMO SAIR DAQUI
 *   A saída certa é a categoria virar dado do transporte contratado, e não
 *   texto. Enquanto isso não existe, esta lista é o menos pior — desde que
 *   continue pequena, datada e visivelmente uma lista.
 *
 * CASAMENTO POR PALAVRA INTEIRA, nunca por substring solta. É a mesma disciplina
 * que fez "AEREO EXPRESSO" ser recusado por substring de "AEREO" na derivação:
 * substring solta transforma qualquer rótulo que contenha as letras num
 * transporte que ele não é.
 */
const TRANSPORTES_CONHECIDOS: ReadonlyArray<{ categoria: CategoriaFrete; nomes: readonly string[] }> = [
  {
    categoria: "RODOVIARIO",
    // As quatro grafias de Braspress vivas na base — BRASPESS é erro de
    // digitação e entra como nome próprio, porque é assim que está gravado.
    nomes: ["BRASPRESS", "BRAS PRESS", "BRASPESS", "TW TRANSPORTES", "TROCA TRANSPORTES", "TROCA"]
  },
  {
    categoria: "AEREO",
    nomes: ["SVT TRANSPORTES", "SVT", "UNESUL", "TRANSPORTADORA PARCEIRA", "AEREO EXPRESSO"]
  },
  {
    categoria: "EXTRAS",
    // Melhor Envio e Eccom são intermediários: o meio depende do que o cliente
    // contratou lá dentro, e o pedido não sabe. EXTRAS é a resposta honesta.
    nomes: ["MELHOR ENVIO", "ECCOM"]
  }
];

/**
 * Texto reduzido a PALAVRAS: tudo que não é letra ou dígito vira separador, e o
 * resultado sai cercado de espaço. Assim "BRASPRESS/RS" e "BRASPRESS - SUL"
 * casam com BRASPRESS, e "BRASPRESSAO" não casa com nada.
 *
 * Sem expressão regular montada a partir do nome, de propósito: escapar alias
 * para dentro de um `RegExp` é uma fonte de erro que esta lista não precisa
 * correr. Comparar palavras é `includes` puro, e é exato.
 */
function palavrasDe(texto: string): string {
  let so = "";
  for (const ch of texto) {
    so += ch >= "A" && ch <= "Z" ? ch : ch >= "0" && ch <= "9" ? ch : " ";
  }
  return " " + so.split(" ").filter(Boolean).join(" ") + " ";
}

/**
 * A categoria de um nome que está na tabela — ou `null` para todo o resto.
 *
 * SEPARADA de `categoriaDoServico` de propósito. Se as duas fossem a mesma
 * função, a tabela herdaria a força da derivação e passaria na frente da
 * declaração do usuário, que é exatamente o que não pode acontecer. Manter duas
 * funções é o que deixa a precedência visível em cada chamador.
 *
 * Nome fora da lista continua `null`, e `null` aparece em EXTRAS. Não se inventa
 * entrada: a lista tem os nomes que alguém decidiu, e mais nenhum.
 */
export function categoriaPorNomeConhecido(
  transportadora: string | null | undefined,
  servico: string | null | undefined
): CategoriaFrete | null {
  const palavras = palavrasDe(`${normalizar(transportadora)} ${normalizar(servico)}`);
  if (palavras.trim() === "") return null;

  for (const entrada of TRANSPORTES_CONHECIDOS) {
    for (const nome of entrada.nomes) {
      if (palavras.includes(" " + nome + " ")) return entrada.categoria;
    }
  }
  return null;
}

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
