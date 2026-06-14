import { getSupabaseClient } from "@/lib/supabase/client";

export interface PropostaLiberadaBoletim {
  id_int: number;
  id_cliente: number | null;
  cliente: string;
  clienteNome: string;
  documento: string | null;
  vendedor: string;
  id_vendedor: string | null;
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
      id_vendedor: row.id_vendedor ? String(row.id_vendedor) : null,
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
      id_vendedor: row.id_vendedor ? String(row.id_vendedor) : null,
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
    id_vendedor: proposalRow.id_vendedor ? String(proposalRow.id_vendedor) : null,
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
 * após validar a elegibilidade da proposta diretamente no banco de dados.
 */
export async function criarPedidoParaBoletim(
  input: CriarPedidoInput
): Promise<CriarPedidoResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: "Conexão com o banco de dados não disponível." };
  }

  const idInt = input.id_int;

  // 1. Reconsultar diretamente o Supabase (public.propostas) usando maybeSingle()
  const { data: propostaRow, error: propostaError } = await client
    .from("propostas")
    .select("id, id_int, cliente, id_vendedor, vendedor, status_interno, valor_total, valor")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaError) {
    console.error("[BoletimPropostasService] Erro ao buscar proposta para validação:", {
      code: propostaError.code,
      details: propostaError.details,
      hint: propostaError.hint,
      message: propostaError.message
    });
    return { success: false, error: `Erro ao consultar proposta no banco de dados: ${propostaError.message}` };
  }

  if (!propostaRow) {
    return { success: false, error: "Proposta não encontrada" };
  }

  // Validações de elegibilidade da proposta obtida
  if (propostaRow.status_interno !== "APROVADO") {
    return { success: false, error: "Proposta ainda não aprovada" };
  }

  const idVendedorRaw = propostaRow.id_vendedor;
  if (idVendedorRaw === null || idVendedorRaw === undefined || String(idVendedorRaw).trim() === "") {
    return { success: false, error: "Proposta sem vendedor vinculado. Não é possível abrir OS." };
  }
  const idVendedor = String(idVendedorRaw).trim();

  // Validar se existe ao menos 1 produto em public.produtos_proposta para esse id_int
  const { data: productsData, error: productsError } = await client
    .from("produtos_proposta")
    .select("id")
    .eq("id_int", idInt);

  if (productsError) {
    console.error("[BoletimPropostasService] Erro ao consultar produtos da proposta:", {
      code: productsError.code,
      details: productsError.details,
      hint: productsError.hint,
      message: productsError.message
    });
    return { success: false, error: `Erro ao consultar produtos da proposta: ${productsError.message}` };
  }

  if (!productsData || productsData.length === 0) {
    return { success: false, error: "Proposta sem produtos vinculados" };
  }

  // Validar se não existe pedido em public.pedidos para esse id_int
  const { data: pedidosData, error: pedidosError } = await client
    .from("pedidos")
    .select("id")
    .eq("id_int", idInt);

  if (pedidosError) {
    console.error("[BoletimPropostasService] Erro ao verificar pedidos existentes:", {
      code: pedidosError.code,
      details: pedidosError.details,
      hint: pedidosError.hint,
      message: pedidosError.message
    });
    return { success: false, error: `Erro ao verificar pedidos existentes: ${pedidosError.message}` };
  }

  if (pedidosData && pedidosData.length > 0) {
    return { success: false, error: "Pedido já aberto para esta proposta" };
  }

  const valor_total_calc = (propostaRow.valor_total && Number(propostaRow.valor_total) !== 0)
    ? Number(propostaRow.valor_total)
    : (Number(propostaRow.valor) || 0);

  // 2. Montar payload do pedido
  const payload = {
    id_int: Number(propostaRow.id_int),
    id_vendedor: idVendedor,
    id_cliente: null,
    status_pedido: "BOLETIM_FINALIZADO",
    status_pagamento: "APROVADO",
    status_arte: "PENDENTE",
    status_producao: "BLOQUEADO",
    status_expedicao: "BLOQUEADO",
    descricao: input.descricao || `${propostaRow.cliente} - Boletim de entrada`,
    valor_total: valor_total_calc,
    forma_pagamento: null,
    obs: input.obs || null,
    data_pedido: new Date().toISOString()
  };

  // Validação de payload final antes do insert
  if (!payload.id_vendedor) {
    throw new Error("Payload inválido: id_vendedor ausente antes do INSERT.");
  }

  // Log do payload em desenvolvimento
  if (process.env.NODE_ENV !== "production") {
    console.info("[Boletim] Payload pedido pai", payload);
  }

  // 3. Executar o INSERT
  const { data, error } = await client
    .from("pedidos")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.error("[BoletimPropostasService] Erro ao cadastrar pedido pai:", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message
    });
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

export interface DesignerUsuario {
  user_id: string;
  nome_usuario: string;
  email: string;
}

export interface GabaritoProducao {
  id: string;
  id_gabarito: number | null;
  name: string;
}

/**
 * Busca todos os usuários configurados como designers (is_designer = true).
 */
export async function listarDesigners(): Promise<DesignerUsuario[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[BoletimPropostasService] Supabase client não inicializado.");
    return [];
  }

  const { data, error } = await client
    .from("usuarios")
    .select("user_id, nome_usuario, email")
    .eq("is_designer", true)
    .order("nome_usuario", { ascending: true });

  if (error || !data) {
    console.error("[BoletimPropostasService] Erro ao buscar designers:", error);
    return [];
  }

  return data.map((d) => ({
    user_id: String(d.user_id),
    nome_usuario: String(d.nome_usuario || ""),
    email: String(d.email || "")
  }));
}

/**
 * Busca todos os gabaritos cadastrados em public.producao_numeracoes.
 */
export async function listarGabaritos(): Promise<GabaritoProducao[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[BoletimPropostasService] Supabase client não inicializado.");
    return [];
  }

  const { data, error } = await client
    .from("producao_numeracoes")
    .select("*")
    .order("name", { ascending: true });

  if (error || !data) {
    console.error("[BoletimPropostasService] Erro ao buscar gabaritos:", error);
    return [];
  }

  return data.map((d) => ({
    id: String(d.id),
    id_gabarito: "id_gabarito" in d ? (d.id_gabarito !== null ? Number(d.id_gabarito) : null) : null,
    name: String(d.name || "")
  }));
}


