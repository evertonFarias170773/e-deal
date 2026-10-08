/**
 * Trava de ETIQUETA e de PREPOSTAGEM para pedidos do grupo ACOMPANHAR (Fase 5).
 *
 * A regra mora no banco (`acompanhar_pendentes`, que usa
 * `pedido_pronto_para_expedir`); as rotas so perguntam e traduzem. O despacho
 * em si e travado pelo trigger `trg_exp_gate_acompanhar`.
 */

export type PendenteAcompanhar = { idInt: number; status: string };

export type LeituraGateAcompanhar =
  | { bloqueado: false }
  | { bloqueado: true; mensagem: string; pendentes: PendenteAcompanhar[] };

type ClienteRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export function mensagemGateAcompanhar(idInt: number, pendentes: readonly PendenteAcompanhar[], acao: string): string {
  const lista = pendentes.map((p) => `#${p.idInt} (${p.status || "sem status"})`).join(", ");
  return `O pedido #${idInt} esta em um grupo Acompanhar: ${acao} so sai quando todos os pedidos do grupo estiverem prontos para expedir. Faltam: ${lista}.`;
}

export function lerPendentes(data: unknown): PendenteAcompanhar[] {
  const bruto = data && typeof data === "object" ? (data as { pendentes?: unknown }).pendentes : null;
  if (!Array.isArray(bruto)) return [];
  const saida: PendenteAcompanhar[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const id = Number((item as { id_int?: unknown }).id_int);
    if (!Number.isFinite(id)) continue;
    const status = (item as { status?: unknown }).status;
    saida.push({ idInt: id, status: typeof status === "string" ? status : "" });
  }
  return saida;
}

/**
 * `acao` completa a frase: "a etiqueta", "a prepostagem". Se a consulta falhar,
 * NAO libera: a etiqueta antes da hora e justamente o que a trava evita.
 */
export async function consultarGateAcompanhar(
  cliente: ClienteRpc,
  idInt: number,
  acao: string
): Promise<LeituraGateAcompanhar> {
  const { data, error } = await cliente.rpc("acompanhar_pendentes", { p_id_int: idInt });
  if (error) {
    return {
      bloqueado: true,
      mensagem: `Nao foi possivel conferir se o pedido #${idInt} esta em um grupo Acompanhar (${error.message}). Tente de novo.`,
      pendentes: []
    };
  }
  const pendentes = lerPendentes(data);
  if (pendentes.length === 0) return { bloqueado: false };
  return { bloqueado: true, mensagem: mensagemGateAcompanhar(idInt, pendentes, acao), pendentes };
}
