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

/* ------------------------------------------------------------------------- */
/* Nº FINAL GRAVADO × CALCULADO (09/10/2026)                                   */
/* ------------------------------------------------------------------------- */

/**
 * O Nº Final é calculado na tela e GRAVADO no modelo. Nada o refaz quando o
 * cadastro do numerador muda depois: no pedido 23161 o modelo foi gravado com
 * 1–800 (400 un × 2) e o numerador passou a consumir 4 por unidade — a tela
 * mostrava 1600, o banco e a OS impressa seguiam com 800.
 *
 * Estas funções só COMPARAM, com a mesma conta de cima (`calcularNumeracaoFim`
 * + `resolverMultiplicadorNumeracao`). Não gravam e não corrigem nada: servem
 * ao aviso da Lista rápida e à confirmação antes de imprimir a OS.
 */
export type ModeloComFaixaGravada = {
  id?: number | null;
  id_int?: number | null;
  nome_modelo?: string | null;
  quantidade?: number | string | null;
  tipo_numeracao?: string | null;
  numeracao_inicio?: number | string | null;
  numeracao_fim?: number | string | null;
  gabarito_operacional?: string | null;
  /** Setor de Mapa de Teatro: os assentos são os do mapa, não há faixa a conferir. */
  mapa_teatro_setor_id?: unknown;
  mapa_teatro_id?: unknown;
};

export type FimDivergente = {
  id: number | null;
  idInt: number | null;
  nome: string;
  numerador: string;
  gravado: number;
  calculado: number;
};

/**
 * O Nº Final que a conta dá HOJE para o que está gravado no modelo, ou `null`
 * quando não há o que conferir — e aí NÃO há aviso. Não confere:
 *   - lista de numeradores ainda não carregada;
 *   - setor de Mapa de Teatro;
 *   - modelo SEM_NUMERACAO, ou sem Nº Inicial, sem Nº Final ou sem quantidade;
 *   - modelo sem numerador, ou com numerador que não está na lista (exclusivo de
 *     outro cliente, apagado): sem ele não se sabe o multiplicador;
 *   - numerador TICKET sem `ticket_qtd` válido.
 * "Sequencial entre os modelos" e "Cada modelo começa do 1" não entram: a
 * comparação usa o Nº Inicial GRAVADO, não o que o modo recalcula na tela.
 */
export function fimCalculadoDoGravado(modelo: ModeloComFaixaGravada, numeracoes: NumeracaoOpcao[]): number | null {
  if (!Array.isArray(numeracoes) || numeracoes.length === 0) return null;
  if (modelo.mapa_teatro_setor_id || modelo.mapa_teatro_id) return null;
  if (String(modelo.tipo_numeracao ?? "").toUpperCase() === "SEM_NUMERACAO") return null;
  if (modelo.numeracao_inicio === null || modelo.numeracao_inicio === undefined || modelo.numeracao_inicio === "") return null;
  if (modelo.numeracao_fim === null || modelo.numeracao_fim === undefined || modelo.numeracao_fim === "") return null;
  const gabarito = String(modelo.gabarito_operacional ?? "").trim();
  if (!gabarito) return null;
  const numeracao = findNumeracaoByName(numeracoes, gabarito);
  if (!numeracao) return null;
  const { multiplicador } = resolverMultiplicadorNumeracao(numeracao);
  return calcularNumeracaoFim(Number(modelo.numeracao_inicio), Number(modelo.quantidade), multiplicador);
}

/** A divergência de UM modelo, ou `null` quando o gravado confere (ou não há o que conferir). */
export function divergenciaDoFim(modelo: ModeloComFaixaGravada, numeracoes: NumeracaoOpcao[]): FimDivergente | null {
  const calculado = fimCalculadoDoGravado(modelo, numeracoes);
  if (calculado === null) return null;
  const gravado = Number(modelo.numeracao_fim);
  if (!Number.isFinite(gravado) || gravado === calculado) return null;
  return {
    id: modelo.id ?? null,
    idInt: modelo.id_int ?? null,
    nome: String(modelo.nome_modelo ?? "").trim(),
    numerador: String(modelo.gabarito_operacional ?? "").trim(),
    gravado,
    calculado
  };
}

/** Os modelos de uma lista cujo Nº Final gravado difere do calculado com o numerador de hoje. */
export function modelosComFimDivergente(modelos: readonly ModeloComFaixaGravada[], numeracoes: NumeracaoOpcao[]): FimDivergente[] {
  return modelos.map((m) => divergenciaDoFim(m, numeracoes)).filter((d): d is FimDivergente => d !== null);
}

/** O aviso vermelho de cada modelo na Lista rápida. */
export function avisoDoFimDivergente(d: Pick<FimDivergente, "gravado" | "calculado">): string {
  return `Nº final gravado (${d.gravado}) difere do calculado (${d.calculado}). Salve para corrigir antes de imprimir.`;
}

/**
 * A pergunta antes de imprimir a OS ou o boletim. Vazio quando não há
 * divergência — quem chama imprime direto. O documento NÃO muda: sai com o
 * número gravado, e é isso que a pergunta avisa.
 */
export function perguntaAntesDeImprimir(divergentes: readonly FimDivergente[]): string {
  if (divergentes.length === 0) return "";
  const linhas = divergentes
    .slice(0, 8)
    .map((d) => `• ${d.id ? `#${d.id} ` : ""}${d.nome || "modelo"}: gravado ${d.gravado}, calculado ${d.calculado}${d.numerador ? ` (${d.numerador})` : ""}`);
  const resto = divergentes.length > 8 ? [`• e mais ${divergentes.length - 8}`] : [];
  return [
    `Atenção: ${divergentes.length} modelo(s) deste pedido têm o Nº final gravado diferente do calculado pelo numerador de hoje.`,
    "",
    ...linhas,
    ...resto,
    "",
    "O documento sai com o número GRAVADO. Para corrigir, reabra o pedido na aba Pedido e salve.",
    "",
    "Imprimir mesmo assim?"
  ].join(String.fromCharCode(10));
}

/**
 * Numerador alterado: os pedidos que precisam ser reabertos e salvos.
 * Recebe os modelos que usam o numerador (de pedidos ainda não impressos nem
 * entregues — o filtro é de quem consulta) e o numerador JÁ com o valor novo.
 * Só lista; não corrige.
 */
export function pedidosAReabrirPeloNumerador(
  modelos: readonly ModeloComFaixaGravada[],
  numeradorNovo: NumeracaoOpcao
): { texto: string; pedidos: number[]; modelos: FimDivergente[] } {
  const nome = String(numeradorNovo?.name ?? "").trim();
  const doNumerador = modelos.filter((m) => String(m.gabarito_operacional ?? "").trim() === nome);
  const divergentes = modelosComFimDivergente(doNumerador, [numeradorNovo]);
  const pedidos = Array.from(new Set(divergentes.map((d) => d.idInt).filter((id): id is number => id !== null))).sort((a, b) => a - b);
  return { texto: pedidos.length ? "Estes pedidos precisam ser reabertos e salvos" : "", pedidos, modelos: divergentes };
}
