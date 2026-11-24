/**
 * Leitura do pagamento inteiro do pedido para a janela Análise de Faturamento
 * (24/11/2026, caso 25427). SÓ LEITURA: duas consultas, nada gravado.
 * As regras ficam em `lib/revisao-faturado-com-entrada.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ehRestanteDeFaturadoComEntrada,
  montarQuadroPagamentoInteiro,
  type LinhaDoPedido,
  type QuadroPagamentoInteiro
} from "@/features/cobrancas/lib/revisao-faturado-com-entrada";

const COLUNAS =
  "id, id_pagamento, tipo_cobranca, status, valor, paid_at, confirmado, vencimento, descricao, created_at, p_qtd_parcelas, p_valor_entrada, p_dias_pra_inicio, p_intervalo";

/**
 * `null` quando a cobrança não é o restante de um "Faturado com entrada" ou a
 * leitura falhou (a janela fica como sempre foi; a falha vai ao console).
 */
export async function carregarQuadroPagamentoInteiro(
  client: SupabaseClient,
  cobranca: { id: string; id_int: number; descricao?: string | null }
): Promise<QuadroPagamentoInteiro | null> {
  if (!ehRestanteDeFaturadoComEntrada(cobranca.descricao) || !cobranca.id_int) return null;
  const [linhas, proposta] = await Promise.all([
    client.from("pagamentos_v2").select(COLUNAS).eq("id_int", cobranca.id_int),
    client.from("propostas").select("valor_total").eq("id_int", cobranca.id_int).maybeSingle()
  ]);
  if (linhas.error) {
    console.warn("[AnaliseFaturamento] leitura das cobranças do pedido falhou:", linhas.error.message);
    return null;
  }
  if (proposta.error) console.warn("[AnaliseFaturamento] leitura do total do pedido falhou:", proposta.error.message);
  const todas = (Array.isArray(linhas.data) ? linhas.data : []) as LinhaDoPedido[];
  const faturado = todas.find((l) => l.id === cobranca.id);
  if (!faturado) return null;
  const total = (proposta.data as { valor_total?: number | string | null } | null)?.valor_total ?? null;
  return montarQuadroPagamentoInteiro({ faturado, linhasDoPedido: todas, totalDoPedido: total });
}
