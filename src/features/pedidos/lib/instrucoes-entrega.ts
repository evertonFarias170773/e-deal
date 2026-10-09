/**
 * Instruções de entrega (`propostas.obs_entrega`, 09/10/2026).
 *
 * Texto livre, um por pedido, separado da orientação técnica de produção. Quem
 * escreve é o vendedor (aba Produção / Expedição) ou o gerente (boletim); quem
 * lê é a Expedição, além do boletim e dos PDFs da OS.
 *
 * A regra de "tem texto" é uma só, para o bloco do PDF, o ícone do card e a
 * caixa do Despachar não discordarem: espaço e quebra de linha soltos não são
 * instrução.
 *
 * Sem imports de propósito: roda na tela, no PDF e no teste do Node.
 */

/** O texto pronto para mostrar: sem sobras nas pontas; "" quando não há instrução. */
export function textoDeEntrega(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** Há instrução de entrega para mostrar? */
export function temInstrucaoDeEntrega(valor: unknown): boolean {
  return textoDeEntrega(valor) !== "";
}

/**
 * Monta o mapa pedido → instrução a partir das linhas lidas em lote
 * (`id_int, obs_entrega`). Só entra quem tem texto: pedido fora do mapa não
 * mostra ícone nem bloco.
 */
export function mapaDeInstrucoesDeEntrega(
  linhas: readonly { id_int?: unknown; obs_entrega?: unknown }[] | null | undefined
): Map<number, string> {
  const mapa = new Map<number, string>();
  for (const linha of linhas ?? []) {
    const idInt = Number(linha?.id_int);
    const texto = textoDeEntrega(linha?.obs_entrega);
    if (Number.isFinite(idInt) && idInt > 0 && texto) mapa.set(idInt, texto);
  }
  return mapa;
}
