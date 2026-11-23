/**
 * Dublê de `orcamentos.service` para testar a rota `editar-paga` sem o Salvar
 * real (que precisaria de dezenas de tabelas). Anota as chamadas de
 * `saveProposta` — em especial as `options` — e devolve o total combinado.
 */
export const saveFalso = {
  chamadas: [] as Array<{ formState: unknown; options: Record<string, unknown> | undefined }>,
  valorTotal: 0,
  zerar(valorTotal: number) {
    this.chamadas = [];
    this.valorTotal = valorTotal;
  }
};

export async function saveProposta(formState: unknown, _client: unknown, _userId: unknown, options?: Record<string, unknown>) {
  saveFalso.chamadas.push({ formState, options });
  return { success: true, id_int: Number((formState as { id_int?: number })?.id_int) || 0, valor_total: saveFalso.valorTotal };
}

export async function sendPropostaChatMessage() {
  return { success: true };
}
