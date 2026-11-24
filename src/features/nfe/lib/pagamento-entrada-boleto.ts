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

// ---------------------------------------------------------------------------
// Proteção das parcelas (24/11/2026, NF 41686 / NFE-25427-001).
//
// A nota saiu com 1x PIX à vista porque (1) o select "Forma de Pagamento" do
// gerador herdava a forma da parcela 1 — a entrada PIX — e (2) o Salvar,
// chamado pelo "Concluir e emitir", recriava uma parcela única à vista sempre
// que esse select não era boleto. As regras abaixo fecham os dois caminhos e
// dão à conclusão uma conferência antes de preparar o envio.
// ---------------------------------------------------------------------------

export type ParcelaFiscal = {
  numero_parcela?: number | null;
  tipo_registro?: string | null;
  forma_pagamento?: string | null;
  valor?: number | string | null;
  ativo?: boolean | null;
};

function ativas<T extends ParcelaFiscal>(parcelas: readonly T[]): T[] {
  return parcelas.filter((p) => p.ativo !== false);
}

function ehEntrada(p: ParcelaFiscal): boolean {
  return String(p.tipo_registro ?? "").toUpperCase() === "ENTRADA";
}

function centavos(valor: number | string | null | undefined): number {
  return Math.round((Number(valor) || 0) * 100);
}

