/**
 * O parâmetro `frete` da URL do painel, antes e depois das colunas por categoria.
 *
 * O PROBLEMA
 *   Até 05/09/2026 o filtro guardava um `TipoFreteNormalizado` — CORREIOS,
 *   MOTOBOY, TRANSPORTADORA, RETIRA_BALCAO, SEM_CUSTO ou INDEFINIDO — e o painel
 *   comparava com `p.tipoFrete`. Com as sete categorias, um link salvo, um
 *   favorito ou uma aba aberta desde ontem passariam a não casar com nada.
 *
 *   E o modo de falhar era o pior possível: LISTA VAZIA, sem dizer por quê. O
 *   expedidor concluiria que não há pedido naquele transporte.
 *
 * A REGRA
 *   Traduzir o que tem equivalente exato e ABRIR o filtro no resto, avisando.
 *   Filtro aberto mostra pedido demais, o que se vê e se corrige; filtro que não
 *   casa esconde tudo, e isso não se vê.
 *
 * AS SEIS DECISÕES, uma a uma:
 *
 *   CORREIOS       → CORREIOS. Mesmo conjunto, mesmo nome.
 *   MOTOBOY        → MOTOBOY. Idem.
 *   RETIRA_BALCAO  → RETIRA. Mesmo conjunto, nome novo.
 *
 *   TRANSPORTADORA → ABRE. Não tem equivalente único: virou RODOVIARIO, AEREO,
 *                    VEPPO e parte de EXTRAS. Escolher uma delas esconderia as
 *                    outras três sem avisar, que é exatamente o defeito que esta
 *                    tradução existe para evitar.
 *
 *   SEM_CUSTO      → ABRE. Nunca foi meio de transporte, e sim ausência de
 *                    preço: um pedido "sem custo" podia ser retirada, cortesia
 *                    ou frete incluso. Hoje esses pedidos se espalham entre
 *                    RETIRA, EXTRAS e não classificados.
 *
 *   INDEFINIDO     → ABRE. Significava "o texto da cotação não classifica".
 *                    Hoje isso é `null`, exibido em EXTRAS — mas EXTRAS ganhou
 *                    sentido PRÓPRIO (frete contratado à parte), então mandar
 *                    INDEFINIDO para lá devolveria um conjunto maior do que o
 *                    pedido, misturando "não sei" com "sei, e é à parte".
 *
 *   qualquer outro → ABRE. Link torto, valor de outra versão, digitação.
 */

import { CATEGORIAS_FRETE, type CategoriaFrete } from "@/features/orcamentos/lib/categoria-frete";

/** O valor que significa "sem filtro" — o mesmo de antes, para a URL não mudar. */
export const FILTRO_FRETE_TODOS = "TODOS";

/** Traduções exatas. O resto abre. */
const EQUIVALENTES: Readonly<Record<string, CategoriaFrete>> = {
  CORREIOS: "CORREIOS",
  MOTOBOY: "MOTOBOY",
  RETIRA_BALCAO: "RETIRA"
};

export type FiltroCategoriaResolvido = {
  /** Uma das sete, ou `TODOS`. Nunca um valor que não case com nada. */
  valor: CategoriaFrete | typeof FILTRO_FRETE_TODOS;
  /**
   * O que veio na URL, quando foi traduzido ou descartado. `null` quando o valor
   * já era válido — aí não há o que contar a ninguém.
   */
  legado: string | null;
  /** `true` quando o filtro foi ABERTO por não ter equivalente. */
  abriu: boolean;
};

/**
 * Resolve o `frete` da URL para uma das sete categorias, ou abre o filtro.
 *
 * Função pura: a tela decide o que fazer com o aviso, e o teste alcança a regra
 * sem precisar de navegador.
 */
export function resolverFiltroCategoria(bruto: string | null | undefined): FiltroCategoriaResolvido {
  const valor = String(bruto ?? "").trim().toUpperCase();

  if (valor === "" || valor === FILTRO_FRETE_TODOS) {
    return { valor: FILTRO_FRETE_TODOS, legado: null, abriu: false };
  }

  if ((CATEGORIAS_FRETE as readonly string[]).includes(valor)) {
    return { valor: valor as CategoriaFrete, legado: null, abriu: false };
  }

  const equivalente = EQUIVALENTES[valor];
  if (equivalente) {
    return { valor: equivalente, legado: valor, abriu: false };
  }

  return { valor: FILTRO_FRETE_TODOS, legado: valor, abriu: true };
}

/** O texto do aviso, para a tela não escrever a explicação por conta própria. */
export function avisoFiltroLegado(resolvido: FiltroCategoriaResolvido): string | null {
  if (!resolvido.legado) return null;
  if (resolvido.abriu) {
    return (
      `O filtro "${resolvido.legado}" saiu do painel: agora as colunas são por categoria de transporte. ` +
      `A lista está mostrando todos os fretes — escolha uma categoria ao lado, se quiser recortar.`
    );
  }
  return `O filtro "${resolvido.legado}" agora se chama "${resolvido.valor}".`;
}
