/**
 * Os pedidos com boleto, a partir das linhas de `public.boletos` (04/11/2026:
 * saiu do CobrancasProvider para o teste usar a mesma regra, sem mudança).
 *
 *   - `historico`: todo pedido com boleto, inclusive CANCELADO;
 *   - `ativos`: só os com boleto que não está CANCELADO. É o que o Cancelar
 *     proposta lê para o aviso "Títulos em aberto no Contas a Receber".
 */
export function pedidosComBoleto(
  linhas: ReadonlyArray<{ id_int: number | string | null | undefined; status: string | null | undefined }>
): { ativos: Set<number>; historico: Set<number> } {
  const ativos = new Set<number>();
  const historico = new Set<number>();
  for (const b of linhas) {
    if (b.id_int === null || b.id_int === undefined) continue;
    const idInt = Number(b.id_int);
    historico.add(idInt);
    if (String(b.status || "").trim().toUpperCase() !== "CANCELADO") ativos.add(idInt);
  }
  return { ativos, historico };
}
