/**
 * TRAVA DE SALDO DO DESPACHO (21/10/2026).
 *
 * Quem decide e o BANCO: `exp_saldo_despacho(id_int)` calcula
 * `round(valor_total, 2) - cc__valor_pago(id_int)` em centavos, e a trigger
 * `trg_exp_trava_despacho_saldo` recusa a primeira gravacao de
 * `expedicoes.data_despacho` com saldo a receber (R$ 0,01 ja bloqueia). Migration
 * `supabase/migrations/20261021_exp_trava_saldo_despacho.sql`.
 *
 * Aqui so a leitura do veredito, para a tela travar o botao e dizer o motivo
 * antes do clique. Sem veredito (leitura falhou), a tela nao trava: a trigger
 * segue valendo no despacho.
 */

export interface SaldoDoDespacho {
  bloqueia: boolean;
  situacao: "SEM_PROPOSTA" | "SEM_SALDO" | "SALDO_A_RECEBER";
  total?: number;
  pago?: number;
  saldo?: number;
  mensagem?: string;
}

const SITUACOES: readonly SaldoDoDespacho["situacao"][] = ["SEM_PROPOSTA", "SEM_SALDO", "SALDO_A_RECEBER"];

export const MENSAGEM_PADRAO_SALDO =
  "Despacho bloqueado: o pedido tem saldo a receber. Gere a cobrança da diferença na aba Pagamentos da proposta " +
  "(ou peça ao administrador para abonar a diferença) e despache depois que o pagamento for confirmado.";

/** Lê o JSON devolvido pelo banco. Qualquer coisa fora do formato = sem veredito. */
export function lerSaldoDoDespacho(bruto: unknown): SaldoDoDespacho | null {
  if (!bruto || typeof bruto !== "object") return null;
  const j = bruto as Record<string, unknown>;
  if (typeof j.bloqueia !== "boolean" || !SITUACOES.includes(j.situacao as SaldoDoDespacho["situacao"])) return null;
  const numero = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  return {
    bloqueia: j.bloqueia,
    situacao: j.situacao as SaldoDoDespacho["situacao"],
    total: numero(j.total),
    pago: numero(j.pago),
    saldo: numero(j.saldo),
    mensagem: typeof j.mensagem === "string" && j.mensagem.trim() ? j.mensagem.trim() : undefined
  };
}

/** O texto que o expedidor lê: o do banco, ou o padrão. */
export function mensagemDoSaldo(saldo: SaldoDoDespacho | null): string {
  return saldo?.mensagem || MENSAGEM_PADRAO_SALDO;
}

/**
 * Erro cru das travas do despacho ("EXP_DESPACHO_TRAVA_SALDO: ...",
 * "EXP_DESPACHO_TRAVA_FRETE: ...") -> só o texto, para o expedidor.
 */
export function textoDaTravaDoDespacho(mensagem: string): string {
  return mensagem.replace(/^EXP_DESPACHO_TRAVA_(?:FRETE|SALDO):\s*/, "");
}
