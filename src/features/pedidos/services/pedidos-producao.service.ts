import { getSupabaseClient } from "@/lib/supabase/client";
import { sendPropostaChatMessage } from "@/features/orcamentos/services/orcamentos.service";
import type { PedidoProducaoListItem, PedidoStatus, PropostaOperacionalListItem } from "../types";
import type { PedidoModelo } from "@/features/producao/types";
import { composeStatusEmArte } from "@/features/orcamentos/mappers";
/**
 * Busca a lista de pedidos em produção.
 * Retorna array vazio nesta etapa para transição segura de mock para o Supabase.
 */
export async function listarPedidosProducao(): Promise<PedidoProducaoListItem[]> {
  return [];
}

import { STATUS_PRODUCAO_LISTA } from "@/lib/constants/proposta-status";

/**
 * Busca a lista de propostas operacionais filtradas pelo status_interno.
 * Substitui o antigo listarPedidosOperacionais.
 */
export async function listarPedidosOperacionais(): Promise<PropostaOperacionalListItem[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[pedidos-producao.service] Supabase client não inicializado.");
    return [];
  }

  // 1. Definir filtro base (excluindo os status finais de logística, se necessário, ou usar apenas is_prd_aprovado)
  // Como o usuário pediu especificamente para usar o filtro principal .eq("is_prd_aprovado", true):
  const { data: propostasRows, error: propostasError } = await client
    .from("propostas")
    .select(`
      id_int, 
      cliente, 
      vendedor, 
      empresa, 
      status_interno, 
      valor_total, 
      created_at, 
      is_avulso,
      em_arte,
      is_prd_aprovado,
      libera_nf
    `)
    .eq("is_prd_aprovado", true)
    // Filtra apenas status operacionais para evitar poluir a lista com os que já saíram da produção
    .in("status_interno", ["LIBERADO", "REVISAO ATENDENTE", "REVISAO PRODUCAO", "EM PRODUCAO", "EM IMPRESSAO", "EM IMPRESSAO / PENDENTE", "EM ACABAMENTO", "EM ACABAMENTO / PENDENTE"])
    .order("id_int", { ascending: false });

  if (propostasError || !propostasRows) {
    console.error("[pedidos-producao.service] Erro ao buscar propostas operacionais:", propostasError);
    return [];
  }

  if (propostasRows.length === 0) {
    return [];
  }

  const idInts = propostasRows.map(p => Number(p.id_int));

  // 3. Buscar Modelos (necessário para calcular produto principal e quantidade total)
  let modelos: { id_int: number; status_arte: string; nome_modelo: string; quantidade: number }[] = [];
  try {
    const { data: modelosRows } = await client
      .from("pedidos_modelos")
      .select("id_int, status_arte, nome_modelo, quantidade")
      .in("id_int", idInts);
    if (modelosRows) modelos = modelosRows;
  } catch (e) {
    console.warn("[pedidos-producao.service] Erro ao buscar modelos");
  }

  let artes: { id_int: number; nome_evento: string | null; created_at: string }[] = [];
  try {
    const { data: artesRows } = await client
      .from("pedidos_artes")
      .select("id_int, nome_evento, created_at")
      .in("id_int", idInts)
      .order("created_at", { ascending: false });
    if (artesRows) artes = artesRows;
  } catch (error) {
    console.warn("[pedidos-producao.service] Erro ao buscar artes");
  }

  let osDados: { id_int: number; data_termino: string | null }[] = [];
  try {
    const { data: osRows } = await client
      .from("propostas_os")
      .select("id_int, data_termino")
      .in("id_int", idInts);
    if (osRows) osDados = osRows;
  } catch (error) {
    console.warn("[pedidos-producao.service] Erro ao buscar propostas_os");
  }

  // 4. Construir a resposta agregada
  const resultados: PropostaOperacionalListItem[] = [];

  for (const p of propostasRows) {
    const idInt = Number(p.id_int);
    const modelosDestaProposta = modelos.filter(m => m.id_int === idInt);
    
    const emArte = p.em_arte === true;
    const pendencias: string[] = [];
    
    if (emArte) {
      pendencias.push("Aguardando liberação de arte (ou arquivo pendente)");
    }

    let produtoPrincipal = "Diversos";
    let quantidadeTotal = 0;
    
    if (modelosDestaProposta.length > 0) {
      produtoPrincipal = modelosDestaProposta[0].nome_modelo || "Diversos";
      quantidadeTotal = modelosDestaProposta.reduce((acc, m) => acc + (Number(m.quantidade) || 0), 0);
    }

    const artesDestaProposta = artes.filter(a => a.id_int === idInt);
    const nomeEvento = artesDestaProposta.length > 0 && artesDestaProposta[0].nome_evento 
      ? artesDestaProposta[0].nome_evento 
      : produtoPrincipal;

    const osDestaProposta = osDados.find(o => o.id_int === idInt);
    const dataTermino = osDestaProposta && osDestaProposta.data_termino
      ? osDestaProposta.data_termino
      : null;

    resultados.push({
      id_int: idInt,
      clienteNome: p.cliente || `Proposta #${idInt}`,
      empresa: p.empresa || "Ideal",
      vendedor: p.vendedor || "Não atribuído",
      status_interno: composeStatusEmArte(p.status_interno || "INDEFINIDO", emArte),
      dataProposta: p.created_at || new Date().toISOString(),
      dataPrevistaEntrega: dataTermino || "",
      valorTotal: Number(p.valor_total) || 0,
      urgente: false,
      produto_principal: nomeEvento,
      quantidade_total: quantidadeTotal,
      pendencias_operacionais: pendencias,
      hasOS: modelosDestaProposta.length > 0,
      isLegado: false,
      osId: undefined,
      status_pedido: undefined,
      codigo_rastreamento: undefined,
      cobrancas_validas: 0,
      cobrancas_confirmadas: 0,
      bloqueio_financeiro: false,
      financeiro_status: "OK",
      qtd_modelos: modelosDestaProposta.length,
      arte_status_geral: emArte ? "PENDENTE" : "LIBERADA",
      hasArtePendente: emArte,
      obs: "",
      libera_nf: p.libera_nf === true,
      is_prd_aprovado: p.is_prd_aprovado === true
    });
  }

  return resultados;
}

