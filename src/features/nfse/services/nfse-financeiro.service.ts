import { getSupabaseClient } from "@/lib/supabase/client";
import { PAGAMENTOS_V2_SELECT } from "@/features/cobrancas/services/pagamentos-v2.service";
import { mapSupabasePagamentoV2RowToCobranca } from "@/features/cobrancas/mappers";
import type { SupabasePagamentoV2Row } from "@/features/cobrancas/types.supabase";
import type { Cobranca } from "@/features/cobrancas/types";
import { ehCobrancaFaturadaEmAberto } from "@/features/nfe/services/nfe.service";
import type { SupabaseBoletoRow } from "@/features/contas-a-receber/types.supabase";
import { parcelasParaLancamento, type ParcelaDaCobranca } from "@/features/nfse/lib/composicao-nfse";

/**
 * Leituras do financeiro para o Histórico NFS-e (14/10/2026). Só leitura.
 * Regra do que o menu oferece em lib/financeiro-nfse.
 */

/**
 * `boletos` leva as linhas ativas com o que o selo "Contas a Receber" da NF-e
 * le (valor, deposito em conta e marcas de registro): a NFS-e mostra o mesmo
 * indicativo, pela mesma funcao, sobre os titulos do pedido.
 */
export type TitulosAtivos = { qtd: number; soma: number; boletos: SupabaseBoletoRow[] };

/**
 * Títulos ATIVOS de contas a receber por pedido (`boletos` fora de
 * CANCELADO). Por pedido, e não pela ref da nota: parcelado usa `P…`.
 */
export async function getTitulosAtivosPorIdInt(idInts: number[]): Promise<Record<number, TitulosAtivos>> {
  const client = getSupabaseClient();
  const mapa: Record<number, TitulosAtivos> = {};
  const unicos = Array.from(new Set(idInts.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || unicos.length === 0) return mapa;

  const LOTE = 200;
  for (let i = 0; i < unicos.length; i += LOTE) {
    const { data, error } = await client
      .from("boletos")
      .select("id, id_int, valor, status, deposito_conta, id_boleto_c6, nosso_numero, linha_digitavel")
      .in("id_int", unicos.slice(i, i + LOTE))
      .returns<SupabaseBoletoRow[]>();
    if (error) {
      console.error("[NfseFinanceiro] getTitulosAtivosPorIdInt failed:", error);
      return mapa;
    }
    for (const linha of data || []) {
      const idInt = Number(linha.id_int);
      if (!Number.isFinite(idInt) || idInt <= 0) continue;
      if (String(linha.status ?? "").trim().toUpperCase() === "CANCELADO") continue;
      const atual = mapa[idInt] || { qtd: 0, soma: 0, boletos: [] };
      atual.qtd += 1;
      atual.soma = Math.round((atual.soma + (Number(linha.valor) || 0)) * 100) / 100;
      atual.boletos.push(linha);
      mapa[idInt] = atual;
    }
  }
  return mapa;
}

/**
 * A cobrança que a janela "Preparar boletos" recebe para a NFS-e: a PRIMEIRA
 * cobrança faturada em aberto do pedido (cliente, documento e empresa reais),
 * com o valor trocado pela SOMA de todas — o mesmo desenho do lançamento da
 * NF-e. Relida no clique, nunca de um mapa em memória. `null` = nada em aberto.
 */
export async function getCobrancaFaturadaParaLancar(idInt: number): Promise<Cobranca | null> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Sistema indisponível no momento.");

  const { data, error } = await client
    .from("pagamentos_v2")
    .select(PAGAMENTOS_V2_SELECT)
    .eq("id_int", idInt)
    .returns<SupabasePagamentoV2Row[]>();
  if (error) throw new Error(error.message || "Falha ao consultar o financeiro da proposta.");

  const emAberto = (data || []).filter((linha) => ehCobrancaFaturadaEmAberto(linha));
  if (emAberto.length === 0) return null;

  const base = mapSupabasePagamentoV2RowToCobranca(emAberto[0]);
  if (!base) throw new Error("Não foi possível interpretar a cobrança faturada da proposta.");

  const soma = Math.round(emAberto.reduce((acc, linha) => acc + (Number(linha.valor) || 0), 0) * 100) / 100;
  return { ...base, valor: soma };
}

/** O que o Preparar Cobrança recebe para abrir já preenchido a partir da NFS-e. */
export type CondicaoInicialDoLancamento = {
  /** `pagamentos_v2.id_modelo_cobranca`: a condição de pagamento escolhida no pedido. */
  idModelo: string | null;
  /** Parcelas com vencimento e valor, as mesmas da frase escrita na nota. */
  parcelas: ParcelaDaCobranca[];
};

/**
 * A condição de pagamento para abrir o Preparar Cobrança preenchido a partir da
 * NFS-e (04/11/2026, pedido 24623). Lê a MESMA cobrança faturada em aberto de
 * `getCobrancaFaturadaParaLancar` e faz as parcelas pela mesma conta da frase
 * da nota (`parcelasParaLancamento`). Só com UMA cobrança em aberto: com mais
 * de uma, o valor do lançamento é a soma e as parcelas de cada uma não somam
 * uma condição só — a janela abre vazia, como antes. Só leitura.
 */
export async function getCondicaoDaNfseParaLancar(idInt: number): Promise<CondicaoInicialDoLancamento | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("pagamentos_v2")
    .select("tipo_cobranca, forma_pgto, valor, vencimento, status, confirmado, paid_at, p_qtd_parcelas, cartao_parcelas, p_intervalo, p_valor_entrada, id_modelo_cobranca")
    .eq("id_int", idInt);
  if (error) {
    console.error("[NfseFinanceiro] getCondicaoDaNfseParaLancar failed:", error);
    return null;
  }
  const emAberto = ((data ?? []) as Record<string, unknown>[]).filter((linha) => ehCobrancaFaturadaEmAberto(linha));
  if (emAberto.length !== 1) return null;
  const c = emAberto[0];
  const texto = (v: unknown) => String(v ?? "").trim();
  const parcelas = parcelasParaLancamento({
    tipo: texto(c.tipo_cobranca) || null,
    forma: texto(c.forma_pgto) || null,
    valor: c.valor == null ? null : Number(c.valor),
    vencimento: texto(c.vencimento) || null,
    status: texto(c.status) || null,
    confirmado: c.confirmado === true,
    parcelas: Number(c.p_qtd_parcelas) || Number(c.cartao_parcelas) || null,
    intervaloDias: c.p_intervalo == null ? null : Number(c.p_intervalo),
    valorEntrada: c.p_valor_entrada == null ? null : Number(c.p_valor_entrada)
  });
  if (!parcelas) return null;
  return { idModelo: texto(c.id_modelo_cobranca) || null, parcelas };
}
