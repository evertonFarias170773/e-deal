/**
 * Revisão do faturado: o pagamento inteiro do pedido (24/11/2026, caso 25427).
 *
 * Quando o Faturado nasceu de "Faturado com entrada", a janela Análise de
 * Faturamento mostrava só ele: nada dizia que era o restante de um pedido maior,
 * com uma entrada em PIX ou boleto. Estas regras puras (sem I/O e sem React)
 * acham a entrada do mesmo "Faturado com entrada" e montam o quadro que a
 * janela mostra: total do pedido, entrada (forma, valor, situação) e o restante
 * com a previsão das parcelas.
 *
 * É SÓ TELA: nada aqui grava, nem muda regra ou valor.
 *
 * Como achar o par: a rota `POST /api/cobrancas/faturado-com-entrada` grava a
 * entrada e o restante num ÚNICO insert (mesmo `created_at`, mesmo `id_int`), e
 * as descrições saem de `montarLinhasFaturadoComEntrada` com os prefixos abaixo
 * (o teste amarra os prefixos ao construtor). Pares antigos cancelados e refeitos
 * têm outro `created_at`, então cada restante acha só a SUA entrada.
 */

export const PREFIXO_RESTANTE_FATURADO_COM_ENTRADA = "Restante (Faturado) do Faturado com entrada";
export const PREFIXO_ENTRADA_FATURADO_COM_ENTRADA = "Entrada (";

export type LinhaDoPedido = {
  id: string;
  id_pagamento: string | null;
  tipo_cobranca: string | null;
  status: string | null;
  valor: number | string | null;
  paid_at: string | null;
  confirmado: boolean | null;
  vencimento: string | null;
  descricao: string | null;
  created_at: string | null;
  p_qtd_parcelas?: number | null;
  p_valor_entrada?: number | string | null;
  p_dias_pra_inicio?: number | null;
  p_intervalo?: number | null;
};

export function ehRestanteDeFaturadoComEntrada(descricao: string | null | undefined): boolean {
  return String(descricao ?? "").trim().startsWith(PREFIXO_RESTANTE_FATURADO_COM_ENTRADA);
}

function instante(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const t = Date.parse(valor);
  return Number.isFinite(t) ? t : null;
}

/**
 * A entrada do mesmo "Faturado com entrada": mesma criação (o insert único),
 * descrição de entrada, e não é o próprio faturado. `null` se não achar.
 */
export function acharEntradaDoFaturado(faturado: LinhaDoPedido, linhas: readonly LinhaDoPedido[]): LinhaDoPedido | null {
  const criado = instante(faturado.created_at);
  if (criado == null) return null;
  const candidatas = linhas.filter(
    (l) =>
      l.id !== faturado.id &&
      String(l.descricao ?? "").trim().startsWith(PREFIXO_ENTRADA_FATURADO_COM_ENTRADA) &&
      instante(l.created_at) === criado
  );
  return candidatas.length === 1 ? candidatas[0] : null;
}

const STATUS_CANCELADOS = new Set(["CANCELADO", "CANCELADA", "CANCELLED"]);

export type SituacaoDaEntrada = { codigo: "PAGA_CONFERIDA" | "PAGA" | "NAO_PAGA" | "CANCELADA"; texto: string };

