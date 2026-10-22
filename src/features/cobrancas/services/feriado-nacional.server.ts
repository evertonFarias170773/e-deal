/**
 * Feriado nacional de hoje — usado pela conferência automática (22/10/2026).
 *
 * Feriado nacional = linha em public.feriados com abrangencia = 'NACIONAL' e
 * data = hoje em America/Sao_Paulo. UF e município não entram.
 *
 * Se a consulta falhar, devolve "consulta_falhou" e quem chama segue
 * normalmente: perder uma conferência é pior que rodar num feriado.
 * Só leitura, com o cliente que quem chama já tem (chave de serviço).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { hojeEmSaoPaulo } from "@/lib/formatters/date";

export type FeriadoDeHoje =
  | { feriado: true; data: string; descricao: string }
  | { feriado: false; data: string; consulta_falhou?: true };

export async function feriadoNacionalDeHoje(
  supabase: SupabaseClient,
  hoje: string = hojeEmSaoPaulo()
): Promise<FeriadoDeHoje> {
  try {
    const { data, error } = await supabase
      .from("feriados")
      .select("data, descricao")
      .eq("abrangencia", "NACIONAL")
      .eq("data", hoje)
      .limit(1);
    if (error) throw new Error(error.message);
    const linha = Array.isArray(data) ? (data[0] as { descricao?: string | null } | undefined) : undefined;
    if (linha) return { feriado: true, data: hoje, descricao: String(linha.descricao ?? "").trim() || "Feriado nacional" };
    return { feriado: false, data: hoje };
  } catch (erro) {
    console.error("[feriado-nacional] consulta a feriados falhou; segue sem checar:", erro instanceof Error ? erro.message : erro);
    return { feriado: false, data: hoje, consulta_falhou: true };
  }
}
