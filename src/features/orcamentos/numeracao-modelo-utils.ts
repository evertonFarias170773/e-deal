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

/* ------------------------------------------------------------------------- */
/* CONFERÊNCIA DO Nº FINAL NA GRAVAÇÃO (29/10/2026)                            */
/* ------------------------------------------------------------------------- */

/**
 * O que a gravação confere antes de escrever. Seis modelos Ticket (24054,
 * 24420, 24500) foram gravados com Nº final = QTD: a tela calculou com ×1
 * porque o numerador ainda não estava na lista dela, e quem grava aceitava o
 * número que a tela mandava. Agora a gravação refaz a conta pelo CADASTRO do
 * numerador e recusa quando o número enviado é outro.
 *
 * SÓ LINHA NOVA OU TOCADA. Linha já gravada em que QTD, Nº inicial e numerador
 * são os do banco passa sem conferência, para o Salvar de pedido antigo não
 * travar por causa de faixa gravada antes desta regra. O aviso "gravado ×
 * calculado" da impressão continua sendo quem aponta esses casos.
 */

/** Um lote como chega para ser gravado. */
export type LoteParaConferirFim = {
  id?: number | null;
  nome_modelo?: string | null;
  quantidade?: number | string | null;
  tipo_numeracao?: string | null;
  numeracao_inicio?: number | string | null;
  numeracao_fim?: number | string | null;
  gabarito_operacional?: string | null;
  mapa_teatro_id?: unknown;
  mapa_teatro_setor_id?: unknown;
};

/** O mesmo lote como está no banco: só o que decide se ele foi tocado. */
export type LoteGravadoParaConferir = {
  id: number;
  quantidade?: number | string | null;
  numeracao_inicio?: number | string | null;
  gabarito_operacional?: string | null;
};

