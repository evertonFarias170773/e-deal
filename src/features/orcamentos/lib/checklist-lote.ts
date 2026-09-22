/**
 * O checklist do boletim aplicado ao LOTE (`pedidos_modelos`).
 *
 * UMA REGRA SÓ, TRÊS PORTAS
 *   O formulário do PCP (Etapa 6), a grade de lotes do orçamento e a rota
 *   `POST /api/pedidos/lotes-em-massa` (Etapa 6b) gravam lote. As três usam
 *   estas funções, para que "o que o produto não imprime não recebe valor"
 *   signifique a mesma coisa em qualquer uma — e para a regra poder ser testada
 *   sem banco e sem tela.
 *
 * A FONTE É O CADASTRO
 *   O checklist aqui é o do produto HOJE (`produto_boletim_campos`), não o
 *   snapshot congelado na venda: quem monta lote trabalha com o produto atual.
 *
 * PRODUTO SEM CHECKLIST = SEM REGRA
 *   Nenhum registro no cadastro não quer dizer "nada é impresso"; quer dizer
 *   que o produto ainda não foi configurado, e aí tudo segue como sempre foi.
 *
 * LOTE NOVO × LOTE EXISTENTE
 *   Novo: coluna escondida é gravada NULL, qualquer que seja o valor recebido —
 *   nada de "SEM_NUMERACAO", "Sequencial" herdado do numerador, faixa
 *   recalculada, "SÓ FRENTE" ou a cor do produto.
 *   Existente: coluna escondida SAI do payload. O banco fica com o que tinha;
 *   esconder um campo nunca apaga nem reescreve o que já foi decidido.
 *
 * Sem imports de propósito: roda no navegador, na rota do servidor e no teste
 * do Node, igual.
 */

/** Campos do checklist que têm coluna no lote, e quais colunas cada um governa. */
export const COLUNAS_DO_LOTE_POR_CAMPO = {
  cor: ["padrao"],
  impressao_fv: ["verso_tipo"],
  tipo_numeracao: ["tipo_numeracao"],
  num_gabarito: ["gabarito_operacional"],
  numeracao_faixa: ["numeracao_inicio", "numeracao_fim"]
} as const;

export type CampoDoLote = keyof typeof COLUNAS_DO_LOTE_POR_CAMPO;

/**
 * O que o produto mostra. `null` = produto sem nenhum registro de checklist:
 * sem regra, tudo aparece e nada é anulado.
 */
export type ChecklistVisivel = ReadonlySet<string> | null;

export function checklistVisivel(campos: readonly string[] | null | undefined): ChecklistVisivel {
  if (!campos || campos.length === 0) return null;
  return new Set(campos);
}

/** Este campo aparece? Sem regra, sempre aparece. */
export function mostraCampo(visivel: ChecklistVisivel, campo: string): boolean {
  return visivel === null || visivel.has(campo);
}

/** As colunas do lote que este checklist esconde. */
export function colunasEscondidas(visivel: ChecklistVisivel): string[] {
  if (visivel === null) return [];
  const saida: string[] = [];
  for (const [campo, colunas] of Object.entries(COLUNAS_DO_LOTE_POR_CAMPO)) {
    if (!visivel.has(campo)) saida.push(...colunas);
  }
  return saida;
}

/**
 * LOTE NOVO: toda coluna escondida vira null. As demais passam intactas —
 * inclusive os defaults de sempre, para o produto sem checklist não mudar.
 */
export function anularColunasEscondidas<T extends Record<string, unknown>>(
  lote: T,
  visivel: ChecklistVisivel
): T {
  const escondidas = colunasEscondidas(visivel);
  if (escondidas.length === 0) return lote;
  const saida: Record<string, unknown> = { ...lote };
  for (const coluna of escondidas) {
    if (coluna in saida) saida[coluna] = null;
  }
  return saida as T;
}

/**
 * LOTE EXISTENTE: toda coluna escondida sai do payload do UPDATE. Sem a chave,
 * o PostgREST não toca na coluna — o valor gravado fica como está.
 */
export function omitirColunasEscondidas<T extends Record<string, unknown>>(
  patch: T,
  visivel: ChecklistVisivel
): Partial<T> {
  const escondidas = colunasEscondidas(visivel);
  if (escondidas.length === 0) return patch;
  const saida: Record<string, unknown> = { ...patch };
  for (const coluna of escondidas) delete saida[coluna];
  return saida as Partial<T>;
}

/**
 * PCP (Etapa 6): os quatro campos opcionais que a abertura da OS grava no lote
 * novo, a partir do modelo da tela. Campo escondido vai null; campo visível
 * mantém exatamente a montagem que o formulário sempre fez.
 */
export function camposOpcionaisDoLotePcp(
  modelo: {
    tipoNumeracao?: string | null;
    gabaritoNumeracao?: string | null;
    numeracaoInicial?: number | null;
    numeracaoFinal?: number | null;
  },
  visivel: ChecklistVisivel
): {
  tipo_numeracao: string | null;
  gabarito_operacional: string | null;
  numeracao_inicio: number | null;
  numeracao_fim: number | null;
} {
  const faixa = mostraCampo(visivel, "numeracao_faixa");
  return {
    tipo_numeracao: mostraCampo(visivel, "tipo_numeracao") ? modelo.tipoNumeracao || null : null,
    gabarito_operacional:
      mostraCampo(visivel, "num_gabarito") && modelo.gabaritoNumeracao && modelo.gabaritoNumeracao !== "Sem gabarito"
        ? modelo.gabaritoNumeracao
        : null,
    numeracao_inicio:
      faixa && modelo.numeracaoInicial !== undefined && modelo.numeracaoInicial !== null
        ? Number(modelo.numeracaoInicial)
        : null,
    numeracao_fim:
      faixa && modelo.numeracaoFinal !== undefined && modelo.numeracaoFinal !== null
        ? Number(modelo.numeracaoFinal)
        : null
  };
}
