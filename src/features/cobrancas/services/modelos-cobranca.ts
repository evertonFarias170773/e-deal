import { getSupabaseClient } from "@/lib/supabase/client";
import type { ModeloCobranca } from "@/features/cobrancas/types";

/**
 * Condições de pagamento (`public.modelos_cobranca`) e a tradução de uma
 * condição em parcelas.
 *
 * FONTE ÚNICA PARA DOIS LUGARES
 *   O modal Preparar Cobrança e a aba Pagamentos da NF-e escolhem a mesma coisa
 *   — uma condição que vira quantidade, dias até a primeira e intervalo. Até
 *   14/09/2026 a consulta e a tradução moravam DENTRO do modal. Levar a aba para
 *   o mesmo desenho sem copiá-las exigia tirá-las de lá: duas cópias da mesma
 *   regra envelhecem separadas, e o operador veria a mesma condição gerar
 *   parcelas diferentes conforme a tela.
 *
 *   O modal passou a importar daqui sem mudar de comportamento: mesma consulta,
 *   mesma ordem, mesmos valores de reserva.
 */

/**
 * Todas as condições, na ordem em que o modal sempre as listou.
 *
 * Erro de leitura devolve lista vazia: sem condição, o operador ainda preenche
 * quantidade, dias e intervalo à mão, e nenhuma das duas telas quebra.
 */
export async function listarModelosCobranca(): Promise<ModeloCobranca[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("modelos_cobranca")
    .select("*")
    .order("modelo", { ascending: true })
    .order("inicio", { ascending: true })
    .order("qtd_parcela", { ascending: true })
    .order("intervalo", { ascending: true });
  if (error || !data) return [];
  return data as ModeloCobranca[];
}

export type ParcelasDoModelo = {
  qtdParcelas: number;
  diasPraInicio: number;
  intervalo: number;
};

/**
 * O que uma condição preenche no gerador. Valor fora de faixa cai na reserva
 * que o modal sempre usou: 1 parcela, 30 dias até a primeira, 30 de intervalo.
 */
export function parcelasDoModelo(modelo: ModeloCobranca): ParcelasDoModelo {
  const qtd = Number(modelo.qtd_parcela);
  const inicio = Number(modelo.inicio);
  const intervalo = Number(modelo.intervalo);
  return {
    qtdParcelas: Number.isFinite(qtd) && qtd >= 1 ? qtd : 1,
    diasPraInicio: Number.isFinite(inicio) && inicio >= 0 ? inicio : 30,
    intervalo: Number.isFinite(intervalo) && intervalo >= 0 ? intervalo : 30
  };
}

/**
 * A condição que a cobrança da proposta JÁ TEM gravada, para vir
 * pré-selecionada.
 *
 * `pagamentos_v2.id_modelo_cobranca` só existe em cobrança faturada criada
 * depois que a coluna nasceu — medido em 14/09/2026: 53 de 327 propostas com
 * cobrança faturada. Nas outras 274 não há o que pré-selecionar, e o select
 * abre em "Selecionar condição". Cobrança cancelada não conta. Havendo mais de
 * uma com condição, vale a mais recente.
 *
 * Uma consulta por proposta, na abertura da nota — nunca por linha.
 */
export async function buscarModeloCobrancaDaProposta(idInt: number): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client || !Number.isFinite(idInt) || idInt <= 0) return null;
  const { data, error } = await client
    .from("pagamentos_v2")
    .select("id_modelo_cobranca, status, created_at")
    .eq("id_int", idInt)
    .not("id_modelo_cobranca", "is", null)
    .order("created_at", { ascending: false });
  if (error || !data) return null;
  const ativa = (data as Array<{ id_modelo_cobranca: string | null; status: string | null }>).find(
    (linha) => !["CANCELADO", "CANCELADA"].includes(String(linha.status ?? "").trim().toUpperCase())
  );
  return ativa?.id_modelo_cobranca ? String(ativa.id_modelo_cobranca) : null;
}
