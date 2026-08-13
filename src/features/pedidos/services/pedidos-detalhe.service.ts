import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { PedidoProducaoListItem, PedidoStatus, ProdutoMock, ModeloMock } from "../types";

/**
 * Busca um pedido operacional na tabela public.pedidos por UUID (id) ou id_int.
 * Enriquece opcionalmente com dados da proposta vinculada (cliente, vendedor, empresa).
 * Tolera falhas e bloqueios de RLS de propostas sem omitir o pedido.
 * Aceita um SupabaseClient injetado (uso server-side, ex.: PDF da OS); default = client browser.
 */
export async function obterPedidoOperacionalPorIdOuIdInt(param: string | number, supabaseClient?: SupabaseClient | null): Promise<PedidoProducaoListItem | null> {
  const client = supabaseClient ?? getSupabaseClient();
  if (!client) {
    console.warn("[pedidos-detalhe.service] Supabase client não inicializado.");
    return null;
  }

  let query = client.from("propostas_os").select(`
    id,
    id_int,
    id_cliente,
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

  const { data: rowData, error } = await query.maybeSingle();
  let row = rowData;

  if (error) {
    console.error("[pedidos-detalhe.service] Erro ao obter pedido operacional:", error);
    return null;
  }

  if (!row) {
    // Tenta verificar se existem modelos para este id_int, caso a OS (propostas_os) ainda não tenha sido criada
    if (!isUuid) {
      const idIntNum = Number(String(param).trim().replace("#", ""));
      const { data: modelsData } = await client.from("pedidos_modelos").select("id").eq("id_int", idIntNum).limit(1);
      
      if (modelsData && modelsData.length > 0) {
        // Cria um row sintético para carregar os modelos existentes
        row = {
          id: null,
          id_int: idIntNum,
          id_cliente: null,
          status_pedido: "BOLETIM_FINALIZADO",
          status_pagamento: "PENDENTE",
          status_arte: "PENDENTE",
          status_producao: "BLOQUEADO",
          status_expedicao: "BLOQUEADO",
          descricao: `Pedido Sintético #${idIntNum}`,
          valor_total: 0,
          forma_pagamento: null,
          data_pedido: new Date().toISOString(),
          obs: ""
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  // Enriquecer, se possível, com public.propostas pelo id_int
  let clienteNome = row?.descricao || `Pedido #${row?.id_int}`;
  let vendedor = "Não atribuído";
  let empresa = "Ideal Gráfica";
  const dataPedido = row?.data_pedido || new Date().toISOString();
  let idCliente = 0;
  /**
   * Status operacional da OS.
   *
   * `propostas_os.status_producao` é gravado como "BLOQUEADO" na criação do
   * boletim e nunca mais é atualizado por ninguém (não há trigger nem update no
   * código), então lê-lo direto deixava a OS eternamente bloqueada. A fonte
   * oficial do andamento é `propostas.status_interno`; enquanto a proposta não
   * for liberada para produção (`is_prd_aprovado`), BLOQUEADO é o estado certo.
   */
  let statusProducao = row?.status_producao || "BLOQUEADO";

  if (row?.id_int !== null && row?.id_int !== undefined) {
    try {
      const { data: propostaRow, error: propostaError } = await client
        .from("propostas")
        .select("cliente, vendedor, empresa, id_cliente, status_interno, is_prd_aprovado")
        .eq("id_int", row?.id_int)
        .maybeSingle();

      if (propostaError) {
         console.warn("[pedidos-detalhe.service] Erro ao buscar proposta para enriquecimento (não-fatal):", propostaError.message);
      } else if (propostaRow) {
        clienteNome = propostaRow.cliente || clienteNome;
        vendedor = propostaRow.vendedor || vendedor;
        empresa = propostaRow.empresa || empresa;
        idCliente = propostaRow.id_cliente !== null ? Number(propostaRow.id_cliente) : 0;
        const statusInterno = propostaRow.status_interno ? String(propostaRow.status_interno).trim() : "";
        statusProducao =
          propostaRow.is_prd_aprovado === true && statusInterno ? statusInterno : "BLOQUEADO";
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
      .eq("id_int", row?.id_int);

    if (produtosError) {
      console.warn("[pedidos-detalhe.service] Erro ao buscar produtos da proposta:", produtosError.message);
    } else if (produtosRows) {
      // Setor PCP é cadastro do produto (produtos.setor_pcp). Sem ele o boletim
      // mostrava "IMPRESSÃO" para todo mundo, inclusive FLEXO/TEXTIL/PVC.
      const idsProduto = Array.from(
        new Set(
          produtosRows
            .map((p) => (p.id_produto !== null && p.id_produto !== undefined ? Number(p.id_produto) : null))
            .filter((id): id is number => id !== null && Number.isFinite(id))
        )
      );
      const setorPorProduto = new Map<number, string>();
      // `produtos.prazo` e texto livre ("3 dias uteis"); o maior deles define a
      // data limite sugerida para os boletins do pedido.
      const prazoPorProduto = new Map<number, string>();
      if (idsProduto.length > 0) {
        const { data: catalogo } = await client
          .from("produtos")
          .select("id_produto, setor_pcp, prazo")
          .in("id_produto", idsProduto);
        for (const linha of catalogo || []) {
          const setor = linha.setor_pcp ? String(linha.setor_pcp).trim() : "";
          if (setor) setorPorProduto.set(Number(linha.id_produto), setor);
          const prazo = linha.prazo ? String(linha.prazo).trim() : "";
          if (prazo) prazoPorProduto.set(Number(linha.id_produto), prazo);
        }
      }

      produtos = produtosRows.map((p) => {
        const idProduto = p.id_produto !== null && p.id_produto !== undefined ? Number(p.id_produto) : null;
        return {
          id: `prod_${p.id}`,
          db_id: p.id,
          idProduto,
          nome: p.nome_produto || "Produto",
          quantidade: Number(p.qtd || 0),
          pesoEstimado: Number(p.peso_base || 0),
          pesoTotalGramas: Number(p.peso_total || 0),
          setor: (idProduto !== null ? setorPorProduto.get(idProduto) : undefined) || "LASER",
          prazoProducao: idProduto !== null ? prazoPorProduto.get(idProduto) ?? null : null,
          isEstoque: p.is_estoque === true,
          modelos: []
        };
      });
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
      .eq("id_int", row?.id_int)
      .order("ordem", { ascending: true });

    if (modelosError) {
      console.warn("[pedidos-detalhe.service] Erro ao buscar modelos do pedido:", modelosError.message);
    } else if (modelosRows) {
      modelos = modelosRows.map((m) => ({
        id: m.id,
        id_produto_proposta_origem: m.id_produto_proposta_origem,
        nomeModelo: m.nome_modelo || "Lote Principal",
        quantidade: Number(m.quantidade || 0),
        statusArte: m.status_arte,
        statusProducao: m.status_producao,
        // pedidos_modelos.setor é o setor real do lote (gravado na abertura do
        // boletim). O literal "Digital" que ficava aqui não existe no cadastro.
        setor: m.setor ? String(m.setor) : "",
        numeracaoInicial: m.numeracao_inicio !== null ? Number(m.numeracao_inicio) : undefined,
        numeracaoFinal: m.numeracao_fim !== null ? Number(m.numeracao_fim) : undefined,
        verso: m.frente_verso === true || m.frente_verso === 'true',
        corMaterial: m.padrao || m.cor_material || "Branco",
        observacoesTecnicas: m.descricao || "",
        gabaritoNumeracao: m.gabarito_operacional || "Sem gabarito",
        configImpressao: {
          tipoNumeracao: m.tipo_numeracao || "SEM_NUMERACAO",
          qrCode: false,
          codBarras: false,
          rfid: m.rfid_nfc === true || m.rfid_nfc === 'true'
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
      // Sem produto na proposta, o setor do grupo é o do primeiro lote.
      setor: modelos.find((m) => m.setor)?.setor || "LASER",
      modelos: modelos
    });
  } else if (modelos.length === 0) {
    // 6. Só usar "Lote Principal" como fallback quando não existir nenhum registro real em pedidos_modelos.
    produtos.forEach((prod, index) => {
      prod.modelos = [{
        id: `mod_fallback_${prod.db_id || index}`,
        nomeModelo: "Lote Principal",
        quantidade: prod.quantidade,
        statusArte: "PENDENTE",
        statusProducao: "PENDENTE",
        setor: prod.setor || "",
        verso: false,
        corMaterial: "Branco",
        observacoesTecnicas: "",
        configImpressao: {
          tipoNumeracao: "SEM_NUMERACAO",
          qrCode: false,
          codBarras: false,
          rfid: false
        },
        historicoArtes: [],
        tokenAprovacao: ""
      }];
    });
  } else {
    // 7. Não exibir "Lote Principal" quando existirem modelos reais no banco.
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
    id: row?.id,
    id_int: row?.id_int !== null ? Number(row?.id_int) : 0,
    clienteNome,
    contatoNome: "",
    idCliente,
    empresa,
    vendedor,
    dataPedido,
    dataPrevistaEntrega: row?.data_termino || row?.data_pedido || new Date().toISOString(),
    statusPedido: (row?.status_pedido || "BOLETIM_FINALIZADO") as PedidoStatus,
    status_pedido: row?.status_pedido || "BOLETIM_FINALIZADO",
    status_pagamento: row?.status_pagamento || "APROVADO",
    status_arte: row?.status_arte || "PENDENTE",
    status_producao: statusProducao,
    status_expedicao: row?.status_expedicao || "BLOQUEADO",
    urgente: false,
    formaPagamento: row?.forma_pagamento || "",
    valorTotal: row?.valor_total !== null ? Number(row?.valor_total) : 0,
    pesoTeorico: 0,
    obs: row?.obs || "",
    produtos,
    modelos
  } as PedidoProducaoListItem;
}