/**
 * Busca todos os modelos de pedidos cadastrados diretamente de public.pedidos_modelos.
 * Retorna uma lista de modelos operacionais para a fila de impressão.
 */
export async function listarModelosImpressao(): Promise<PedidoModelo[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[pedidos-producao.service] Supabase client não inicializado.");
    return [];
  }

  const { data, error } = await client
    .from("pedidos_modelos")
    .select(`
      id,
      id_int,
      id_item,
      id_produto_proposta_origem,
      nome_modelo,
      descricao,
      quantidade,
      tipo_numeracao,
      numeracao_inicio,
      numeracao_fim,
      obs_impressao,
      status_arte,
      status_producao,
      status_expedicao,
      setor,
      cor_material,
      verso,
      designer_responsavel,
      url_arte,
      url_gabarito,
      data_aprovacao_arte
    `)
    .order("created_at", { ascending: false })
    .limit(300); // Limite inicial de segurança para não explodir na lista

  if (error || !data) {
    console.error("[pedidos-producao.service] Erro ao buscar modelos impressao:", error);
    return [];
  }

  return data as unknown as PedidoModelo[];
}

/**
 * Atualiza o status macro da proposta para a fase de produção e grava um log.
 */
export async function atualizarFaseProducaoLista(idInt: number, faseStatus: string, oldStatus: string): Promise<{ success: boolean; error?: string }> {
  const allowedFases = ["EM IMPRESSAO", "EM ACABAMENTO", "REVISAO"];
  if (!allowedFases.includes(faseStatus)) {
    return { success: false, error: "Fase inválida." };
  }

  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  const { error } = await client
    .from("propostas")
    .update({ status_interno: faseStatus })
    .eq("id_int", idInt);

  if (error) {
    console.error("[PedidosProducaoService] Erro ao atualizar fase:", error);
    return { success: false, error: error.message };
  }

  await sendPropostaChatMessage({
    id_int: idInt,
    mensagem: `Fase de produção atualizada via painel geral: de [${oldStatus || "Indefinido"}] para [${faseStatus}].`,
    tipo: "SISTEMA",
    autor_nome: "Operador (Lista)",
    autor_uid: null,
    autor_email: null,
    setor: "PRODUCAO",
    visivel_externo: false,
    anexos: null,
    id_cliente: null,
    avatar: null
  });

  return { success: true };
}
