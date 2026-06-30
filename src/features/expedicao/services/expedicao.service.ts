import { getSupabaseClient } from "@/lib/supabase/client";
import type { ExpedicaoListItem, FreteInfo } from "../types";

export async function listarExpedicoes(): Promise<ExpedicaoListItem[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[expedicao.service] Supabase client não inicializado.");
    return [];
  }

  // 1. Buscar propostas com status logístico
  const statusLogisticos = ["EXPEDICAO", "A RETIRAR", "EM TRANSITO", "ENTREGUE"];
  const { data: propostas, error: propError } = await client
    .from("propostas")
    .select("id_int, cliente, status_interno")
    .in("status_interno", statusLogisticos)
    .order("id_int", { ascending: false });

  if (propError) {
    console.error("[expedicao.service] Erro ao buscar propostas logísticas:", propError);
  }

  const propostasIds = (propostas || []).map(p => p.id_int);

  // 2. Buscar pedidos legados que estão em expedição, mas cuja proposta talvez não tenha status logístico atualizado
  const statusPedidosLegados = ["PRONTO_EXPEDICAO", "EXPEDIDO"];
  const { data: pedidosLegados, error: pedLegadosError } = await client
    .from("propostas_os")
    .select("id_int, descricao, status_pedido, status_expedicao")
    .in("status_expedicao", statusPedidosLegados);
    
  if (pedLegadosError) {
    console.error("[expedicao.service] Erro ao buscar pedidos legados:", pedLegadosError);
  }

  const legacyIds = (pedidosLegados || [])
    .map(p => p.id_int)
    .filter((id): id is number => id !== null && !propostasIds.includes(id));

  const allIds = [...propostasIds, ...legacyIds];
  if (allIds.length === 0) {
    return [];
  }

  // Se precisar de nomes de clientes dos legados, já que não temos em propostas
  let legacyPropostas: any[] = [];
  if (legacyIds.length > 0) {
    const { data: propLegadas } = await client
      .from("propostas")
      .select("id_int, cliente, status_interno")
      .in("id_int", legacyIds);
    if (propLegadas) {
      legacyPropostas = propLegadas;
    }
  }

  const todasPropostasMap = new Map<number, any>();
  (propostas || []).forEach(p => todasPropostasMap.set(p.id_int, { ...p, isLegacy: false }));
  legacyPropostas.forEach(p => todasPropostasMap.set(p.id_int, { ...p, isLegacy: true }));

  // 3. Buscar os pedidos associados para pegar rastreamento, status de produção, etc
  const { data: pedidos, error: pedError } = await client
    .from("propostas_os")
    .select("id, id_int, codigo_rastreamento, status_producao, status_expedicao, data_termino, obs")
    .in("id_int", allIds);

  if (pedError) {
    console.warn("[expedicao.service] Erro ao buscar pedidos vinculados:", pedError);
  }

  const pedidosMap = new Map<number, any>();
  (pedidos || []).forEach(p => {
    if (p.id_int !== null) {
      pedidosMap.set(p.id_int, p);
    }
  });

  // 4. Buscar os fretes escolhidos
  const { data: fretes, error: fretesError } = await client
    .from("cotacao_frete")
    .select("id_int, transportadora, servico, valor, prazo, peso_usado, volumes, observacao")
    .eq("escolhido", true)
    .in("id_int", allIds);

  if (fretesError) {
    console.warn("[expedicao.service] Erro ao buscar cotações de frete:", fretesError);
  }

  const fretesMap = new Map<number, FreteInfo>();
  (fretes || []).forEach(f => {
    fretesMap.set(f.id_int, {
      transportadora: f.transportadora || "Transportadora",
      servico: f.servico || "",
      valor: f.valor !== null ? Number(f.valor) : 0,
      prazo: f.prazo || "Sob consulta",
      pesoUsado: f.peso_usado !== null ? Number(f.peso_usado) : 0,
      volumes: f.volumes !== null ? Number(f.volumes) : 1,
      observacao: f.observacao || ""
    });
  });

  // 5. Mapear para retorno
  const resultado: ExpedicaoListItem[] = [];
  
  // Vamos iterar sobre todasPropostasMap
  todasPropostasMap.forEach((prop, id_int) => {
    const pedido = pedidosMap.get(id_int);
    const frete = fretesMap.get(id_int);
    
    // Regra rígida: Retirada Local se transportadora for "Retirada", "Balcão", "Sem custo"
    let isRetiradaLocal = false;
    let freteDefinido = false;
    
    if (frete) {
      freteDefinido = true;
      const transpUpper = (frete.transportadora || "").toUpperCase();
      const servicoUpper = (frete.servico || "").toUpperCase();
      
      if (
        transpUpper.includes("RETIRADA") || 
        servicoUpper.includes("RETIRADA") || 
        transpUpper.includes("BALCÃO") || 
        transpUpper.includes("BALCAO") ||
        transpUpper.includes("SEM CUSTO")
      ) {
        isRetiradaLocal = true;
      }
    }

    resultado.push({
      id_int,
      cliente: prop.cliente || pedido?.descricao || `Proposta #${id_int}`,
      statusLogistico: prop.status_interno || (prop.isLegacy && pedido ? (pedido.status_expedicao || "Desconhecido") : "Desconhecido"),
      isLegacy: !!prop.isLegacy,
      idPedido: pedido?.id,
      codigoRastreamento: pedido?.codigo_rastreamento || "",
      statusProducao: pedido?.status_producao,
      statusExpedicao: pedido?.status_expedicao,
      dataTermino: pedido?.data_termino,
      observacoesOs: pedido?.obs || "",
      frete,
      isRetiradaLocal,
      freteDefinido
    });
  });

  // Ordenar decrescente por id_int
  resultado.sort((a, b) => b.id_int - a.id_int);

  return resultado;
}
