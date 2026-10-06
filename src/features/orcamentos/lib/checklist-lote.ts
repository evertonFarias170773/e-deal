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

/**
 * O produto tem ao menos uma cor de papel para escolher?
 *
 * As cores do seletor "Cor papel" vêm do FORMATO do produto
 * (`produtos.id_formato` → `producao_formatos` → `producao_cores.formato_id`).
 * Produto sem formato, ou com formato que não tem cor cadastrada, não tem o
 * que escolher: o seletor fica vazio.
 *
 * A comparação do formato é a mesma da aba Pedido: o `id_formato` do produto
 * casa com o número do formato (`id_formato_num`) ou com o próprio id.
 */
export function produtoTemCoresParaEscolher(
  idFormatoDoProduto: unknown,
  formatos: readonly { id?: unknown; id_formato_num?: unknown }[],
  cores: readonly { formato_id?: unknown }[]
): boolean {
  if (idFormatoDoProduto === null || idFormatoDoProduto === undefined || String(idFormatoDoProduto).trim() === "") {
    return false;
  }
  const alvo = String(idFormatoDoProduto);
  const formato = formatos.find((f) => String(f.id_formato_num) === alvo || String(f.id) === alvo);
  if (!formato || formato.id === null || formato.id === undefined) return false;
  return formatoTemCores(formato.id, cores);
}

/** O formato (já resolvido para o id de `producao_formatos`) tem alguma cor? */
export function formatoTemCores(idDoFormato: unknown, cores: readonly { formato_id?: unknown }[]): boolean {
  if (idDoFormato === null || idDoFormato === undefined || String(idDoFormato).trim() === "") return false;
  const alvo = String(idDoFormato);
  return cores.some((c) => String(c.formato_id) === alvo);
}

/**
 * O seletor "Cor papel" da tela tem opção para este item?
 *
 * `cadastroDeCores` é a lista INTEIRA de `producao_cores` que a aba Pedido
 * carrega. Enquanto ela não chegou (lista vazia), a resposta é "tem": a cor
 * continua cobrada, para um lote não ser dado como completo — e gravado sem
 * cor — só porque o cadastro ainda estava a caminho.
 */
export function seletorDeCorTemOpcao(idDoFormato: unknown, cadastroDeCores: readonly { formato_id?: unknown }[]): boolean {
  if (cadastroDeCores.length === 0) return true;
  return formatoTemCores(idDoFormato, cadastroDeCores);
}

/**
 * A cor do papel é OBRIGATÓRIA neste lote?
 *
 * Só quando as duas coisas valem: o checklist do item marca "cor" E existe ao
 * menos uma cor para escolher. Decisão do dono (06/10/2026): 17 produtos ativos
 * tinham "cor" no checklist e nenhum formato — o campo era obrigatório e
 * impossível de preencher, o lote nunca gravava e a liberação para Produção
 * ficava barrada pela trava de lotes. Sem cor para escolher, o lote grava com a
 * cor vazia.
 *
 * É a regra ÚNICA: `modeloCompleto` (card e lista rápida), a criação do modelo
 * pelo card e a conferência da aba Artes passam por aqui.
 */
export function corDoPapelObrigatoria(visivel: ChecklistVisivel, temCoresParaEscolher: boolean): boolean {
  return mostraCampo(visivel, "cor") && temCoresParaEscolher;
}

/**
 * O lote está completo? Nome, quantidade maior que zero e a cor do papel —
 * esta só quando é obrigatória (`corDoPapelObrigatoria`). É o que
 * `modeloCompleto` (components/ModeloCampos) devolve para o card e para a
 * lista rápida; fica aqui para poder ser testado sem a tela.
 */
export function loteCompleto(
  lote: { nome_modelo?: string | null; padrao?: string | null; quantidade?: number | null },
  visivel: ChecklistVisivel,
  temCoresParaEscolher: boolean
): boolean {
  return Boolean(
    lote.nome_modelo?.trim() &&
      (!corDoPapelObrigatoria(visivel, temCoresParaEscolher) || lote.padrao?.trim()) &&
      Number(lote.quantidade) > 0
  );
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

/**
 * O que falta no lote para a aba Artes abrir — a trava "Modelos incompletos".
 *
 * Campo que o produto não imprime não é cobrado: desde a Etapa 6c o card nem
 * mostra o campo, e cobrá-lo trancava a aba sem o usuário ter onde preencher
 * (22563: Triband sem Impressão no checklist, barrada por "Verso"). Nome e
 * quantidade são sempre cobrados; produto sem checklist segue a cobrança de
 * sempre, campo por campo.
 */
export function pendenciasDoLoteParaArtes(
  lote: {
    nome_modelo?: string | null;
    quantidade?: number | null;
    padrao?: string | null;
    gabarito_operacional?: string | null;
    numeracao_inicio?: number | string | null;
    numeracao_fim?: number | string | null;
    verso_tipo?: string | null;
  },
  visivel: ChecklistVisivel,
  /** O produto tem cor de papel para escolher? Sem isso a cor não é cobrada. */
  temCoresParaEscolher: boolean
): string[] {
  const falta = (valor: unknown) => valor === null || valor === undefined || valor === "";
  const faltam: string[] = [];
  if (!lote.nome_modelo) faltam.push("Modelo");
  if (!lote.quantidade || lote.quantidade <= 0) faltam.push("Qtd");
  if (corDoPapelObrigatoria(visivel, temCoresParaEscolher) && falta(lote.padrao)) faltam.push("Cor Papel");
  if (mostraCampo(visivel, "num_gabarito") && falta(lote.gabarito_operacional)) faltam.push("Numerador");
  if (mostraCampo(visivel, "numeracao_faixa")) {
    if (falta(lote.numeracao_inicio)) faltam.push("Nº Inicial");
    if (falta(lote.numeracao_fim)) faltam.push("Nº Final");
    if (
      !falta(lote.numeracao_inicio) &&
      !falta(lote.numeracao_fim) &&
      Number(lote.numeracao_fim) < Number(lote.numeracao_inicio)
    ) {
      faltam.push("Nº Final < Inicial");
    }
  }
  if (mostraCampo(visivel, "impressao_fv") && falta(lote.verso_tipo)) faltam.push("Verso");
  return faltam;
}
