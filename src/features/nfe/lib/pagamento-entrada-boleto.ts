/**
 * NF-e com entrada (PIX ou outra forma) + restante em boleto — regras puras
 * da aba Pagamentos (24/11/2026, caso 25427). Sem I/O e sem React.
 *
 * DECISÃO (Everton, 24/11/2026): a nota mostra a entrada como PIX à vista e o
 * restante como boleto a prazo; duplicatas só dos boletos (001, 002…) e fatura
 * = soma dos boletos. Quem monta isso no envio é `fn_montar_payload_nfe`
 * (migration 20261124_payload_nfe_entrada_mais_boleto). Aqui fica só o que a
 * TELA decide:
 *   - cada parcela pode ter a sua forma;
 *   - a entrada gerada pelo gerador recebe a forma e a data escolhidas (o
 *     gerador do banco, `fn_gerar_pagamentos_nfe`, ainda grava todas as
 *     parcelas com uma forma só);
 *   - pedido com "Faturado com entrada" traz o gerador preenchido pelas
 *     cobranças do pedido;
 *   - "vencimento antes da emissão" só barra boleto: é ele que vira duplicata.
 */
import {
  acharEntradaDoFaturado,
  ehRestanteDeFaturadoComEntrada,
  type LinhaDoPedido
} from "@/features/cobrancas/lib/revisao-faturado-com-entrada";

export const FORMA_BOLETO = "15";
export const FORMA_PIX = "17";

/** Rótulo gravado em `descricao_forma_pagamento`, como o gerador do banco grava o boleto. */
export const ROTULO_FORMA_FISCAL: Record<string, string> = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de crédito",
  "04": "Cartão de débito",
  "15": "Boleto bancário",
  "17": "PIX",
  "90": "Sem pagamento",
  "99": "Outros"
};

export function rotuloDaFormaFiscal(codigo: string | null | undefined): string | null {
  return ROTULO_FORMA_FISCAL[String(codigo ?? "")] ?? null;
}

/** Cobrança da entrada (PIX ou BOLETO, como a rota grava) → código fiscal. */
export function formaFiscalDaCobranca(tipoCobranca: string | null | undefined): string | null {
  const tipo = String(tipoCobranca ?? "").trim().toUpperCase();
  if (tipo === "PIX") return FORMA_PIX;
  if (tipo === "BOLETO") return FORMA_BOLETO;
  return null;
}

/**
 * Parcela com vencimento antes da data de emissão barra a conclusão? Só a de
 * boleto: ela vira duplicata, e duplicata vencida não existe. A entrada em PIX
 * pode ter sido paga antes da nota; a data dela não vai à SEFAZ.
 */
export function vencimentoBarraConclusao(
  parcela: { forma_pagamento?: string | null; data_vencimento?: string | null },
  dataEmissaoIso: string
): boolean {
  if (String(parcela.forma_pagamento ?? FORMA_BOLETO) !== FORMA_BOLETO) return false;
  const venc = String(parcela.data_vencimento ?? "").split("T")[0];
  if (!venc) return false;
  return venc < dataEmissaoIso;
}

const CANCELADOS = new Set(["CANCELADO", "CANCELADA", "CANCELLED"]);
function ativa(linha: LinhaDoPedido): boolean {
  return !CANCELADOS.has(String(linha.status ?? "").trim().toUpperCase());
}

function dataCivil(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const s = String(valor);
  // Data pura (vencimento): é a data civil.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  // Instante (paid_at): a data em São Paulo.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

function diasEntre(deIso: string, ateIso: string): number {
  const de = Date.parse(`${deIso}T00:00:00Z`);
  const ate = Date.parse(`${ateIso}T00:00:00Z`);
  return Math.round((ate - de) / 86_400_000);
}

export type SugestaoEntradaBoleto = {
  idPagamentoEntrada: string | null;
  idPagamentoRestante: string | null;
  formaEntrada: string;
  valorEntrada: number;
  /** Data paga, ou o vencimento se ainda não foi paga. */
  dataEntrada: string;
  entradaPaga: boolean;
  valorRestante: number;
  qtdParcelas: number;
  /** Dias de hoje até o vencimento do restante (o gerador conta a partir de hoje). */
  diasPraInicio: number;
  intervalo: number;
  vencimentoRestante: string;
};

/**
 * O gerador preenchido pelas cobranças de um "Faturado com entrada": a entrada
 * (forma, valor, data) e o restante em boleto (parcelas, vencimento). `null`
 * quando o pedido não tem um par ativo (entrada e restante não cancelados).
 * Com mais de um par ativo, vale o mais recente.
 */
export function sugestaoPeloFaturadoComEntrada(
  linhas: readonly LinhaDoPedido[],
  hojeIso: string
): SugestaoEntradaBoleto | null {
  const restantes = linhas
    .filter((l) => ehRestanteDeFaturadoComEntrada(l.descricao) && ativa(l))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  for (const restante of restantes) {
    const entrada = acharEntradaDoFaturado(restante, linhas);
    if (!entrada || !ativa(entrada)) continue;
    const formaEntrada = formaFiscalDaCobranca(entrada.tipo_cobranca);
    const vencimentoRestante = dataCivil(restante.vencimento);
    const entradaPaga = Boolean(entrada.paid_at);
    const dataEntrada = dataCivil(entrada.paid_at) ?? dataCivil(entrada.vencimento);
    if (!formaEntrada || !vencimentoRestante || !dataEntrada) continue;
    const qtd = Math.max(1, Number(restante.p_qtd_parcelas) || 1);
    const intervalo = Number(restante.p_intervalo) || 30;
    return {
      idPagamentoEntrada: entrada.id_pagamento ?? null,
      idPagamentoRestante: restante.id_pagamento ?? null,
      formaEntrada,
      valorEntrada: Number(entrada.valor) || 0,
      dataEntrada,
      entradaPaga,
      valorRestante: Number(restante.valor) || 0,
      qtdParcelas: qtd,
      diasPraInicio: Math.max(0, diasEntre(hojeIso, vencimentoRestante)),
      intervalo: Math.max(1, intervalo),
      vencimentoRestante
    };
  }
  return null;
}

/**
 * As parcelas gravadas já refletem uma entrada com forma própria? Então o
 * gerador não é preenchido de novo pelas cobranças (o operador já gerou).
 */
export function parcelasJaTemEntradaComFormaPropria(
  parcelas: readonly { tipo_registro?: string | null; forma_pagamento?: string | null; ativo?: boolean | null }[]
): boolean {
  return parcelas.some(
    (p) =>
      p.ativo !== false &&
      String(p.tipo_registro ?? "") === "ENTRADA" &&
      String(p.forma_pagamento ?? FORMA_BOLETO) !== FORMA_BOLETO
  );
}
