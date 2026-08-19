import { getSupabaseClient } from "@/lib/supabase/client";
import type { PedidoProducaoListItem, PedidoStatus, PropostaOperacionalListItem, SetorDoPedido } from "../types";
import type { PedidoModelo } from "@/features/producao/types";
import { composeStatusEmArte } from "@/features/orcamentos/mappers";
import { SETORES_PCP, normalizarSetor } from "../setores";
import { normalizarFaseSetor } from "../status-setor";
import { tituloEventoDoPedido } from "../titulo-evento";
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

  // Briefing de arte, em ordem de criação: o primeiro é o que carrega o nome do
  // evento. Boletim de setor não vive mais aqui (propostas_os_setores).
  let artes: { id_int: number; nome_evento: string | null; created_at: string }[] = [];
  try {
    const { data: artesRows } = await client
      .from("pedidos_artes")
      .select("id_int, nome_evento, created_at")
      .in("id_int", idInts)
      .order("created_at", { ascending: true });
    if (artesRows) artes = artesRows;
  } catch (error) {
    console.warn("[pedidos-producao.service] Erro ao buscar artes");
  }

  // Boletim de cada setor: prazo, hora e a fase de produção daquele setor.
  let boletinsSetor: { id: string; id_int: number; setor: string | null; status_producao: string | null }[] = [];
  try {
    const { data: setoresRows } = await client
      .from("propostas_os_setores")
      .select("id, id_int, setor, status_producao")
      .in("id_int", idInts);
    if (setoresRows) boletinsSetor = setoresRows;
  } catch (error) {
    console.warn("[pedidos-producao.service] Erro ao buscar boletins de setor");
  }

  // Itens do pedido + cadastro do produto: o setor de produção é do cadastro
  // (produtos.setor_pcp), e é ele que diz quantos setores a OS tem.
  let itens: { id_int: number; id_produto: number | null; nome_produto: string | null; is_estoque: boolean | null }[] = [];
  try {
    const { data: itensRows } = await client
      .from("produtos_proposta")
      .select("id_int, id_produto, nome_produto, is_estoque")
      .in("id_int", idInts);
    if (itensRows) itens = itensRows;
  } catch (error) {
    console.warn("[pedidos-producao.service] Erro ao buscar itens da proposta");
  }

  const idsProduto = Array.from(
    new Set(itens.map((i) => Number(i.id_produto)).filter((id) => Number.isFinite(id) && id > 0))
  );
  const setorPorProduto = new Map<number, string>();
  const estoquePorProduto = new Map<number, boolean>();
  if (idsProduto.length > 0) {
    try {
      const { data: produtosRows } = await client
        .from("produtos")
        .select("id_produto, setor_pcp, is_estoque")
        .in("id_produto", idsProduto);
      for (const linha of produtosRows ?? []) {
        const id = Number(linha.id_produto);
        if (linha.setor_pcp) setorPorProduto.set(id, String(linha.setor_pcp));
        estoquePorProduto.set(id, linha.is_estoque === true);
      }
    } catch (error) {
      console.warn("[pedidos-producao.service] Erro ao buscar setor dos produtos");
    }
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

    let quantidadeTotal = 0;
    if (modelosDestaProposta.length > 0) {
      quantidadeTotal = modelosDestaProposta.reduce((acc, m) => acc + (Number(m.quantidade) || 0), 0);
    }

    const boletins = boletinsSetor.filter((b) => b.id_int === idInt);
    const itensDoPedido = itens.filter((i) => i.id_int === idInt);

    // Título do evento: `pedidos_artes.nome_evento` do primeiro briefing que o
    // tenha. Pedido só de prateleira não tem evento e usa o nome dos produtos.
    const nomeEvento = tituloEventoDoPedido(
      artes
        .filter((a) => a.id_int === idInt)
        .map((a) => a.nome_evento)
        .find((nome) => (nome || "").trim() !== "") ?? null,
      itensDoPedido.map((i) => ({
        nome: i.nome_produto,
        // O snapshot do item manda; o cadastro do produto é a rede de segurança
        // para item gravado antes de o snapshot existir.
        isPrateleira: i.is_estoque === true || estoquePorProduto.get(Number(i.id_produto)) === true
      }))
    );

    // Setores do pedido = setores dos produtos ∪ setores que já têm boletim.
    const setoresDoPedido = new Set<string>();
    for (const item of itensDoPedido) {
      const cadastro = setorPorProduto.get(Number(item.id_produto));
      if (cadastro) setoresDoPedido.add(normalizarSetor(cadastro));
    }
    for (const boletim of boletins) {
      if (boletim.setor) setoresDoPedido.add(normalizarSetor(boletim.setor));
    }

    const setores: SetorDoPedido[] = SETORES_PCP.filter((s) => setoresDoPedido.has(s)).map((setor) => {
      const doSetor = boletins.find((b) => b.setor && normalizarSetor(b.setor) === setor);
      return {
        setor,
        boletimId: doSetor ? String(doSetor.id) : null,
        fase: normalizarFaseSetor(doSetor?.status_producao)
      };
    });

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
      // Mesma regra do detalhe: sem promessa gravada, ausência — não string
      // vazia, que virava `new Date("")` e "Invalid Date" no Kanban e no painel.
      dataPrevistaEntrega: dataTermino,
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
      is_prd_aprovado: p.is_prd_aprovado === true,
      setores
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

// A fase de cada setor é gravada por `atualizarFaseSetor`, em
// `services/boletim-setores.service.ts` — mesma casa do resto do boletim.
