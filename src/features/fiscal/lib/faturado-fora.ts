/**
 * Marca "Nota emitida no sistema antigo" (propostas.faturado_fora_em/por).
 *
 * Uma venda, uma NF-e de mercadoria: o pedido marcado já tem a nota emitida
 * fora do Vibe. Ele não entra na Fila de Faturamento, e a conferência do
 * Faturar (inclusive a "Gerar outra nota de venda") o recusa.
 *
 * A marca só registra que a nota existe. Não emite, não altera nem cancela
 * nota, e não liga `libera_nf` nem `is_prd_aprovado`.
 */

export const MENSAGEM_PEDIDO_FATURADO_FORA = "Este pedido já tem nota emitida no sistema antigo.";

/**
 * Status em que a marca se aplica pelo menu de Orçamentos: a nota antecipada,
 * emitida antes do pagamento. Nos demais casos a marca continua saindo da Fila
 * de Faturamento, como antes.
 */
export const STATUS_DA_MARCA_ANTECIPADA = ["NOVO", "AGUARDANDO"] as const;

export function podeMarcarNotaAntecipada(statusInterno: string | null | undefined): boolean {
  const status = String(statusInterno ?? "").trim().toUpperCase();
  return (STATUS_DA_MARCA_ANTECIPADA as readonly string[]).includes(status);
}

/** Número da nota do sistema antigo: só dígitos, de 1 a 9. Fora disso, null. */
export function normalizarNumeroNotaAntiga(valor: unknown): string | null {
  const texto = String(valor ?? "").trim();
  if (!/^[0-9]{1,9}$/.test(texto)) return null;
  if (/^0+$/.test(texto)) return null;
  return texto.replace(/^0+/, "");
}

/** Texto do "encontrado" quando a conferência recusa o pedido marcado. */
export function descreverMarca(faturadoForaEm: string | null, faturadoForaPor: string | null): string {
  if (!faturadoForaEm) return "";
  const data = new Date(faturadoForaEm);
  const quando = Number.isNaN(data.getTime())
    ? faturadoForaEm
    : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  return `marcado em ${quando}${faturadoForaPor ? ` por ${faturadoForaPor}` : ""}`;
}
