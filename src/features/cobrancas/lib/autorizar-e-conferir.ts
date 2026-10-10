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
