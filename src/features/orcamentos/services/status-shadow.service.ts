import { getSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularStatusRecomendado, EngineStatusResult, EvidenciaStatus } from "./status-engine.service";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";

/**
 * Coleta dados do Supabase (leitura) e roda a Engine Pura para calcular o status
 * recomendado. A regra financeira é a MESMA regra oficial de quitação usada em
 * pagamentos_v2/confirmar e editar-paga (calcularSituacaoQuitacaoProposta) — não
 * há uma segunda fórmula de soma de pagamentos aqui.
 *
 * @param idInt O ID inteiro da Proposta
 * @param isAvulso Se a proposta é avulsa
 * @param statusInternoAtual O status atual que já está gravado
 * @param supabaseClient Cliente autenticado opcional — obrigatório quando chamado
 *   a partir de uma rota server-side (Route Handler), já que getSupabaseClient()
 *   só funciona no navegador.
 */
export async function validarStatusProposta(
  idInt: string | number,
  isAvulso: boolean,
  statusInternoAtual: string,
  supabaseClient?: SupabaseClient
): Promise<EngineStatusResult | null> {
  try {
    const supabase = supabaseClient || getSupabaseClient();
    if (!supabase) return null;

    const numericIdInt = Number(idInt);

    // Regra oficial de quitação reutilizada (não duplicada): mesma fonte usada em
    // /api/cobrancas/confirmar e /api/orcamentos/editar-paga.
    const situacao = await calcularSituacaoQuitacaoProposta(supabase, numericIdInt);

    // Buscar modelos/produtos físicos
    const { data: modelos, error: errModelos } = await supabase
      .from("pedidos_modelos")
      .select("status_arte, status_producao")
      .eq("id_int", numericIdInt);

    if (errModelos) {
      console.error("Erro ao buscar modelos para engine de status", errModelos);
      return null;
    }

    const evidencias: EvidenciaStatus = {
      statusInternoAtual,
      valorTotalProposta: situacao.valorTotalProposta,
      valorPagoConfirmado: situacao.valorQuitadoAtual,
      temCobrancaAtiva: situacao.cobrancasAtivas.length > 0,
      modelos: modelos || [],
      isAvulso
    };

    // Chamar engine pura sem efeitos colaterais
    return calcularStatusRecomendado(evidencias);

  } catch (err) {
    console.error("Falha ao rodar engine de status", err);
    return null;
  }
}
