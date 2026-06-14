import { getSupabaseClient } from "@/lib/supabase/client";

export interface PropostaLiberadaBoletim {
  id_int: number;
  id_cliente: number | null;
  cliente: string;
  clienteNome: string;
  documento: string | null;
  vendedor: string;
  id_vendedor: number | null;
  status_interno: string;
  valor_total: number;
  created_at: string;
  updated_at: string;
  qtd_produtos: number;
}

export interface ObterPropostaResult {
  success: boolean;
  proposta?: PropostaLiberadaBoletim;
  error?: string;
}

/**
 * Lista as propostas elegíveis para abertura de Boletim de Entrada.
 * Limita o retorno final em no máximo 20 registros.
 */
export async function listarPropostasLiberadasParaBoletim(): Promise<PropostaLiberadaBoletim[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[BoletimPropostasService] Supabase client não inicializado.");
    return [];
  }

  // Busca candidatos com status APROVADO e vendedor informado.
  // Usamos limit 200 para garantir que pegamos registros suficientes antes dos filtros em JS.
  const { data: rows, error } = await client
    .from("propostas")
    .select(`
      id_int,
      id_cliente,
      cliente,
      cnpjCpf,
      vendedor,
      id_vendedor,
      status_interno,
      valor_total,
      valor,
      created_at,
      updated_at,
      produtos_proposta (id)
    `)
    .eq("status_interno", "APROVADO")
    .not("id_int", "is", null)
    .not("id_vendedor", "is", null)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error || !rows) {
    console.error("[BoletimPropostasService] Erro ao buscar propostas candidatos:", error);
    return [];
  }

  // Filtragem no cliente (JS):
  // 1. Garantir que existam produtos associados
  const withProducts = rows.filter(
    (row) => row.produtos_proposta && row.produtos_proposta.length > 0
  );

  if (withProducts.length === 0) {
    return [];
  }

  // 2. Garantir que não existam pedidos com o mesmo id_int
  const idInts = withProducts.map((p) => Number(p.id_int)).filter(Boolean);
  const existingPedidoIds = new Set<number>();

  if (idInts.length > 0) {
    const { data: pedidosData, error: pedidosError } = await client
      .from("pedidos")
      .select("id_int")
      .in("id_int", idInts);

    if (pedidosError) {
      console.error("[BoletimPropostasService] Erro ao buscar pedidos existentes:", pedidosError);
    } else if (pedidosData) {
      pedidosData.forEach((p) => {
        if (p.id_int !== null && p.id_int !== undefined) {
          existingPedidoIds.add(Number(p.id_int));
        }
      });
    }
  }

  // Filtra as elegíveis e mapeia para a interface final
  const eligible = withProducts.filter((p) => !existingPedidoIds.has(Number(p.id_int)));

  const mapped = eligible.map((row) => {
    const valor_total_calc = (row.valor_total && Number(row.valor_total) !== 0) ? Number(row.valor_total) : (Number(row.valor) || 0);
    return {
      id_int: Number(row.id_int),
      id_cliente: row.id_cliente ? Number(row.id_cliente) : null,
      cliente: String(row.cliente || ""),
      clienteNome: String(row.cliente || ""),
      documento: row.cnpjCpf ? String(row.cnpjCpf) : null,
      vendedor: String(row.vendedor || ""),
      id_vendedor: row.id_vendedor ? Number(row.id_vendedor) : null,
      status_interno: String(row.status_interno || ""),
      valor_total: valor_total_calc,
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
      qtd_produtos: row.produtos_proposta ? row.produtos_proposta.length : 0
    };
  });

  // Aplica o limite 20 após a validação
  return mapped.slice(0, 20);
}

/**
 * Busca propostas elegíveis para abertura de Boletim de Entrada usando termo de busca.
 */