export function formatarReais(valor: number | string | null | undefined): string {
  return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function rotuloCurto(forma: string | null | undefined): string {
  return rotuloDaFormaFiscal(forma) ?? `forma ${forma ?? "—"}`;
}

/**
 * (a) A forma que o select do gerador mostra ao abrir: a da primeira parcela
 * que NÃO é a entrada; sem ela, a forma gravada na nota. Nunca a da entrada.
 */
export function formaDoGeradorPelasParcelas(
  parcelas: readonly ParcelaFiscal[],
  formaDaNota: string | null | undefined
): string | null {
  const naoEntrada = ativas(parcelas).find((p) => !ehEntrada(p) && p.forma_pagamento);
  if (naoEntrada) return String(naoEntrada.forma_pagamento);
  return formaDaNota ? String(formaDaNota) : null;
}

/**
 * (b) Salvar (a nota ou um item) pode recriar a parcela à vista? Só quando a
 * forma do gerador não é boleto E a nota tem no máximo uma parcela. Com duas ou
 * mais, grava o que está na tela e nunca troca o conjunto.
 */
export function salvarRecriaParcelaAVista(qtdParcelasAtivas: number, formaDoGerador: string | null | undefined): boolean {
  return String(formaDoGerador ?? FORMA_BOLETO) !== FORMA_BOLETO && qtdParcelasAtivas <= 1;
}

/** Quantidade e forma de cada parcela, na ordem da parcela. */
export function assinaturaDasParcelas(parcelas: readonly ParcelaFiscal[]): string {
  const lista = ativas(parcelas)
    .slice()
    .sort((a, b) => (Number(a.numero_parcela) || 0) - (Number(b.numero_parcela) || 0))
    .map((p) => String(p.forma_pagamento ?? ""));
  return `${lista.length}|${lista.join(",")}`;
}

/** (c) O Salvar mudou o número de parcelas ou as formas? */
export function salvarMudouAsParcelas(
  naTela: readonly ParcelaFiscal[],
  noBanco: readonly ParcelaFiscal[]
): boolean {
  return assinaturaDasParcelas(naTela) !== assinaturaDasParcelas(noBanco);
}

/** Descrição curta das parcelas, para aviso: "1: PIX R$ 10,00 · 2: Boleto…". */
export function descreverParcelas(parcelas: readonly ParcelaFiscal[]): string {
  const lista = ativas(parcelas)
    .slice()
    .sort((a, b) => (Number(a.numero_parcela) || 0) - (Number(b.numero_parcela) || 0));
  if (lista.length === 0) return "nenhuma parcela";
  return lista
    .map((p, i) => `${p.numero_parcela ?? i + 1}: ${rotuloCurto(p.forma_pagamento)} ${formatarReais(p.valor)}`)
    .join(" · ");
}

/**
 * (c) As parcelas batem com o "Faturado com entrada" do pedido? Esperado: uma
 * parcela de entrada na forma da cobrança de entrada e com o valor dela, e o
 * resto em boleto somando o restante. Devolve as diferenças (vazio = bate).
 */
export function diferencasDoFaturadoComEntrada(
  parcelas: readonly ParcelaFiscal[],
  faturado: Pick<SugestaoEntradaBoleto, "formaEntrada" | "valorEntrada" | "valorRestante">
): string[] {
  const lista = ativas(parcelas);
  const diferencas: string[] = [];
  const entrada = lista.find(ehEntrada) ?? null;
  const resto = lista.filter((p) => p !== entrada);

  if (!entrada) {
    diferencas.push(
      `Falta a parcela de entrada: o pedido tem entrada em ${rotuloCurto(faturado.formaEntrada)} de ${formatarReais(faturado.valorEntrada)}.`
    );
  } else {
    if (String(entrada.forma_pagamento ?? "") !== faturado.formaEntrada) {
      diferencas.push(
        `A entrada está em ${rotuloCurto(entrada.forma_pagamento)}; no pedido ela é ${rotuloCurto(faturado.formaEntrada)}.`
      );
    }
    if (centavos(entrada.valor) !== centavos(faturado.valorEntrada)) {
      diferencas.push(
        `A entrada está com ${formatarReais(entrada.valor)}; no pedido ela é ${formatarReais(faturado.valorEntrada)}.`
      );
    }
  }

  const foraDoBoleto = resto.filter((p) => String(p.forma_pagamento ?? "") !== FORMA_BOLETO);
  for (const p of foraDoBoleto) {
    diferencas.push(
      `A parcela ${p.numero_parcela ?? "?"} está em ${rotuloCurto(p.forma_pagamento)}; o restante do pedido é em boleto.`
    );
  }
  const somaResto = resto.reduce((acc, p) => acc + centavos(p.valor), 0);
  if (resto.length === 0) {
    diferencas.push(`Falta o boleto do restante: ${formatarReais(faturado.valorRestante)}.`);
  } else if (somaResto !== centavos(faturado.valorRestante)) {
    diferencas.push(
      `O restante soma ${formatarReais(somaResto / 100)}; no pedido ele é ${formatarReais(faturado.valorRestante)}.`
    );
  }
  return diferencas;
}

/**
 * (e) A forma gravada no cabeçalho da nota, pelas parcelas: uma forma só → ela;
 * misturada com boleto → boleto (é a parte a prazo); misturada sem boleto → a
 * da primeira parcela que não é a entrada. Sem parcela, `null` (não mexe).
 */
export function formaDaNotaPelasParcelas(parcelas: readonly ParcelaFiscal[]): string | null {
  const lista = ativas(parcelas).filter((p) => p.forma_pagamento);
  if (lista.length === 0) return null;
  const formas = new Set(lista.map((p) => String(p.forma_pagamento)));
  if (formas.size === 1) return [...formas][0];
  if (formas.has(FORMA_BOLETO)) return FORMA_BOLETO;
  return String((lista.find((p) => !ehEntrada(p)) ?? lista[0]).forma_pagamento);
}

// ---------------------------------------------------------------------------
// (d) O que vai sair: resumo do pagamento lido do payload pronto.
// ---------------------------------------------------------------------------

export type ResumoPagamentoDoPayload = {
  formas: { forma: string; rotulo: string; valor: number; prazo: "à vista" | "a prazo" }[];
  duplicatas: { numero: string | null; vencimento: string | null; valor: number }[];
  fatura: { original: number; desconto: number; liquido: number } | null;
  total: number | null;
};

function lista(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? (valor.filter((v) => v && typeof v === "object") as Record<string, unknown>[]) : [];
}

/**
 * Lê formas, à vista/a prazo, duplicatas e fatura do payload que vai à Focus.
 * À vista/a prazo: o `indicador_pagamento` quando o payload traz (0 = à vista,
 * 1 = a prazo); sem ele, boleto com duplicata é a prazo e o resto, à vista.
 * `null` quando não há payload.
 */
export function resumoPagamentoDoPayload(payload: unknown): ResumoPagamentoDoPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const duplicatas = lista(p.duplicatas).map((d) => ({
    numero: d.numero == null ? null : String(d.numero),
    vencimento: d.data_vencimento == null ? null : String(d.data_vencimento).slice(0, 10),
    valor: Number(d.valor) || 0
  }));
  const formas = lista(p.formas_pagamento).map((f) => {
    const forma = String(f.forma_pagamento ?? "");
    const indicador = f.indicador_pagamento == null ? null : String(f.indicador_pagamento);
    const prazo: "à vista" | "a prazo" =
      indicador === "1"
        ? "a prazo"
        : indicador === "0"
          ? "à vista"
          : forma === FORMA_BOLETO && duplicatas.length > 0
            ? "a prazo"
            : "à vista";
    return { forma, rotulo: rotuloCurto(forma), valor: Number(f.valor_pagamento) || 0, prazo };
  });
  const fatura =
    p.valor_original_fatura != null || p.valor_liquido_fatura != null
      ? {
          original: Number(p.valor_original_fatura) || 0,
          desconto: Number(p.valor_desconto_fatura) || 0,
          liquido: Number(p.valor_liquido_fatura) || 0
        }
      : null;
  const total = p.valor_total == null ? null : Number(p.valor_total);
  return { formas, duplicatas, fatura, total: Number.isFinite(total) ? total : null };
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
