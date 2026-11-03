/**
 * Cancelar PEDIDO cujas cobranças não movimentam dinheiro (03/11/2026, caso 24533).
 *
 * E-AMOSTRA, E-RETRABALHO e E-PERMUTA quitam na liberação: a Conferência grava
 * PAID com `paid_at` sem que dinheiro nenhum tenha entrado (`quitaNaLiberacao`
 * em cobrancas-utils). Por isso a recusa "Esta cobrança já foi recebida" barrava
 * o cancelamento do pedido sem motivo.
 *
 * A regra decide pelo TIPO da cobrança lido do banco no servidor, nunca por
 * status PAID nem por `paid_at`, e nunca pelo que a tela mandou:
 *   - todas as cobranças ativas do pedido são de um dos três tipos;
 *   - ADM (is_super_adm ou is_admin) cancela em qualquer status em que o
 *     cancelamento já é permitido; quem não é ADM, só em AGUARDANDO;
 *   - NF-e/NFS-e autorizada de produção, produção e expedição continuam barrando.
 * Qualquer cobrança com dinheiro (PIX, boleto, cartão, faturado, E-Crédito)
 * mantém a recusa de hoje. E-Crédito segue pelo estorno (mc_estornar_uso_pedido).
 *
 * Sem imports de propósito: é a mesma regra na rota e na tela, e roda em teste
 * direto no Node.
 */

const TIPOS_SEM_DINHEIRO = new Set(["E-AMOSTRA", "E-AMOSTRAS", "E-RETRABALHO", "E-PERMUTA"]);

const STATUS_INATIVOS = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

/** Status em que quem não é ADM pode cancelar o pedido só com essas cobranças. */
export const STATUS_CANCELA_SEM_DINHEIRO_QUALQUER_USUARIO = "AGUARDANDO";

function normalizarTipo(tipo: string | null | undefined): string {
  return String(tipo || "").trim().toUpperCase().replace(/_/g, "-");
}

/** A cobrança é E-Amostra, E-Retrabalho ou E-Permuta (nenhum dinheiro entra). */
export function isCobrancaSemDinheiro(tipo: string | null | undefined): boolean {
  return TIPOS_SEM_DINHEIRO.has(normalizarTipo(tipo));
}

export type CobrancaDoPedido = {
  tipo_cobranca: string | null;
  status: string | null;
};

export type EntradaCancelamentoSemDinheiro = {
  /** TODAS as cobranças do pedido, como lidas do banco. */
  cobrancas: CobrancaDoPedido[];
  statusProposta: string | null;
  ehAdm: boolean;
  temNotaViva: boolean;
  /** Mensagem pronta da nota viva, quando houver. */
  mensagemNota?: string | null;
  temProducao: boolean;
  temExpedicao: boolean;
};

export type DecisaoCancelamentoSemDinheiro =
  /** O pedido tem cobrança ativa com dinheiro (ou nenhuma ativa): vale a regra de sempre. */
  | { aplica: false }
  | { aplica: true; pode: true }
  | { aplica: true; pode: false; code: string; message: string };

/** Só as cobranças ativas, todas sem dinheiro, e pelo menos uma. */
export function pedidoSoComCobrancaSemDinheiro(cobrancas: CobrancaDoPedido[]): boolean {
  const ativas = cobrancas.filter((c) => !STATUS_INATIVOS.includes(String(c.status || "").trim().toUpperCase()));
  return ativas.length > 0 && ativas.every((c) => isCobrancaSemDinheiro(c.tipo_cobranca));
}

/**
 * A cobrança foi recusada SÓ por "já recebida" e é de um dos três tipos? Só
 * então a exceção é consultada; qualquer outra recusa (título liquidado etc.)
 * continua valendo. `codigosRecusa` = recusas que o chamador respeita.
 */
export function recusaSoPorRecebimentoSemDinheiro(codigosRecusa: readonly string[], tipo: string | null | undefined): boolean {
  return codigosRecusa.length > 0 && codigosRecusa.every((c) => c === "COBRANCA_RECEBIDA") && isCobrancaSemDinheiro(tipo);
}

export function decidirCancelamentoSemDinheiro(e: EntradaCancelamentoSemDinheiro): DecisaoCancelamentoSemDinheiro {
  if (!pedidoSoComCobrancaSemDinheiro(e.cobrancas)) return { aplica: false };

  const status = String(e.statusProposta || "").trim().toUpperCase();
  if (!e.ehAdm && status !== STATUS_CANCELA_SEM_DINHEIRO_QUALQUER_USUARIO) {
    return {
      aplica: true,
      pode: false,
      code: "SEM_DINHEIRO_SO_ADM",
      message:
        `Pedido com E-Amostra, E-Retrabalho ou E-Permuta em ${status || "sem status"}: ` +
        "só o administrador cancela fora de AGUARDANDO."
    };
  }
  if (e.temNotaViva) {
    return {
      aplica: true,
      pode: false,
      code: "NOTA_AUTORIZADA",
      message: e.mensagemNota || "O pedido tem nota fiscal autorizada. Cancele a nota antes de cancelar o pedido."
    };
  }
  if (e.temProducao) {
    return {
      aplica: true,
      pode: false,
      code: "PRODUCAO_ATIVA",
      message: "O pedido está em produção. Retire-o da produção antes de cancelar."
    };
  }
  if (e.temExpedicao) {
    return {
      aplica: true,
      pode: false,
      code: "EXPEDICAO_REGISTRADA",
      message: "O pedido tem expedição registrada e não pode ser cancelado."
    };
  }
  return { aplica: true, pode: true };
}