export async function buscarPropostasLiberadasParaBoletim(
  termo: string
): Promise<PropostaLiberadaBoletim[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[BoletimPropostasService] Supabase client não inicializado.");
    return [];
  }

  const cleanTerm = (termo || "").trim();
  if (!cleanTerm) {
    return listarPropostasLiberadasParaBoletim();
  }

  let query = client
    .from("propostas")
    .select(`
      id_int,
      id_cliente,
      cliente,
      cnpjCpf,
      vendedor,
      id_vendedor,
      status_interno,
      valor_total,
      valor,
      created_at,
      updated_at,
      produtos_proposta (id)
    `)
    .eq("status_interno", "APROVADO")
    .not("id_int", "is", null)
    .not("id_vendedor", "is", null);

  const numericId = parseInt(cleanTerm, 10);
  if (!isNaN(numericId) && numericId.toString() === cleanTerm) {
    query = query.or(`cliente.ilike.%${cleanTerm}%,cnpjCpf.ilike.%${cleanTerm}%,id_int.eq.${numericId}`);
  } else {
    query = query.or(`cliente.ilike.%${cleanTerm}%,cnpjCpf.ilike.%${cleanTerm}%`);
  }

  query = query
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(200);

  const { data: rows, error } = await query;
  if (error || !rows) {
    console.error("[BoletimPropostasService] Erro ao buscar propostas candidatos:", error);
    return [];
  }

  const withProducts = rows.filter(
    (row) => row.produtos_proposta && row.produtos_proposta.length > 0
  );

  if (withProducts.length === 0) {
    return [];
  }

  const idInts = withProducts.map((p) => Number(p.id_int)).filter(Boolean);
  const existingPedidoIds = new Set<number>();

  if (idInts.length > 0) {
    const { data: pedidosData, error: pedidosError } = await client
      .from("pedidos")
      .select("id_int")
      .in("id_int", idInts);

    if (pedidosError) {
      console.error("[BoletimPropostasService] Erro ao buscar pedidos existentes na busca:", pedidosError);
    } else if (pedidosData) {
      pedidosData.forEach((p) => {
        if (p.id_int !== null && p.id_int !== undefined) {
          existingPedidoIds.add(Number(p.id_int));
        }
      });
    }
  }

  const eligible = withProducts.filter((p) => !existingPedidoIds.has(Number(p.id_int)));

  const mapped = eligible.map((row) => {
    const valor_total_calc = (row.valor_total && Number(row.valor_total) !== 0) ? Number(row.valor_total) : (Number(row.valor) || 0);
    return {
      id_int: Number(row.id_int),
      id_cliente: row.id_cliente ? Number(row.id_cliente) : null,
      cliente: String(row.cliente || ""),
      clienteNome: String(row.cliente || ""),
      documento: row.cnpjCpf ? String(row.cnpjCpf) : null,
      vendedor: String(row.vendedor || ""),
      id_vendedor: row.id_vendedor ? Number(row.id_vendedor) : null,
      status_interno: String(row.status_interno || ""),
      valor_total: valor_total_calc,
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
      qtd_produtos: row.produtos_proposta ? row.produtos_proposta.length : 0
    };
  });

  return mapped;
}

/**
 * Busca uma proposta específica no Supabase por id_int e avalia regras de elegibilidade passo a passo.
 * Retorna motivo amigável em português quando bloqueada/inválida.
 */
