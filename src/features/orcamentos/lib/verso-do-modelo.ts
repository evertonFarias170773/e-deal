/**
 * Verso do modelo — a lista fechada do campo "Verso" e o valor com que um
 * modelo novo nasce.
 *
 * Módulo puro, sem import: é usado pela aba Pedido (o campo Verso do modelo) e
 * pelo cadastro do produto (o campo "Frente e Verso"), e testado em
 * scripts/testes/verso-do-modelo.test.mts.
 *
 * A LISTA
 *   São os quatro valores que o campo Verso sempre ofereceu. Fonte única: o
 *   modelo e o cadastro do produto leem daqui. O banco não tem restrição em
 *   `pedidos_modelos.verso_tipo` nem em `produtos.verso_padrao` — quem valida é
 *   esta constante. Existem modelos antigos com outros textos ("Frente",
 *   "FxVerso", "VERSO COMUM"): são resíduo, não entram na lista e ninguém os
 *   regrava.
 *
 * A PRÉ-CARGA (07/10/2026)
 *   `produtos.verso_padrao` diz com que verso o modelo NOVO daquele produto
 *   nasce. Vale só na criação: modelo que já existe nunca é relido do catálogo,
 *   e a cópia de um modelo leva o verso do original. Produto sem valor (ou com
 *   valor fora da lista) segue como sempre foi: SÓ FRENTE.
 */

export const OPCOES_DE_VERSO = ["SÓ FRENTE", "FRENTE E VERSO", "VERSO FIXO", "VERSO VARIÁVEL"] as const;

export type OpcaoDeVerso = (typeof OPCOES_DE_VERSO)[number];

/** O verso de um modelo novo quando o cadastro do produto não diz nada. */
export const VERSO_SEM_CADASTRO: OpcaoDeVerso = "SÓ FRENTE";

/** O texto é um dos quatro valores da lista? */
export function ehOpcaoDeVerso(valor: unknown): valor is OpcaoDeVerso {
  return typeof valor === "string" && (OPCOES_DE_VERSO as readonly string[]).includes(valor);
}

/**
 * Com que verso nasce um modelo NOVO deste produto.
 * `versoPadraoDoProduto` é `produtos.verso_padrao`, lido no momento de criar.
 */
export function versoInicialDoModelo(versoPadraoDoProduto: unknown): OpcaoDeVerso {
  const texto = typeof versoPadraoDoProduto === "string" ? versoPadraoDoProduto.trim() : "";
  return ehOpcaoDeVerso(texto) ? texto : VERSO_SEM_CADASTRO;
}

/**
 * O verso de uma LINHA NOVA da Lista rápida: copia o da linha de que ela
 * nasceu (a anterior, ou a duplicada) e só sem linha de origem usa o valor
 * inicial do produto. Linha copiada nunca relê o catálogo.
 */
export function versoDaLinhaNova<T extends string | null>(versoDaLinhaDeOrigem: T | undefined, versoInicial: T): T {
  return versoDaLinhaDeOrigem ?? versoInicial;
}

/**
 * O que o cadastro do produto grava em `verso_padrao`: vazio vira nulo ("sem
 * valor"). O texto não é trocado aqui — o campo só oferece a lista e, quando o
 * produto já tinha um valor fora dela, esse mesmo valor.
 */
export function versoPadraoParaGravar(valorDoCampo: string | null | undefined): string | null {
  const texto = (valorDoCampo ?? "").trim();
  return texto ? texto : null;
}

/**
 * As opções do campo "Frente e Verso" do produto: a lista e, se o produto já
 * guarda um valor fora dela, esse valor também — para abrir e salvar o
 * cadastro não apagar o que estava gravado.
 */
export function opcoesDeVersoDoProduto(valorGravado: string | null | undefined): string[] {
  const texto = (valorGravado ?? "").trim();
  return texto && !ehOpcaoDeVerso(texto) ? [...OPCOES_DE_VERSO, texto] : [...OPCOES_DE_VERSO];
}
