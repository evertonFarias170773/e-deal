/**
 * "Autorizar e conferir": o segundo botão da aba Aprovar da janela Análise de
 * Faturamento. Faz o que "Confirmar Autorização" faz E a confirmação da
 * Conferência, numa chamada só à rota oficial (`POST /api/cobrancas/confirmar`,
 * `acao = "autorizar_e_conferir"`).
 *
 * POR QUE UMA AÇÃO NOVA NA ROTA, E NÃO DUAS CHAMADAS SEGUIDAS DA TELA
 *   Hoje autorizar e conferir são duas chamadas à mesma rota, cada uma com o
 *   seu UPDATE em `pagamentos_v2`. Encadeá-las pela tela deixa um intervalo em
 *   que a primeira já valeu e a segunda ainda não: se a segunda falha, a
 *   cobrança fica autorizada e na fila, sem o usuário saber. Na rota, o par vira
 *   UM UPDATE da mesma linha, que grava os dois efeitos juntos ou nenhum.
 *
 * O QUE ESTE ARQUIVO GUARDA
 *   - quando a ação se aplica (`podeAutorizarEConferir`), usado pela tela e pela
 *     rota — o servidor não confia no botão;
 *   - o que o UPDATE grava (`montarPayloadAutorizarEConferir`), que é a
 *     composição exata dos dois UPDATEs separados da rota.
 *
 * Sem dependências: roda no navegador, na rota e no teste
 * (`scripts/testes/autorizar-e-conferir.test.mts`).
 */

export const ACAO_AUTORIZAR_E_CONFERIR = "autorizar_e_conferir";

export type CobrancaDaAutorizacao = {
  tipo_cobranca?: string | null;
  status?: string | null;
  confirmado?: boolean | null;
  /** Quem autorizou. Na tela, o domínio já traz `aprovado_por` como `confirmado_por`. */
  aprovado_por?: string | null;
  confirmado_por?: string | null;
  id_int?: number | string | null;
  paid_at?: string | null;
};

function tipoNormalizado(tipo: string | null | undefined): string {
  return String(tipo ?? "").trim().toUpperCase().replace(/_/g, "-");
}

/** Faturamento (E-Faturado, E-Permuta, E-Amostra, E-Retrabalho): o que passa pela autorização do financeiro. */
function ehFaturamento(tipo: string | null | undefined): boolean {
  const t = tipoNormalizado(tipo);
  return t.startsWith("E-") || t === "EFATURADO" || t === "FATURADO";
}

/**
 * A cobrança está esperando a autorização do financeiro e, autorizada, seguiria
 * para a Fila de Conferência: faturamento, não confirmado, ainda sem quem
 * autorizou, ligado a uma proposta.
 *
 * "Ainda sem quem autorizou" é o que protege a autoria: uma cobrança que já foi
 * autorizada por alguém (e está na fila) não se encaixa — para ela o caminho é
 * "Confirmar Conferência", que não reescreve `aprovado_por`.
 */
export function podeAutorizarEConferir(cobranca: CobrancaDaAutorizacao): boolean {
  if (!ehFaturamento(cobranca.tipo_cobranca)) return false;
  if (cobranca.confirmado === true) return false;
  if (!cobranca.id_int) return false;

  const status = String(cobranca.status ?? "").trim().toUpperCase();
  if (status === "A_RECEBER") return true;
  if (status === "A_VENCER") {
    return !String(cobranca.aprovado_por ?? "").trim() && !String(cobranca.confirmado_por ?? "").trim();
  }
  return false;
}

/**
 * O que o UPDATE grava. É a soma dos dois passos de hoje, nesta ordem:
 *
 *   1. autorização (`acao = autorizar_faturamento`):
 *        status = A_VENCER, aprovado_por = quem autorizou;
 *   2. confirmação, já sobre a cobrança A_VENCER:
 *        confirmado = true, confirmado_por, data_confirmacao;
 *        e, só nos tipos que quitam na liberação (E-Permuta, E-Amostra,
 *        E-Retrabalho — não geram título), status = PAID e paid_at.
 *
 * O E-Faturado continua A_VENCER depois de conferido: quem liquida é o título
 * do Registro de Recebíveis.
 *
 * Quem autoriza e quem confere é a mesma pessoa, então os dois campos de
 * autoria levam o mesmo nome.
 */
// ===========================================================================
// DIAGNÓSTICO DE FALHA (14/10/2026)
// ===========================================================================
// No 23681 o botão falhou com "column pagamentos_v2.confirmado does not exist"
// e a rota devolveu só a mensagem: não dava para saber qual comando quebrou. Na
// ação combinada, a falha agora volta para a tela e para o log com a ETAPA, o
// código, os detalhes e a dica do banco. O que SAI é limpo: sem e-mail, sem
// CPF/CNPJ, sem token ou chave, sem a linha que o banco cita no detalhe.
//
// Só a ação combinada ganha isso. Em qualquer outra ação (Confirmar Conferência,
// Confirmar Autorização) a resposta de falha continua exatamente a de antes.

/**
 * Onde a falha aconteceu. A autorização e a conferência são UM UPDATE só, então
 * uma falha na gravação vale para as duas ao mesmo tempo; o que vem depois
 * (abatimento, status do pedido, prateleira) é a parte da conferência que roda
 * com a cobrança JÁ gravada.
 */
