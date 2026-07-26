/**
 * Regras puras de numeração dos modelos de pedido (aba "Pedidos").
 *
 * O comportamento depende de `producao_numeracoes.tipo`, gravado em maiúsculas
 * ("SEQUENCIAL" | "TICKET" | "CAMAROTE" | "TEATRO"). Existem numerações cujo *nome*
 * sugere um tipo diferente do real (ex.: "camarote (Modelo 4)" tem tipo SEQUENCIAL),
 * por isso somente a coluna `tipo` decide o comportamento — nunca o nome.
 */

export const TIPO_CAMAROTE = "CAMAROTE";
export const TIPO_TICKET = "TICKET";

/** Numeração como vem de producao_numeracoes (apenas o que interessa ao cálculo). */
export type NumeracaoOpcao = {
  name?: string | null;
  tipo?: string | null;
  ticket_qtd?: number | string | null;
  [key: string]: unknown;
};

export function normalizarTipoNumeracao(tipo: unknown): string {
  return String(tipo ?? "").trim().toUpperCase();
}

/** Localiza a numeração selecionada pelo nome gravado em pedidos_modelos.gabarito_operacional. */
export function findNumeracaoByName<T extends NumeracaoOpcao>(numeracoes: T[], name?: string | null): T | null {
  if (!name) return null;
  const alvo = String(name);
  return (
    numeracoes.find((n) => String(n?.name) === alvo) ||
    numeracoes.find((n) => String(n?.name ?? "").trim() === alvo.trim()) ||
    null
  );
}

/**
 * Quantas numerações são consumidas por unidade produzida.
 * TICKET usa producao_numeracoes.ticket_qtd; os demais tipos usam 1 (comportamento atual).
 * Retorna multiplicador `null` quando o tipo é TICKET mas ticket_qtd não é válido —
 * nunca assume 1 silenciosamente nesse caso.
 */
export function resolverMultiplicadorNumeracao(
  numeracao: NumeracaoOpcao | null | undefined
): { multiplicador: number | null; erro: string | null } {
  if (normalizarTipoNumeracao(numeracao?.tipo) !== TIPO_TICKET) {
    return { multiplicador: 1, erro: null };
  }
  const bruto = numeracao?.ticket_qtd;
  const valor = Number(bruto);
  if (bruto === null || bruto === undefined || bruto === "" || !Number.isInteger(valor) || valor <= 0) {
    return {
      multiplicador: null,
      erro: `O numerador "${numeracao?.name ?? "selecionado"}" é do tipo TICKET, mas não possui "ticket_qtd" válido cadastrado em Produção › Numerações. Corrija o cadastro para calcular o Nº Final.`,
    };
  }
  return { multiplicador: valor, erro: null };
}

/**
 * Nº Final = Nº Inicial + (QTD × multiplicador) - 1.
 * Retorna null quando não há dados suficientes (ou ticket_qtd inválido) para calcular.
 */
export function calcularNumeracaoFim(
  numeracaoInicio: number | null | undefined,
  quantidade: number | null | undefined,
  multiplicador: number | null
): number | null {
  if (multiplicador === null) return null;
  // Number(null) é 0 — só valores realmente informados entram no cálculo.
  if (numeracaoInicio === null || numeracaoInicio === undefined) return null;
  if (quantidade === null || quantidade === undefined) return null;
  const start = Number(numeracaoInicio);
  const qty = Number(quantidade);
  if (!Number.isFinite(start) || !Number.isFinite(qty) || qty <= 0) return null;
  return start + qty * multiplicador - 1;
}

/** QTD do modelo Camarote = Q_CAM × L_CAM. Retorna null quando algum dos dois não está preenchido. */
export function calcularQtdCamarote(qCam?: number | null, lCam?: number | null): number | null {
  const q = Number(qCam);
  const l = Number(lCam);
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(l) || l <= 0) return null;
  return q * l;
}

/** Converte input numérico em number | null (campo vazio = null, sem default implícito). */
export function parseNumeroOpcional(valor: string): number | null {
  if (valor.trim() === "") return null;
  const num = Number(valor);
  return Number.isFinite(num) ? num : null;
}

/** Campos do modelo que participam do cálculo de numeração. */
export type ModeloNumeracaoCampos = {
  quantidade: number;
  tipo_numeracao: string | null;
  numeracao_inicio: number | null;
  numeracao_fim: number | null;
  gabarito_operacional?: string | null;
  Q_CAM?: number | null;
  L_CAM?: number | null;
  C_INI?: number | null;
};

/**
 * Campos derivados de uma alteração no modelo:
 *  - `quantidade`: apenas no tipo CAMAROTE, onde QTD = Q_CAM × L_CAM;
 *  - `numeracao_fim`: NF = NI + (QTD × multiplicador) - 1.
 *
 * Retorna `{}` quando não há nada a derivar (inclusive enquanto a lista de
 * numerações não carregou, para não calcular com o tipo/multiplicador errado).
 */
export function derivarCamposNumeracao(
  atual: ModeloNumeracaoCampos,
  partial: Partial<ModeloNumeracaoCampos>,
  numeracoes: NumeracaoOpcao[]
): { quantidade?: number; numeracao_fim?: number } {
  const derivados: { quantidade?: number; numeracao_fim?: number } = {};

  // Numerador em vigor depois desta alteração (pode ter mudado nesta mesma chamada)
  const novoGabarito =
    partial.gabarito_operacional !== undefined ? partial.gabarito_operacional : atual.gabarito_operacional;

  // Numerações ainda carregando: não deriva nada
  if (novoGabarito && numeracoes.length === 0) return derivados;

  const numeracao = findNumeracaoByName(numeracoes, novoGabarito);

  // QTD em vigor depois desta alteração
  let qtdEfetiva = partial.quantidade !== undefined ? partial.quantidade : atual.quantidade;

  // Camarote: QTD é sempre derivada de Q_CAM × L_CAM
  if (normalizarTipoNumeracao(numeracao?.tipo) === TIPO_CAMAROTE) {
    const qCam = partial.Q_CAM !== undefined ? partial.Q_CAM : atual.Q_CAM;
    const lCam = partial.L_CAM !== undefined ? partial.L_CAM : atual.L_CAM;
    const qtdCamarote = calcularQtdCamarote(qCam, lCam);
    if (qtdCamarote !== null) {
      qtdEfetiva = qtdCamarote;
    } else if (partial.Q_CAM !== undefined || partial.L_CAM !== undefined) {
      // Usuário está editando os campos de camarote e apagou um deles: zera a QTD para
      // não ficar divergente do cálculo. Trocar de numerador não apaga Q_CAM/L_CAM/C_INI.
      qtdEfetiva = 0;
    }
    if (qtdEfetiva !== atual.quantidade) {
      derivados.quantidade = qtdEfetiva;
    }
  }

  const novoTipo = partial.tipo_numeracao !== undefined ? partial.tipo_numeracao : atual.tipo_numeracao;
  if (novoTipo === "SEM_NUMERACAO") return derivados;

  // Nº Final é sempre automático: só recalcula quando o caller não o informou explicitamente
  if (partial.numeracao_fim !== undefined) return derivados;

  const { multiplicador } = resolverMultiplicadorNumeracao(numeracao);
  const novaQtd = qtdEfetiva;
  const novoInicio = partial.numeracao_inicio !== undefined ? partial.numeracao_inicio : atual.numeracao_inicio;

  const expectedFim = calcularNumeracaoFim(novoInicio, novaQtd, multiplicador);
  if (expectedFim !== null && expectedFim !== atual.numeracao_fim) {
    derivados.numeracao_fim = expectedFim;
  }

  return derivados;
}
