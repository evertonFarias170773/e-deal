import { getSupabaseClient } from "@/lib/supabase/client";
import type { PedidoProducaoListItem, PedidoStatus, ProdutoMock, ModeloMock } from "../types";

/**
 * Busca um pedido operacional na tabela public.pedidos por UUID (id) ou id_int.
 * Enriquece opcionalmente com dados da proposta vinculada (cliente, vendedor, empresa).
 * Tolera falhas e bloqueios de RLS de propostas sem omitir o pedido.
 */
export async function obterPedidoOperacionalPorIdOuIdInt(param: string | number): Promise<PedidoProducaoListItem | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[pedidos-detalhe.service] Supabase client não inicializado.");
    return null;
  }

  let query = client.from("pedidos").select(`
    id,
    id_int,
    id_cliente,
    id_vendedor,
    id_endereco,
    status_pedido,
    status_pagamento,
    status_arte,
    status_producao,
    status_expedicao,
    descricao,
    valor_total,
    forma_pagamento,
    data_pedido,
    data_aprovacao_arte,
    data_termino,
    codigo_rastreamento,
    link_pagamento,
    nota_fiscal_url,
    obs
  `);

  const paramStr = String(param).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paramStr);

  if (isUuid) {
    query = query.eq("id", paramStr);
  } else {
    const cleanNumStr = paramStr.replace("#", "");
    const idInt = Number(cleanNumStr);
    if (!isNaN(idInt)) {
      query = query.eq("id_int", idInt);
    } else {
      console.warn("[pedidos-detalhe.service] Parâmetro de busca inválido:", param);
      return null;
    }
  }

  const { data: row, error } = await query.maybeSingle();

  if (error) {
    console.error("[pedidos-detalhe.service] Erro ao obter pedido operacional:", error);
    return null;
  }

  if (!row) {
    return null;
  }

  // Enriquecer, se possível, com public.propostas pelo id_int
  let clienteNome = row.descricao || `Pedido #${row.id_int}`;
  let vendedor = "Não atribuído";
  let empresa = "Ideal Gráfica";
  const dataPedido = row.data_pedido || new Date().toISOString();
  let idCliente = 0;

  if (row.id_int !== null && row.id_int !== undefined) {
    try {
      const { data: propostaRow, error: propostaError } = await client
        .from("propostas")
        .select("cliente, vendedor, empresa, id_cliente")
        .eq("id_int", row.id_int)
        .maybeSingle();

      if (propostaError) {
         console.warn("[pedidos-detalhe.service] Erro ao buscar proposta para enriquecimento (não-fatal):", propostaError.message);
      } else if (propostaRow) {
        clienteNome = propostaRow.cliente || clienteNome;
        vendedor = propostaRow.vendedor || vendedor;
        empresa = propostaRow.empresa || empresa;
        idCliente = propostaRow.id_cliente !== null ? Number(propostaRow.id_cliente) : 0;
      }
    } catch (e) {
      console.warn("[pedidos-detalhe.service] Falha ao enriquecer dados do pedido:", e);
    }
  }

  // 3. Buscar os produtos reais associados ao pedido de public.produtos_proposta
  let produtos: (ProdutoMock & { db_id?: number })[] = [];
  try {
    const { data: produtosRows, error: produtosError } = await client
      .from("produtos_proposta")
      .select("*")
      .eq("id_int", row.id_int);

    if (produtosError) {
      console.warn("[pedidos-detalhe.service] Erro ao buscar produtos da proposta:", produtosError.message);
    } else if (produtosRows) {
      produtos = produtosRows.map((p) => ({
        id: `prod_${p.id}`,
        db_id: p.id,
        nome: p.nome_produto || "Produto",
        quantidade: Number(p.qtd || 0),
        pesoEstimado: Number(p.peso_base || 0),
        setor: "IMPRESSÃO",
        modelos: []
      }));
    }
  } catch (e) {
    console.warn("[pedidos-detalhe.service] Falha ao carregar produtos do pedido:", e);
  }

  // 4. Buscar os modelos reais cadastrados de public.pedidos_modelos
  let modelos: (ModeloMock & { id_produto_proposta_origem?: number | null })[] = [];
  try {
    const { data: modelosRows, error: modelosError } = await client
      .from("pedidos_modelos")
      .select("*")
      .eq("id_int", row.id_int)
      .order("ordem", { ascending: true });

    if (modelosError) {
      console.warn("[pedidos-detalhe.service] Erro ao buscar modelos do pedido:", modelosError.message);
    } else if (modelosRows) {
      modelos = modelosRows.map((m) => ({
        id: m.id,
        id_produto_proposta_origem: m.id_produto_proposta_origem,
        nomeModelo: m.nome_modelo,
        quantidade: Number(m.quantidade || 0),
        statusArte: m.status_arte,
        statusProducao: m.status_producao,
        setor: "Digital",
        numeracaoInicial: m.numeracao_inicio !== null ? Number(m.numeracao_inicio) : undefined,
        numeracaoFinal: m.numeracao_fim !== null ? Number(m.numeracao_fim) : undefined,
        verso: m.verso || false,
        corMaterial: m.cor_material || "Branco",
        observacoesTecnicas: m.descricao || "",
        configImpressao: {
          tipoNumeracao: m.tipo_numeracao || "SEM_NUMERACAO",
          qrCode: false,
          codBarras: false
        },
        historicoArtes: [],
        tokenAprovacao: ""
      }));
    }
  } catch (e) {
    console.warn("[pedidos-detalhe.service] Falha ao carregar modelos do pedido:", e);
  }

  // 5. Associar modelos aos seus produtos correspondentes
  if (produtos.length === 0 && modelos.length > 0) {
    produtos.push({
      id: "prod_virtual",
      nome: "Lotes / Modelos Cadastrados",
      quantidade: modelos.reduce((acc, curr) => acc + curr.quantidade, 0),
      pesoEstimado: 0,
      setor: "Digital",
      modelos: modelos
    });
  } else {
    produtos.forEach((prod) => {
      prod.modelos = modelos.filter(
        (m) => m.id_produto_proposta_origem === prod.db_id
      );
    });
    // Adicionar quaisquer modelos não mapeados ao primeiro produto
    const unmappedModels = modelos.filter(
      (m) => !produtos.some((prod) => prod.db_id === m.id_produto_proposta_origem)
    );
    if (unmappedModels.length > 0 && produtos[0]) {
      produtos[0].modelos.push(...unmappedModels);
    }
  }

  return {
    id: row.id,
    id_int: row.id_int !== null ? Number(row.id_int) : 0,
    clienteNome,
    contatoNome: "",
    idCliente,
    empresa,
    vendedor,
    dataPedido,
    dataPrevistaEntrega: row.data_termino || row.data_pedido || new Date().toISOString(),
    statusPedido: (row.status_pedido || "BOLETIM_FINALIZADO") as PedidoStatus,
    status_pedido: row.status_pedido || "BOLETIM_FINALIZADO",
    status_pagamento: row.status_pagamento || "APROVADO",
    status_arte: row.status_arte || "PENDENTE",
    status_producao: row.status_producao || "BLOQUEADO",
    status_expedicao: row.status_expedicao || "BLOQUEADO",
    urgente: false,
    formaPagamento: row.forma_pagamento || "",
    valorTotal: row.valor_total !== null ? Number(row.valor_total) : 0,
    pesoTeorico: 0,
    obs: row.obs || "",
    produtos,
    modelos
  } as PedidoProducaoListItem;
}
