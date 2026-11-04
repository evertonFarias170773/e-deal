/**
 * Leitura paginada única contra o teto de 1.000 linhas do banco (04/11/2026).
 *
 * O banco devolve no máximo 1.000 linhas por consulta, SEM erro, mesmo com
 * `.limit(30000)`. Toda leitura que pode passar disso usa um destes dois:
 *
 *   - `lerTodas`: páginas de 1.000 ordenadas por uma coluna ÚNICA (a chave);
 *     cada página começa depois da última chave lida. Linha que entra durante
 *     a leitura não repete nem empurra outra para fora.
 *   - `lerPorIds`: lotes de 200 ids, paginando dentro de cada lote.
 *
 * Mesmo modelo de `lerPropostasDaFila` (nfe.service). O resultado diz se veio
 * `completo`; erro de qualquer página, ou passar do teto, devolve `completo:
 * false` com o erro — quem chama decide, como decidia com a consulta única.
 */

export const LINHAS_POR_PAGINA = 1000;
export const IDS_POR_LOTE = 200;
/** Teto de segurança: acima disso a leitura para e avisa, em vez de crescer sem fim. */
export const TETO_PADRAO = 200_000;

export type ErroDeLeitura = { message: string };
export type RespostaDeConsulta<T> = { data: T[] | null; error: ErroDeLeitura | null };
export type LeituraPaginada<T> = { data: T[]; completo: boolean; error: ErroDeLeitura | null };

/** O mínimo de um construtor de consulta do supabase-js que a paginação usa. */
export interface ConsultaPaginavel<T> extends PromiseLike<RespostaDeConsulta<T>> {
  gt(coluna: string, valor: string | number): ConsultaPaginavel<T>;
  lt(coluna: string, valor: string | number): ConsultaPaginavel<T>;
  order(coluna: string, opcoes: { ascending: boolean }): ConsultaPaginavel<T>;
  limit(quantidade: number): ConsultaPaginavel<T>;
}

export type OpcoesLerTodas = {
  /** Coluna ÚNICA e não nula que ordena e pagina (ex.: "id", "id_int"). */
  chave: string;
  /** Padrão crescente. */
  ordem?: "asc" | "desc";
  /** Máximo de linhas antes de parar com erro. */
  teto?: number;
  /** Só para o teste. */
  porPagina?: number;
};

/**
 * Lê TODAS as linhas de uma consulta. `montar` devolve a consulta com os filtros
 * e SEM order/limit/range: a paginação os acrescenta.
 */
export async function lerTodas<T>(
  montar: () => ConsultaPaginavel<T>,
  opcoes: OpcoesLerTodas
): Promise<LeituraPaginada<T>> {
  const { chave } = opcoes;
  const crescente = (opcoes.ordem ?? "asc") === "asc";
  const teto = opcoes.teto ?? TETO_PADRAO;
  const porPagina = opcoes.porPagina ?? LINHAS_POR_PAGINA;
  const todas: T[] = [];
  let depoisDe: string | number | null = null;

  for (;;) {
    let consulta = montar();
    if (depoisDe !== null) consulta = crescente ? consulta.gt(chave, depoisDe) : consulta.lt(chave, depoisDe);
    const { data, error } = await consulta.order(chave, { ascending: crescente }).limit(porPagina);
    if (error) return { data: todas, completo: false, error };
    const pagina = data ?? [];
    todas.push(...pagina);
    if (todas.length > teto) {
      return { data: todas, completo: false, error: { message: `leitura passou do teto de ${teto} linhas` } };
    }
    if (pagina.length < porPagina) return { data: todas, completo: true, error: null };
    const ultima = (pagina[pagina.length - 1] as Record<string, unknown>)[chave];
    if (typeof ultima !== "string" && typeof ultima !== "number") {
      return { data: todas, completo: false, error: { message: `chave "${chave}" ausente na linha: inclua-a no select` } };
    }
    depoisDe = ultima;
  }
}

/**
 * Lê as linhas de uma lista de ids, em lotes de 200, paginando dentro de cada
 * lote. `montar(lote)` devolve a consulta já com `.in(coluna, lote)` e os
 * filtros, sem order/limit. Cada id cai num só lote.
 */
export async function lerPorIds<T, Id extends string | number>(
  ids: readonly Id[],
  montar: (lote: Id[]) => ConsultaPaginavel<T>,
  opcoes: OpcoesLerTodas & { idsPorLote?: number }
): Promise<LeituraPaginada<T>> {
  const tamanho = opcoes.idsPorLote ?? IDS_POR_LOTE;
  const unicos = Array.from(new Set(ids));
  const lotes: Id[][] = [];
  for (let i = 0; i < unicos.length; i += tamanho) lotes.push(unicos.slice(i, i + tamanho));
  const respostas = await Promise.all(lotes.map((lote) => lerTodas(() => montar(lote), opcoes)));
  const data: T[] = [];
  for (const resposta of respostas) {
    if (resposta.error || !resposta.completo) return { data: [], completo: false, error: resposta.error };
    data.push(...resposta.data);
  }
  return { data, completo: true, error: null };
}