function dataBr(iso: string | null | undefined, fusoSaoPaulo: boolean): string | null {
  if (!iso) return null;
  const s = String(iso);
  if (!fusoSaoPaulo && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [a, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${a}`;
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(t);
}

export function situacaoDaEntrada(entrada: Pick<LinhaDoPedido, "status" | "paid_at" | "confirmado" | "vencimento">): SituacaoDaEntrada {
  const status = String(entrada.status ?? "").trim().toUpperCase();
  if (STATUS_CANCELADOS.has(status)) return { codigo: "CANCELADA", texto: "Cancelada" };
  if (status === "PAID" || entrada.paid_at) {
    const quando = dataBr(entrada.paid_at, true);
    if (entrada.confirmado === true) {
      return { codigo: "PAGA_CONFERIDA", texto: quando ? `Paga em ${quando} e conferida` : "Paga e conferida" };
    }
    return { codigo: "PAGA", texto: quando ? `Paga em ${quando}, aguardando conferência` : "Paga, aguardando conferência" };
  }
  const vence = dataBr(entrada.vencimento, false);
  return { codigo: "NAO_PAGA", texto: vence ? `Ainda não paga (vence em ${vence})` : "Ainda não paga" };
}

export type ParcelaPrevista = { numero: number; total: number; valor: number; dias: number; ehEntrada: boolean };

function centavos(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * A previsão das parcelas do faturado, com a MESMA conta de "Preparar Boletos"
 * (PrepararBoletosModal, handleGerarParcelas, sem arredondamento): valor igual
 * por parcela, truncado no centavo, e a diferença na última; a 1ª vence
 * `dias_pra_inicio` dias depois da emissão e as seguintes a cada `intervalo`.
 * Com entrada da condição (`p_valor_entrada` > 0), ela vem antes, no dia.
 * As datas de verdade só existem quando os boletos forem preparados.
 */
export function parcelasPrevistasDoFaturado(f: Pick<LinhaDoPedido, "valor" | "p_qtd_parcelas" | "p_valor_entrada" | "p_dias_pra_inicio" | "p_intervalo">): ParcelaPrevista[] {
  const totalCent = centavos(f.valor);
  if (totalCent <= 0) return [];
  const qtd = Math.max(1, Math.trunc(Number(f.p_qtd_parcelas) || 1));
  const inicio = Math.max(0, Math.trunc(Number(f.p_dias_pra_inicio) || 0));
  const intervalo = Math.max(0, Math.trunc(Number(f.p_intervalo) || 0));
  const entradaCent = centavos(f.p_valor_entrada);
  const temEntrada = entradaCent > 0 && entradaCent < totalCent;
  const restanteCent = temEntrada ? totalCent - entradaCent : totalCent;
  const totalParcelas = qtd + (temEntrada ? 1 : 0);
  const base = Math.floor(restanteCent / qtd);
  const lista: ParcelaPrevista[] = [];
  if (temEntrada) lista.push({ numero: 1, total: totalParcelas, valor: entradaCent / 100, dias: 0, ehEntrada: true });
  for (let i = 1; i <= qtd; i++) {
    const valorCent = i === qtd ? restanteCent - base * (qtd - 1) : base;
    lista.push({
      numero: i + (temEntrada ? 1 : 0),
      total: totalParcelas,
      valor: valorCent / 100,
      dias: inicio + (i - 1) * intervalo,
      ehEntrada: false
    });
  }
  return lista;
}

export function rotuloDaFormaDaEntrada(tipo: string | null | undefined): string {
  const t = String(tipo ?? "").trim().toUpperCase();
  if (t === "PIX") return "PIX";
  if (t === "BOLETO") return "Boleto";
  return t || "—";
}

export type QuadroPagamentoInteiro = {
  totalDoPedido: number | null;
  entrada: {
    id_pagamento: string | null;
    forma: string;
    valor: number;
    situacao: SituacaoDaEntrada;
  } | null;
  restante: { id_pagamento: string | null; valor: number; parcelas: ParcelaPrevista[] };
  /** Entrada + restante, quando difere do total do pedido de hoje (o pedido mudou depois). */
  somaDivergente: number | null;
};

/**
 * O quadro da janela, ou `null` quando o faturado não veio de "Faturado com
 * entrada" (aí a janela fica como sempre foi).
 */
export function montarQuadroPagamentoInteiro(entrada: {
  faturado: LinhaDoPedido;
  linhasDoPedido: readonly LinhaDoPedido[];
  totalDoPedido: number | string | null;
}): QuadroPagamentoInteiro | null {
  const { faturado } = entrada;
  if (!ehRestanteDeFaturadoComEntrada(faturado.descricao)) return null;
  const achada = acharEntradaDoFaturado(faturado, entrada.linhasDoPedido);
  const totalCent = entrada.totalDoPedido == null || entrada.totalDoPedido === "" ? null : centavos(entrada.totalDoPedido);
  const restanteCent = centavos(faturado.valor);
  const entradaCent = achada ? centavos(achada.valor) : null;
  const soma = entradaCent != null ? entradaCent + restanteCent : null;
  return {
    totalDoPedido: totalCent != null && totalCent > 0 ? totalCent / 100 : null,
    entrada: achada
      ? {
          id_pagamento: achada.id_pagamento,
          forma: rotuloDaFormaDaEntrada(achada.tipo_cobranca),
          valor: (entradaCent ?? 0) / 100,
          situacao: situacaoDaEntrada(achada)
        }
      : null,
    restante: { id_pagamento: faturado.id_pagamento, valor: restanteCent / 100, parcelas: parcelasPrevistasDoFaturado(faturado) },
    somaDivergente: soma != null && totalCent != null && totalCent > 0 && soma !== totalCent ? soma / 100 : null
  };
}
