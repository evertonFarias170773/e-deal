/**
 * Teto da carga de cobranças e o que fazer quando ela bate nele.
 *
 * A lista de cobranças é lida inteira de `pagamentos_v2`, da mais nova para a
 * mais antiga, em páginas de 1.000, até este limite. Acima dele as cobranças
 * MAIS ANTIGAS ficam de fora — e quem depende do conjunto completo (a aba
 * Pagamentos da proposta, o saldo ao criar cobrança, o cancelamento) passaria a
 * tratar uma proposta antiga como "sem cobrança".
 *
 * 07/10/2026: o limite era 10.000 e a tabela tinha 9.802 cobranças, crescendo
 * cerca de 70 por dia útil — o teto chegaria entre 09 e 13/10. Subiu para
 * 30.000 como medida imediata (perto de um ano no ritmo de setembro/2026, 1.654
 * por mês). Não é a solução: a carga cresce junto com a tabela. O que resolve é
 * a aba Pagamentos buscar as cobranças da proposta pelo `id_int` e os totais
 * virem do servidor.
 *
 * Por isso bater no limite deixou de ser silencioso: a carga sai INCOMPLETA, e
 * não "OK".
 */
export const LIMITE_DE_COBRANCAS_NA_CARGA = 30000;

/** Tamanho da página de leitura. O limite é sempre múltiplo dela. */
export const COBRANCAS_POR_PAGINA = 1000;

/** O texto do aviso, igual na lista e no estado do provider. */
export const AVISO_DE_CARGA_INCOMPLETA =
  "Lista incompleta: há mais cobranças do que o limite carregado. Avise o suporte.";

/**
 * A leitura bateu no limite?
 *
 * `linhasLidas` nunca passa do limite (a leitura para nele), então "no limite"
 * já conta como incompleta: com exatamente esse número de linhas não dá para
 * saber se havia mais, e o erro seguro é avisar. Abaixo dele a última página
 * veio parcial, e a tabela acabou ali.
 */
export function leituraBateuNoLimite(linhasLidas: number, limite: number = LIMITE_DE_COBRANCAS_NA_CARGA): boolean {
  return limite > 0 && linhasLidas >= limite;
}

export type StatusDaLeituraDeCobrancas = "OK" | "VAZIA" | "INCOMPLETA";

/**
 * O status de uma leitura que terminou SEM erro. Vazia vem antes: sem nenhuma
 * linha não há o que estar incompleto.
 */
export function statusDaLeituraDeCobrancas(leitura: { total: number; vazia?: boolean; incompleta?: boolean }): StatusDaLeituraDeCobrancas {
  if (leitura.vazia || leitura.total === 0) return "VAZIA";
  if (leitura.incompleta) return "INCOMPLETA";
  return "OK";
}

/** O texto que acompanha o status, para quem mostra o estado da carga. */
export function mensagemDaLeituraDeCobrancas(status: StatusDaLeituraDeCobrancas): string | undefined {
  if (status === "VAZIA") return "A última leitura não trouxe nenhuma cobrança.";
  if (status === "INCOMPLETA") return AVISO_DE_CARGA_INCOMPLETA;
  return undefined;
}
