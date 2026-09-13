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

/**
 * A condição que uma combinação de quantidade, dias e intervalo REPRESENTA.
 *
 * É o caminho de volta de `parcelasDoModelo`: aquela transforma condição em
 * parcelas, esta reconhece a condição a partir das parcelas. Existe porque a
 * condição escolhida na aba Pagamentos da NF-e não é gravada em coluna nenhuma
 * — e não precisa ser: as parcelas geradas pela RPC já carregam
 * `dias_pra_inicio` e `intervalo_dias` exatamente como foram pedidos. Deduzir
 * delas mostra o que foi gerado DE FATO; uma condição gravada à parte poderia
 * mentir depois de uma edição manual.
 *
 * COM UMA PARCELA SÓ, O INTERVALO NÃO CONTA. Não há segunda parcela para ele
 * espaçar, e o operador pode ter deixado 30 no campo ao escolher "Prazo 14 dias".
 *
 * NÃO HÁ AMBIGUIDADE HOJE: medido em 14/09/2026, as 12 condições do catálogo têm
 * combinações distintas sob esta regra. Se um dia duas coincidirem, vale a
 * primeira na ordem de `listarModelosCobranca` — a mesma ordem do select.
 */
export function correspondeAoModelo(combinacao: ParcelasDoModelo, modelo: ModeloCobranca): boolean {
  const esperado = parcelasDoModelo(modelo);
  if (Number(combinacao.qtdParcelas) !== esperado.qtdParcelas) return false;
  if (Number(combinacao.diasPraInicio) !== esperado.diasPraInicio) return false;
  if (esperado.qtdParcelas === 1) return true;
  return Number(combinacao.intervalo) === esperado.intervalo;
}

/** A primeira condição do catálogo que a combinação representa, ou `null`. */
export function modeloCorrespondente(
  combinacao: ParcelasDoModelo,
  modelos: readonly ModeloCobranca[]
): ModeloCobranca | null {
  return modelos.find((modelo) => correspondeAoModelo(combinacao, modelo)) ?? null;
}

/** O mínimo que uma parcela gravada precisa expor. */
export type ParcelaGravada = {
  tipo_registro?: string | null;
  dias_pra_inicio?: number | null;
  intervalo_dias?: number | null;
};

/**
 * A combinação que as parcelas GRAVADAS de uma nota formam, ou `null` quando
 * elas não formam condição nenhuma.
 *
 * Só as linhas PARCELA contam: a entrada é campo à parte no gerador, e nenhuma
 * condição do catálogo tem entrada (`entrada_porcento` é 0 nas 12).
 *
 * Devolve `null` — e a aba abre em "Selecionar condição" — quando:
 *   . não há parcela;
 *   . falta `dias_pra_inicio` (a parcela que nasce com o rascunho não tem);
 *   . as parcelas discordam entre si nos dias ou no intervalo, o que só acontece
 *     por edição fora do gerador;
 *   . é PARCELA ÚNICA com vencimento específico: a RPC a grava com dias 0 e
 *     intervalo 0. Excluída de propósito, e não por acaso do catálogo — hoje a
 *     menor condição começa em 7 dias, mas uma condição "à vista" futura não
 *     pode passar a capturar a parcela única.
 */
export function combinacaoDasParcelasGravadas(parcelas: readonly ParcelaGravada[]): ParcelasDoModelo | null {
  const doGerador = parcelas.filter(
    (p) => String(p.tipo_registro ?? "PARCELA").trim().toUpperCase() === "PARCELA"
  );
  if (doGerador.length === 0) return null;

  const dias = doGerador.map((p) => p.dias_pra_inicio);
  const intervalos = doGerador.map((p) => p.intervalo_dias);
  if (dias.some((d) => d === null || d === undefined)) return null;
  if (new Set(dias.map(Number)).size > 1) return null;
  if (new Set(intervalos.map((i) => Number(i ?? 0))).size > 1) return null;

  const combinacao: ParcelasDoModelo = {
    qtdParcelas: doGerador.length,
    diasPraInicio: Number(dias[0]),
    intervalo: Number(intervalos[0] ?? 0)
  };

  const ehParcelaUnica =
    combinacao.qtdParcelas === 1 && combinacao.diasPraInicio === 0 && combinacao.intervalo === 0;
  return ehParcelaUnica ? null : combinacao;
}
