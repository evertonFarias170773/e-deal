import { SupabaseClient } from "@supabase/supabase-js";

export type CobrancaV2 = {
  id: string;
  id_int: number;
  id_cliente: number;
  valor: number;
  status: string;
  confirmado: boolean;
  tipo_cobranca: string;
};

export type SituacaoQuitacaoResult = {
  podeConfirmar: boolean;
  valorTotalProposta: number;
  valorQuitadoAtual: number;
  novoValorQuitado: number;
  saldoPendente: number;
  cobrancasAtivas: CobrancaV2[];
  cobrancasIgnoradas: CobrancaV2[];
};

/**
 * Calcula a situação financeira de uma proposta server-side para proteger a confirmação de cobranças.
 * A soma dos pagamentos válidos precisa igualar o total da proposta para a confirmação ser permitida,
 * SE a cobrança não for a única (múltiplas cobranças/pagamento combinado).
 */
export async function calcularSituacaoQuitacaoProposta(
  supabase: SupabaseClient,
  idInt: number,
  idCobrancaSimulada?: string
): Promise<SituacaoQuitacaoResult> {
  
  const TOLERANCIA_MONETARIA = 0.02;

  const { data: proposta, error: propostaErr } = await supabase
    .from("propostas")
    .select("valor_total")
    .eq("id_int", idInt)
    .single();

  if (propostaErr || !proposta) {
    throw new Error(`Erro ao buscar proposta #${idInt}.`);
  }

  const valorTotalProposta = Number(proposta.valor_total) || 0;

  const { data: pagamentos, error: pagamentosErr } = await supabase
    .from("pagamentos_v2")
    .select("id, id_int, id_cliente, valor, status, confirmado, tipo_cobranca")
    .eq("id_int", idInt);

  if (pagamentosErr || !pagamentos) {
    throw new Error(`Erro ao buscar cobranças vinculadas à proposta #${idInt}.`);
  }

  const cobrancasTodas = pagamentos as CobrancaV2[];

  const statusIgnorados = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];
  
  const cobrancasAtivas = cobrancasTodas.filter(c => !statusIgnorados.includes(c.status?.toUpperCase()));
  const cobrancasIgnoradas = cobrancasTodas.filter(c => statusIgnorados.includes(c.status?.toUpperCase()));

  const valorQuitadoAtual = cobrancasAtivas
    .filter(c => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
    .reduce((sum, c) => sum + (Number(c.valor) || 0), 0);

  let novoValorQuitado = 0;
  
  if (idCobrancaSimulada) {
    novoValorQuitado = cobrancasAtivas.reduce((sum, c) => {
      if (c.id === idCobrancaSimulada) {
        return sum + (Number(c.valor) || 0);
      }
      if (c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado)) {
        return sum + (Number(c.valor) || 0);
      }
      return sum;
    }, 0);
  } else {
    novoValorQuitado = valorQuitadoAtual;
  }

  const saldoPendente = Math.max(0, valorTotalProposta - novoValorQuitado);
  
  let podeConfirmar = true;

  if (cobrancasAtivas.length >= 2) {
    if (novoValorQuitado < (valorTotalProposta - TOLERANCIA_MONETARIA)) {
      podeConfirmar = false;
    }
  }

  return {
    podeConfirmar,
    valorTotalProposta,
    valorQuitadoAtual,
    novoValorQuitado,
    saldoPendente,
    cobrancasAtivas,
    cobrancasIgnoradas
  };
}