export type EtapaDaFalha =
  | "LEITURA_DA_COBRANCA"
  | "TRAVA_DE_QUITACAO"
  | "GRAVACAO_AUTORIZACAO_E_CONFERENCIA"
  | "RELEITURA_APOS_CORRIDA"
  | "POS_GRAVACAO_RECONCILIACAO";

export const DESCRICAO_DA_ETAPA: Record<EtapaDaFalha, string> = {
  LEITURA_DA_COBRANCA: "leitura da cobrança",
  TRAVA_DE_QUITACAO: "trava de quitação (soma das cobranças da proposta)",
  GRAVACAO_AUTORIZACAO_E_CONFERENCIA: "gravação da autorização e da conferência (um UPDATE só)",
  RELEITURA_APOS_CORRIDA: "releitura depois de a gravação não achar a linha",
  POS_GRAVACAO_RECONCILIACAO: "depois da gravação: abatimento, status do pedido ou liberação de prateleira"
};

/**
 * Tira de um texto de erro o que não pode sair: token, chave, e-mail,
 * CPF/CNPJ, números longos e a linha que o banco cita ("Failing row contains
 * (...)"). Aparar para `max` caracteres. Nulo se não sobrar nada.
 */
export function limparTextoDeDiagnostico(texto: unknown, max = 300): string | null {
  if (texto === null || texto === undefined) return null;
  let t = String(texto).replace(/\s+/g, " ").trim();
  if (!t) return null;

  t = t
    .replace(/Failing row contains \([^)]*\)/gi, "Failing row contains ([omitido])")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [chave]")
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g, "[chave]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[documento]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[chave]")
    .replace(/\d{9,}/g, "[número]");

  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export type DiagnosticoDeFalha = {
  success: false;
  /** Código do Postgres/PostgREST (42703, 23505, PGRST...), ou nulo. */
  code: string | null;
  etapa: EtapaDaFalha;
  etapa_descricao: string;
  error: string;
  details: string | null;
  hint: string | null;
  /** `true` quando o UPDATE já tinha valido: a cobrança ESTÁ autorizada e conferida. */
  gravada: boolean;
};

/** Monta o diagnóstico de uma falha, já limpo. Aceita Error, PostgrestError ou qualquer coisa lançada. */
export function diagnosticarFalha(erro: unknown, etapa: EtapaDaFalha): DiagnosticoDeFalha {
  const e = (erro && typeof erro === "object" ? erro : {}) as Record<string, unknown>;
  const codigoBruto = typeof e.code === "string" ? e.code : "";
  return {
    success: false,
    code: /^[A-Za-z0-9_]{2,16}$/.test(codigoBruto) ? codigoBruto : null,
    etapa,
    etapa_descricao: DESCRICAO_DA_ETAPA[etapa],
    error: limparTextoDeDiagnostico(e.message ?? (typeof erro === "string" ? erro : null)) ?? "Falha ao autorizar e conferir.",
    details: limparTextoDeDiagnostico(e.details),
    hint: limparTextoDeDiagnostico(e.hint),
    gravada: etapa === "POS_GRAVACAO_RECONCILIACAO"
  };
}

/**
 * A resposta de falha da rota (`catch` do POST /api/cobrancas/confirmar).
 *
 * Fora da ação combinada devolve EXATAMENTE o que a rota sempre devolveu:
 * `{ success: false, error: err.message }` com status 500. É isto que garante
 * que "Confirmar Conferência" e "Confirmar Autorização" seguem iguais.
 */
export function respostaDeFalhaDaRota(
  ehAutorizarEConferir: boolean,
  erro: unknown,
  etapa: EtapaDaFalha
): { status: number; corpo: Record<string, unknown> } {
  if (!ehAutorizarEConferir) {
    return { status: 500, corpo: { success: false, error: (erro as { message?: unknown } | null)?.message } };
  }
  return { status: 500, corpo: { ...diagnosticarFalha(erro, etapa) } };
}

/**
 * O texto que a tela mostra. Resposta sem `etapa` (qualquer outra ação) sai
 * como veio: só a mensagem.
 */
export function mensagemDeFalhaParaATela(corpo: {
  error?: unknown;
  etapa?: unknown;
  etapa_descricao?: unknown;
  code?: unknown;
  hint?: unknown;
  details?: unknown;
  gravada?: unknown;
}): string {
  const base = String(corpo.error ?? "").trim();
  if (!corpo.etapa) return base;

  const partes = [`Etapa: ${String(corpo.etapa_descricao || corpo.etapa)}`];
  if (corpo.code) partes.push(`código ${String(corpo.code)}`);
  if (corpo.hint) partes.push(`dica: ${String(corpo.hint)}`);
  if (corpo.details) partes.push(`detalhes: ${String(corpo.details)}`);
  const aviso = corpo.gravada === true
    ? " A gravação já tinha valido: confira a cobrança antes de tentar de novo."
    : "";
  return `${base || "Falha ao autorizar e conferir."} (${partes.join("; ")}).${aviso}`;
}

export function montarPayloadAutorizarEConferir(
  cobranca: Pick<CobrancaDaAutorizacao, "paid_at">,
  op: { confirmadoPor: string; agoraIso: string; quitaNaLiberacao: boolean }
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    status: op.quitaNaLiberacao ? "PAID" : "A_VENCER",
    aprovado_por: op.confirmadoPor,
    confirmado: true,
    confirmado_por: op.confirmadoPor,
    data_confirmacao: op.agoraIso
  };
  if (op.quitaNaLiberacao) {
    payload.paid_at = cobranca.paid_at ?? op.agoraIso;
  }
  return payload;
}
