import { getSupabaseClient } from "@/lib/supabase/client";
import { calcularStatusRecomendado, EngineStatusResult, EvidenciaStatus } from "./status-engine.service";

/**
 * Coleta dados do Supabase apenas como LEITURA e roda na Engine Pura
 * para fins de diagnóstico (Modo Sombra).
 * @param idInt O ID inteiro da Proposta
 * @param isAvulso Se a proposta é avulsa
 * @param statusInternoAtual O status atual que já está gravado
 */
export async function validarStatusProposta(
  idInt: string | number,
  isAvulso: boolean,
  statusInternoAtual: string
): Promise<EngineStatusResult | null> {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    
    // Buscar pagamentos ativos
    const { data: pagamentos, error: errPagamentos } = await supabase
      .from("pagamentos_v2")
      .select("status, confirmado")
      .eq("id_int", idInt)
      .neq("status", "CANCELADO")
      .neq("status", "EXTORNADO");
      
    if (errPagamentos) {
      console.error("Erro ao buscar pagamentos para shadow mode", errPagamentos);
      return null;
    }

    // Buscar modelos/produtos físicos
    const { data: modelos, error: errModelos } = await supabase
      .from("pedidos_modelos")
      .select("status_arte, status_producao")
      .eq("id_int", idInt);
      
    if (errModelos) {
      console.error("Erro ao buscar modelos para shadow mode", errModelos);
      return null;
    }

    // Montar objeto de evidências
    const evidencias: EvidenciaStatus = {
      statusInternoAtual,
      pagamentosAtivos: pagamentos || [],
      modelos: modelos || [],
      isAvulso
    };

    // Chamar engine pura sem efeitos colaterais
    return calcularStatusRecomendado(evidencias);
    
  } catch (err) {
    console.error("Falha ao rodar shadow mode", err);
    return null;
  }
}