export type FimRecusado = {
  id: number | null;
  nome: string;
  numerador: string;
  enviado: number | null;
  esperado: number | null;
  motivo: string;
};

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const numeroOuNulo = (v: unknown): number | null => (vazio(v) ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const textoAparado = (v: unknown) => String(v ?? "").trim();

/**
 * O lote é novo, ou mudou QTD, Nº inicial ou numerador em relação ao banco?
 * Sem a linha do banco (id ausente ou não encontrado) conta como novo.
 */
export function loteFoiTocado(lote: LoteParaConferirFim, gravado: LoteGravadoParaConferir | null | undefined): boolean {
  if (!gravado) return true;
  if (Number(lote.quantidade) !== Number(gravado.quantidade)) return true;
  if (numeroOuNulo(lote.numeracao_inicio) !== numeroOuNulo(gravado.numeracao_inicio)) return true;
  return textoAparado(lote.gabarito_operacional) !== textoAparado(gravado.gabarito_operacional);
}

/**
 * Confere o Nº final de UM lote com a conta do cadastro. `null` = confere (ou
 * não há faixa a conferir). Não confere: Mapa de Teatro, SEM_NUMERACAO e lote
 * sem Nº inicial — nesses não há faixa calculada. Lote sem numerador usa ×1,
 * a mesma conta da tela.
 */
export function recusaDoFim(lote: LoteParaConferirFim, numeracoes: NumeracaoOpcao[]): FimRecusado | null {
  if (lote.mapa_teatro_id || lote.mapa_teatro_setor_id) return null;
  if (textoAparado(lote.tipo_numeracao).toUpperCase() === "SEM_NUMERACAO") return null;
  const inicio = numeroOuNulo(lote.numeracao_inicio);
  if (inicio === null) return null;

  const base = {
    id: lote.id && Number(lote.id) > 0 ? Number(lote.id) : null,
    nome: textoAparado(lote.nome_modelo),
    numerador: textoAparado(lote.gabarito_operacional),
    enviado: numeroOuNulo(lote.numeracao_fim)
  };

  let numeracao: NumeracaoOpcao | null = null;
  if (base.numerador) {
    numeracao = findNumeracaoByName(numeracoes, base.numerador);
    if (!numeracao) {
      return { ...base, esperado: null, motivo: `o numerador "${base.numerador}" não está no cadastro de numerações` };
    }
  }
  const { multiplicador, erro } = resolverMultiplicadorNumeracao(numeracao);
  if (multiplicador === null) return { ...base, esperado: null, motivo: erro ?? "numerador sem multiplicador no cadastro" };

  const esperado = calcularNumeracaoFim(inicio, Number(lote.quantidade), multiplicador);
  if (esperado === null) return null;
  if (base.enviado === esperado) return null;
  return { ...base, esperado, motivo: `Nº final ${base.enviado ?? "vazio"}, o cadastro dá ${esperado}` };
}

/** Confere a lista: só as linhas novas ou tocadas. */
export function conferirFimDosLotes(
  lotes: readonly LoteParaConferirFim[],
  gravados: readonly LoteGravadoParaConferir[],
  numeracoes: NumeracaoOpcao[]
): FimRecusado[] {
  const porId = new Map(gravados.map((g) => [Number(g.id), g]));
  return lotes
    .filter((l) => loteFoiTocado(l, l.id ? porId.get(Number(l.id)) : null))
    .map((l) => recusaDoFim(l, numeracoes))
    .filter((r): r is FimRecusado => r !== null);
}

/** A mensagem da recusa, para a tela mostrar como veio. */
export function mensagemDaRecusaDoFim(recusas: readonly FimRecusado[]): string {
  const linhas = recusas
    .slice(0, 5)
    .map((r) => `${r.id ? `#${r.id} ` : ""}${r.nome || "modelo"}${r.numerador ? ` (${r.numerador})` : ""}: ${r.motivo}`);
  const resto = recusas.length > 5 ? [`e mais ${recusas.length - 5}`] : [];
  return [
    `Nada foi gravado: o Nº final de ${recusas.length} modelo(s) não confere com o cadastro do numerador.`,
    ...linhas,
    ...resto,
    "Reabra o lote, escolha o numerador de novo e grave."
  ].join(" ");
}

/* ------------------------------------------------------------------------- */
/* GRADE: NUMERADOR FORA DA LISTA (29/10/2026)                                 */
/* ------------------------------------------------------------------------- */

/**
 * Numerador escolhido que a lista da tela ainda não tem: a lista está
 * carregando, ou o nome não está nela. Sem ele não se sabe o multiplicador, e
 * calcular dava ×1 — foi assim que o Ticket saiu com Nº final = QTD.
 * Sem numerador escolhido não é "fora da lista": a conta de sempre usa ×1.
 */
export function numeradorForaDaLista(gabarito: string | null | undefined, numeracoes: NumeracaoOpcao[]): boolean {
  if (!textoAparado(gabarito)) return false;
  return findNumeracaoByName(numeracoes, gabarito) === null;
}

/**
 * Lote que a grade segura: numerador fora da lista E linha nova ou tocada.
 * Linha do banco em que ninguém mexeu não é segurada — segue com o que tem
 * gravado, como sempre. Setor de Mapa de Teatro não tem faixa.
 */
export function loteSeguradoPeloNumerador(
  lote: LoteParaConferirFim,
  gravado: LoteGravadoParaConferir | null | undefined,
  numeracoes: NumeracaoOpcao[]
): boolean {
  if (lote.mapa_teatro_id || lote.mapa_teatro_setor_id) return false;
  return numeradorForaDaLista(lote.gabarito_operacional, numeracoes) && loteFoiTocado(lote, gravado);
}

/**
 * O Nº final que a grade põe na linha. Numerador fora da lista: linha
 * segurada fica sem Nº final (nunca ×1), e linha intocada mantém o gravado.
 * Com o numerador na lista, a conta de sempre.
 */
export function fimDaGradeParaLote(
  inicio: number,
  quantidade: number,
  lote: LoteParaConferirFim,
  gravado: (LoteGravadoParaConferir & { numeracao_fim?: number | string | null }) | null | undefined,
  numeracoes: NumeracaoOpcao[]
): number | null {
  if (numeradorForaDaLista(lote.gabarito_operacional, numeracoes)) {
    const comFaixa = { ...lote, numeracao_inicio: inicio, quantidade };
    if (loteFoiTocado(comFaixa, gravado)) return null;
    return numeroOuNulo(gravado?.numeracao_fim ?? lote.numeracao_fim);
  }
  const { multiplicador } = resolverMultiplicadorNumeracao(findNumeracaoByName(numeracoes, lote.gabarito_operacional));
  return calcularNumeracaoFim(inicio, quantidade, multiplicador);
}

/* ------------------------------------------------------------------------- */
/* SALVAR CORRIGE O Nº FINAL DA LINHA INTOCADA (29/10/2026)                    */
/* ------------------------------------------------------------------------- */

export type CorrecaoDoFim = { id: number; de: number; para: number };

/**
 * O aviso manda "Salve para corrigir", mas o Salvar levava o Nº final que a
 * linha já tinha (pedido 24420: 4000 em vez de 20000) — a grade só repassa ao
 * formulário a linha em que alguém mexe. Aqui, a linha JÁ GRAVADA em que
 * ninguém mexeu (QTD, Nº inicial e numerador como no banco) e cujo Nº final
 * difere da conta do numerador de hoje sai com o Nº final da conta.
 *
 * É a MESMA comparação do aviso (`divergenciaDoFim`): numerador fora do
 * cadastro, SEM_NUMERACAO, Mapa de Teatro, sem Nº inicial ou sem Nº final não
 * são tocados. Linha tocada não entra — essa é conferida por
 * `conferirFimDosLotes`. Linha que já confere não aparece.
 */
export function correcoesDoFimIntocado(
  lotes: readonly LoteParaConferirFim[],
  gravados: readonly LoteGravadoParaConferir[],
  numeracoes: NumeracaoOpcao[]
): CorrecaoDoFim[] {
  const porId = new Map(gravados.map((g) => [Number(g.id), g]));
  const correcoes: CorrecaoDoFim[] = [];
  for (const lote of lotes) {
    const id = Number(lote.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const gravado = porId.get(id);
    if (!gravado || loteFoiTocado(lote, gravado)) continue;
    const d = divergenciaDoFim({ ...lote, id }, numeracoes);
    if (d) correcoes.push({ id, de: d.gravado, para: d.calculado });
  }
  return correcoes;
}

/** Aplica as correções no que vai ser gravado: só o Nº final das linhas citadas muda. */
export function aplicarCorrecoesDoFim<T extends { id?: number | null; numeracao_fim?: number | string | null }>(
  modelos: readonly T[],
  correcoes: readonly CorrecaoDoFim[]
): T[] {
  if (correcoes.length === 0) return [...modelos];
  const porId = new Map(correcoes.map((c) => [c.id, c.para]));
  return modelos.map((m) => {
    const para = m.id ? porId.get(Number(m.id)) : undefined;
    return para === undefined ? m : { ...m, numeracao_fim: para };
  });
}
