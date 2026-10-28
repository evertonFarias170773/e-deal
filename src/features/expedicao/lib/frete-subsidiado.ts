/**
 * FRETE SUBSIDIADO NA EXPEDICAO (28/10/2026).
 *
 * Cliente com "Pode editar valor do frete" (`clientes.pode_editar_frete = true`)
 * pode ter frete subsidiado no pedido, R$ 0,00 incluido. "Aplicar recotacao" e
 * "Corrigir frete" regravam `propostas.valor_frete`, entao, para esse cliente,
 * os dois botoes pedem confirmacao com o valor atual e o novo antes de gravar.
 *
 * O checkbox e o valor atual sao lidos do BANCO no clique, nunca do que a tela
 * tem em memoria. So leitura: a gravacao segue sendo a dos botoes, sem mudanca.
 * Cliente sem o checkbox: nada muda, sem aviso.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency } from "@/lib/formatters/currency";

export type ConferenciaFreteSubsidiado =
  | { ok: true; subsidiado: boolean; valorAtual: number }
  | { ok: false; mensagem: string };

export const MENSAGEM_FALHA_CONFERENCIA =
  "Não foi possível conferir o cadastro do cliente antes de regravar o frete. Tente de novo.";

/** Le `propostas.id_cliente`/`valor_frete` e `clientes.pode_editar_frete`, agora. */
export async function conferirFreteSubsidiado(
  client: Pick<SupabaseClient, "from"> | null,
  idInt: number
): Promise<ConferenciaFreteSubsidiado> {
  if (!client) return { ok: false, mensagem: MENSAGEM_FALHA_CONFERENCIA };
  const { data: proposta, error: erroProposta } = await client
    .from("propostas")
    .select("id_cliente, valor_frete")
    .eq("id_int", idInt)
    .maybeSingle();
  if (erroProposta || !proposta) return { ok: false, mensagem: MENSAGEM_FALHA_CONFERENCIA };
  const valorAtual = Number((proposta as { valor_frete: unknown }).valor_frete) || 0;
  const idCliente = (proposta as { id_cliente: number | null }).id_cliente;
  if (idCliente === null || idCliente === undefined) return { ok: true, subsidiado: false, valorAtual };
  const { data: cadastro, error: erroCadastro } = await client
    .from("clientes")
    .select("pode_editar_frete")
    .eq("id_cliente", idCliente)
    .maybeSingle();
  if (erroCadastro) return { ok: false, mensagem: MENSAGEM_FALHA_CONFERENCIA };
  const subsidiado = (cadastro as { pode_editar_frete: boolean | null } | null)?.pode_editar_frete === true;
  return { ok: true, subsidiado, valorAtual };
}

/** Texto da confirmacao, com o valor atual e o novo. */
export function mensagemFreteSubsidiado(valorAtual: number, valorNovo: number): string {
  return `Este cliente tem frete subsidiado (valor atual: ${formatCurrency(valorAtual)}). Confirma que quer regravar para ${formatCurrency(valorNovo)}?`;
}
