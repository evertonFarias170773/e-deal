import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * TROCAR A TRANSPORTADORA ABONANDO A DIFERENÇA (26/11/2026, decisão do Everton).
 *
 * A opção da recotação que ENCARECE o frete pode ser aplicada como abono por
 * quem tem `frete.trocar_abonando` (perfil Administrador): a transportadora
 * muda para a da opção, o frete cobrado e o total da proposta NÃO mudam, e a
 * diferença fica no histórico da recotação (`expedicao_recotacoes`:
 * `valor_opcao`, `abono_valor`, `abono_motivo`, `id_transportadora_abono`).
 *
 * Banco: `exp_aplicar_recotacao_abono`. Rota: `/api/expedicao/recotacao/aplicar`
 * com `abonar: true`. Sem a permissão nada muda: o que encarece segue recusado.
 */

export const PERMISSAO_TROCAR_ABONANDO = "frete.trocar_abonando";

/** O banco exige o mesmo mínimo (`exp_recot_abono_ck`). */
export const MOTIVO_ABONO_MINIMO = 5;

/** A opção pode ser aplicada como abono? (Só o que encarece, e só com a permissão.) */
export function podeAbonar(diferenca: number, temPermissao: boolean): boolean {
  return temPermissao && diferenca > 0;
}

/** Aviso da CC-e: a nota autorizada continua com o transportador antigo. */
export function avisoCceDoAbono(notas: string[] | null | undefined, transportadora: string): string | null {
  const lista = (notas ?? []).filter((n) => String(n).trim() !== "");
  if (lista.length === 0) return null;
  const rotulo = lista.length === 1 ? `A NF-e ${lista[0]} está autorizada` : `As NF-e ${lista.join(", ")} estão autorizadas`;
  return `${rotulo} com a transportadora antiga. O valor da nota não muda, mas emita uma Carta de Correção (CC-e) com a transportadora nova (${transportadora}).`;
}

/**
 * A transportadora do ÚLTIMO abono do pedido, quando a última recotação aplicada
 * é um abono. O Salvar da proposta usa isto para não devolver o vínculo à
 * transportadora do card cotado (o card continua sendo o SEDEX vendido).
 * Falha de leitura devolve null: o Salvar segue a regra de sempre.
 */
export async function transportadoraDoUltimoAbono(client: SupabaseClient | null, idInt: number): Promise<number | null> {
  if (!client || !Number.isFinite(idInt) || idInt <= 0) return null;
  const { data, error } = await client
    .from("expedicao_recotacoes")
    .select("abono_valor, id_transportadora_abono")
    .eq("id_int", idInt)
    .order("aplicado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const abono = Number((data as { abono_valor?: number | string | null }).abono_valor ?? 0);
  const id = (data as { id_transportadora_abono?: number | string | null }).id_transportadora_abono;
  return abono > 0 && id !== null && id !== undefined ? Number(id) : null;
}
