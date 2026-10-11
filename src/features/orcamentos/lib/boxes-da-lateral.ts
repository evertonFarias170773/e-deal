/**
 * QUAIS BOXES APARECEM NA LATERAL DE CADA ABA da edicao da proposta (11/10/2026).
 *
 * A numeracao e a que esta escrita nos titulos da tela (`FormSection`):
 *   5  - Endereco de entrega   (mora na aba Geral; tambem sobe para a lateral de Fretes)
 *   8  - Resumo do orcamento
 *   9  - Envio do orcamento
 *   10 - Observacoes e Condicoes
 * Os boxes 1 a 4, 6 e 7 pertencem ao conteudo das abas e nao passam por aqui.
 *
 * Antes, 8, 9 e 10 apareciam em TODAS as abas. A regra agora e um mapa so, aqui:
 * a pagina pergunta `boxEstaNaLateral(aba, box)` em vez de ter condicionais
 * espalhadas por aba.
 *
 * O box 5 na lateral de Fretes e o MESMO bloco da aba Geral, desenhado pela mesma
 * funcao e sobre o mesmo estado do formulario: escolher, editar ou salvar um
 * endereco numa aba vale na outra, e as duas nao tem como divergir.
 */

/** As abas do editor (mesmos ids de `ABAS_EDITOR` na pagina, que e quem as lista). */
export type AbaDoEditor =
  | "geral"
  | "produtos"
  | "fretes"
  | "pagamentos"
  | "artes"
  | "pedido"
  | "producao"
  | "boletim"
  | "historico";

export type BoxDaLateral = 5 | 8 | 9 | 10;

const OS_TRES_DE_SEMPRE: readonly BoxDaLateral[] = [8, 9, 10];

/**
 * O mapa. Geral e Orcamento ficam como eram. "boletim" nao tem aba na barra (e
 * so um id legado que mostra "Aguardando orientacoes") e tambem fica como era.
 */
export const BOXES_DA_LATERAL_POR_ABA: Record<AbaDoEditor, readonly BoxDaLateral[]> = {
  geral: OS_TRES_DE_SEMPRE,
  produtos: OS_TRES_DE_SEMPRE,
  fretes: [5, 10],
  pedido: [9, 10],
  artes: [10],
  producao: [10],
  pagamentos: [8, 10],
  historico: [9, 10],
  boletim: OS_TRES_DE_SEMPRE
};

/**
 * Abas em que o box 10 sai EXPANDIDO: ele e o unico da lateral, entao ganha a
 * altura que o box 9 tem nas outras abas.
 */
export const ABAS_COM_BOX_10_EXPANDIDO: readonly AbaDoEditor[] = ["artes", "producao"];

export function boxesDaLateral(aba: AbaDoEditor): readonly BoxDaLateral[] {
  return BOXES_DA_LATERAL_POR_ABA[aba] ?? OS_TRES_DE_SEMPRE;
}

export function boxEstaNaLateral(aba: AbaDoEditor, box: BoxDaLateral): boolean {
  return boxesDaLateral(aba).includes(box);
}

export function box10Expandido(aba: AbaDoEditor): boolean {
  return ABAS_COM_BOX_10_EXPANDIDO.includes(aba);
}
