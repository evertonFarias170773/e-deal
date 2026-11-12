/**
 * LEITURA DO FILTRO "COBRANÇA" DA LISTA DE PEDIDOS (12/11/2026).
 *
 * Até aqui o filtro lia `pagamentos_v2` numa consulta só, e o banco corta em
 * 1.000 linhas sem erro: o PIX (9.262 cobranças) enxergava 978 das 8.907
 * propostas, nenhuma depois da 24816, e o Cartão 915 de 955.
 *
 * Agora:
 *   1. a lista lê os id_int das propostas que passam por TODOS os outros filtros
 *      da tela (os candidatos), paginando (`lerTodas`);
 *   2. as cobranças ATIVAS (status diferente de CANCELADO) do tipo são lidas só
 *      entre esses candidatos (`lerPorIds`, lotes de 200), ou, com muitos
 *      candidatos, todas as do tipo, paginando, e cruzadas aqui;
 *   3. a consulta da lista recebe esses números em `.in("id_int", ...)`. Acima de
 *      `LIMITE_IDS_POR_CONSULTA` a consulta roda em lotes e os resultados são
 *      juntados na mesma ordem da lista (`ordemDaLista`): a URL do banco recusa a
 *      partir de ~2.000 números (medido em 12/11/2026).
 *
 * Cobrança cancelada não conta: a tela já escondia a linha que só tinha a
 * cancelada, mas o total contava. Agora total e linhas falam a mesma coisa.
 */
import { lerPorIds, lerTodas, type ConsultaPaginavel, type LeituraPaginada } from "@/lib/supabase/ler-todas";

/** Números por `.in` na consulta da lista (a URL recusa a partir de ~2.000). */
export const LIMITE_IDS_POR_CONSULTA = 800;
/** Acima disto, ler todas as cobranças do tipo sai mais barato que ler por candidato. */
export const CANDIDATOS_PARA_LER_POR_ID = 2000;

export function dividirEmLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/** Os lotes de números da consulta: `[null]` = sem recorte; um lote só quando cabe. */
export function lotesDaConsulta(ids: number[] | null): (number[] | null)[] {
  if (!ids || ids.length <= LIMITE_IDS_POR_CONSULTA) return [ids];
  return dividirEmLotes(ids, LIMITE_IDS_POR_CONSULTA);
}

type LinhaCobranca = { id: string | number; id_int: number | string | null };
export type ConsultaCobrancas = ConsultaPaginavel<LinhaCobranca> & {
  in(coluna: string, valores: readonly (string | number)[]): ConsultaCobrancas;
  neq(coluna: string, valor: string): ConsultaCobrancas;
};

/**
 * id_int dos candidatos que têm cobrança ATIVA de uma das grafias. `montar()`
 * devolve `client.from("pagamentos_v2").select("id, id_int")`, sem filtro.
 */
export async function idsComCobrancaDoTipo(
  montar: () => ConsultaCobrancas,
  entrada: { candidatos: readonly number[]; grafias: readonly string[] }
): Promise<{ ids: number[]; completo: boolean; error: { message: string } | null }> {
  const { candidatos, grafias } = entrada;
  if (candidatos.length === 0 || grafias.length === 0) return { ids: [], completo: true, error: null };
  const doTipo = () => montar().in("tipo_cobranca", grafias).neq("status", "CANCELADO");

  let leitura: LeituraPaginada<LinhaCobranca>;
  if (candidatos.length <= CANDIDATOS_PARA_LER_POR_ID) {
    leitura = await lerPorIds(candidatos, (lote) => doTipo().in("id_int", lote), { chave: "id" });
  } else {
    leitura = await lerTodas(doTipo, { chave: "id" });
  }
  if (leitura.error || !leitura.completo) {
    return { ids: [], completo: false, error: leitura.error ?? { message: "leitura das cobranças incompleta" } };
  }
  const dosCandidatos = new Set(candidatos);
  const ids = new Set<number>();
  for (const linha of leitura.data) {
    const id = Number(linha.id_int);
    if (Number.isFinite(id) && dosCandidatos.has(id)) ids.add(id);
  }
  return { ids: Array.from(ids).sort((a, b) => a - b), completo: true, error: null };
}

type LinhaOrdenavel = { status_alterado_em?: unknown; id_int?: unknown };

/**
 * A ordem da lista dentro de um grupo, igual à do banco: `status_alterado_em`
 * decrescente com vazio por último, depois `id_int` decrescente.
 */
export function ordemDaLista(a: LinhaOrdenavel, b: LinhaOrdenavel): number {
  const ta = a.status_alterado_em ? Date.parse(String(a.status_alterado_em)) : Number.NaN;
  const tb = b.status_alterado_em ? Date.parse(String(b.status_alterado_em)) : Number.NaN;
  const va = Number.isNaN(ta), vb = Number.isNaN(tb);
  if (va !== vb) return va ? 1 : -1;
  if (!va && ta !== tb) return tb - ta;
  return Number(b.id_int) - Number(a.id_int);
}

/** Junta as linhas de vários lotes de um mesmo grupo, na ordem da lista. */
export function juntarLotesNaOrdem<T extends LinhaOrdenavel>(lotes: readonly (readonly T[])[]): T[] {
  return lotes.flat().sort(ordemDaLista);
}