export async function obterPropostaLiberadaParaBoletim(
  idInt: number
): Promise<ObterPropostaResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: "Conexão com o banco de dados não disponível." };
  }

  // 1. Busca proposta básica
  const { data: proposalRow, error: proposalError } = await client
    .from("propostas")
    .select(`
      id_int,
      id_cliente,
      cliente,
      cnpjCpf,
      vendedor,
      id_vendedor,
      status_interno,
      valor_total,
      valor,
      created_at,
      updated_at
    `)
    .eq("id_int", idInt)
    .maybeSingle();

  if (proposalError) {
    console.error("[BoletimPropostasService] Erro ao obter proposta:", proposalError);
    return { success: false, error: "Erro ao consultar proposta no banco de dados." };
  }

  if (!proposalRow) {
    return { success: false, error: "Proposta não encontrada" };
  }

  // 2. Verifica se está aprovada
  if (proposalRow.status_interno !== "APROVADO") {
    return { success: false, error: "Proposta ainda não aprovada" };
  }

  // 3. Verifica se tem vendedor
  if (proposalRow.id_vendedor === null || proposalRow.id_vendedor === undefined) {
    return { success: false, error: "Proposta sem vendedor vinculado" };
  }

  // 4. Verifica se tem produtos
  const { data: productsData, error: productsError } = await client
    .from("produtos_proposta")
    .select("id")
    .eq("id_int", idInt);

  if (productsError) {
    console.error("[BoletimPropostasService] Erro ao consultar produtos da proposta:", productsError);
    return { success: false, error: "Erro ao consultar produtos da proposta." };
  }

  const productCount = productsData ? productsData.length : 0;
  if (productCount === 0) {
    return { success: false, error: "Proposta sem produtos vinculados" };
  }

  // 5. Verifica se já existe pedido
  const { data: pedidosData, error: pedidosError } = await client
    .from("pedidos")
    .select("id")
    .eq("id_int", idInt);

  if (pedidosError) {
    console.error("[BoletimPropostasService] Erro ao verificar pedidos existentes:", pedidosError);
    return { success: false, error: "Erro ao consultar pedidos existentes." };
  }

  if (pedidosData && pedidosData.length > 0) {
    return { success: false, error: "Pedido já aberto para esta proposta" };
  }

  // Elegível!
  const valor_total_calc = (proposalRow.valor_total && Number(proposalRow.valor_total) !== 0) ? Number(proposalRow.valor_total) : (Number(proposalRow.valor) || 0);
  const proposta: PropostaLiberadaBoletim = {
    id_int: Number(proposalRow.id_int),
    id_cliente: proposalRow.id_cliente ? Number(proposalRow.id_cliente) : null,
    cliente: String(proposalRow.cliente || ""),
    clienteNome: String(proposalRow.cliente || ""),
    documento: proposalRow.cnpjCpf ? String(proposalRow.cnpjCpf) : null,
    vendedor: String(proposalRow.vendedor || ""),
    id_vendedor: proposalRow.id_vendedor ? Number(proposalRow.id_vendedor) : null,
    status_interno: String(proposalRow.status_interno || ""),
    valor_total: valor_total_calc,
    created_at: String(proposalRow.created_at || ""),
    updated_at: String(proposalRow.updated_at || ""),
    qtd_produtos: productCount
  };

  return { success: true, proposta };
}

export interface CriarPedidoInput {
  id_int: number;
  descricao: string;
  obs: string | null;
}

export interface CriarPedidoResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Cria o registro do pedido pai na tabela public.pedidos do Supabase
 * após validar a elegibilidade da proposta.
 */
export async function criarPedidoParaBoletim(
  input: CriarPedidoInput
): Promise<CriarPedidoResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: "Conexão com o banco de dados não disponível." };
  }

  const idInt = input.id_int;

  // 1. Validar elegibilidade da proposta novamente
  const check = await obterPropostaLiberadaParaBoletim(idInt);
  if (!check.success || !check.proposta) {
    return { success: false, error: check.error || "Proposta inelegível para abertura de boletim." };
  }

  const proposta = check.proposta;

  // 2. Montar payload do pedido
  const payload = {
    id_int: proposta.id_int,
    id_vendedor: proposta.id_vendedor,
    id_cliente: null,
    status_pedido: "BOLETIM_FINALIZADO",
    status_pagamento: "APROVADO",
    status_arte: "PENDENTE",
    status_producao: "BLOQUEADO",
    status_expedicao: "BLOQUEADO",
    descricao: input.descricao || `${proposta.cliente} - Boletim de entrada`,
    valor_total: proposta.valor_total,
    forma_pagamento: null,
    obs: input.obs || null,
    data_pedido: new Date().toISOString()
  };

  // 3. Executar o INSERT
  const { data, error } = await client
    .from("pedidos")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.error("[BoletimPropostasService] Erro ao cadastrar pedido pai:", error);
    if (error.code === "42501") {
      return { success: false, error: "Permissão negada (RLS) para cadastrar o pedido." };
    }
    return { success: false, error: error.message || "Falha ao cadastrar o pedido no Supabase." };
  }

  if (!data || !data.id) {
    return { success: false, error: "O Supabase não retornou o identificador do pedido criado." };
  }

  return { success: true, id: String(data.id) };
}

