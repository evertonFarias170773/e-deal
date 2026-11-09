/**
 * Liberar para Produção com ou sem o aviso "Pedido em Produção" (09/11/2026).
 *
 * Regra: a liberação é a antiga (`liberarPropostaParaProducaoPeloServidor`) e não
 * depende de nada do aviso — modo teste, conversa do ChatGuru, link, recusa ou erro
 * de rede. "Liberar sem enviar" nem chama o aviso. "Liberar e enviar" libera
 * primeiro; o aviso só é chamado depois, e qualquer erro dele (recusa ou exceção)
 * fica no resultado, sem desfazer nem esconder a liberação.
 *
 * Teste: scripts/testes/liberar-com-aviso.test.mts.
 */

export type ResultadoLiberacaoServidor = { success: boolean; errorMessage?: string };

export type ResultadoLiberarComAviso = {
  liberou: boolean;
  /** Motivo da recusa da liberação (validação do servidor ou falha de rede). */
  erroLiberacao: string | null;
  /** "nao_pedido": Liberar sem enviar; "chamado": o aviso rodou; "erro": o aviso lançou exceção. */
  aviso: "nao_pedido" | "chamado" | "erro";
  erroAviso: string | null;
};

function mensagem(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao;
}

export async function liberarComAviso(p: {
  liberar: () => Promise<ResultadoLiberacaoServidor>;
  /** Ausente em "Liberar sem enviar". */
  enviarAviso?: () => Promise<unknown>;
}): Promise<ResultadoLiberarComAviso> {
  let lib: ResultadoLiberacaoServidor;
  try {
    lib = await p.liberar();
  } catch (e) {
    return { liberou: false, erroLiberacao: mensagem(e, "Falha na comunicação com o servidor."), aviso: "nao_pedido", erroAviso: null };
  }
  if (!lib?.success) {
    return {
      liberou: false,
      erroLiberacao: lib?.errorMessage || "Não foi possível enviar para produção.",
      aviso: "nao_pedido",
      erroAviso: null
    };
  }
  if (!p.enviarAviso) return { liberou: true, erroLiberacao: null, aviso: "nao_pedido", erroAviso: null };
  try {
    await p.enviarAviso();
    return { liberou: true, erroLiberacao: null, aviso: "chamado", erroAviso: null };
  } catch (e) {
    return { liberou: true, erroLiberacao: null, aviso: "erro", erroAviso: mensagem(e, "O aviso não foi enviado.") };
  }
}
