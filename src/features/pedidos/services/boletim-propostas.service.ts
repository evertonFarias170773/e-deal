import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import { sendPropostaChatMessage } from "@/features/orcamentos/services/orcamentos.service";

export const BOLETIM_ELIGIBLE_STATUSES = [
  "APROVADO",
  "APROVADO / EM ARTE",
  "REVISAO ATENDENTE",
  "REVISAO PRODUCAO",
  "EM PRODUCAO" // Pode fazer sentido listar para emissão retroativa se necessário
];

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
    .in("status_interno", BOLETIM_ELIGIBLE_STATUSES)
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
      .from("propostas_os")
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
  // Multi-boletim: a proposta continua elegível mesmo com pedido aberto, porque
  // cada setor abre o seu próprio boletim sobre o mesmo pedido.
  void existingPedidoIds;
  const eligible = withProducts;

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
    .in("status_interno", BOLETIM_ELIGIBLE_STATUSES)
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
      .from("propostas_os")
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

  // Multi-boletim: a proposta continua elegível mesmo com pedido aberto, porque
  // cada setor abre o seu próprio boletim sobre o mesmo pedido.
  void existingPedidoIds;
  const eligible = withProducts;

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
  if (!BOLETIM_ELIGIBLE_STATUSES.includes(proposalRow.status_interno || "")) {
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

  // 5. O pedido (propostas_os) é único por proposta, mas não bloqueia mais a
  // abertura: uma proposta pode ter vários boletins, um por setor, todos
  // vinculados ao mesmo pedido. Reaproveitamos o pedido existente quando houver.

  // 5b. Verifica se já existem modelos (Apenas log, não bloqueia mais a abertura)
  const { data: modelsData, error: modelsError } = await client
    .from("pedidos_modelos")
    .select("id")
    .eq("id_int", idInt);

  if (modelsError) {
    console.error("[BoletimPropostasService] Erro ao verificar modelos existentes:", modelsError);
  }

  // Removido o bloqueio de abertura por modelos existentes para permitir edição.

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
  data_termino?: string;
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
  if (!BOLETIM_ELIGIBLE_STATUSES.includes(propostaRow.status_interno || "")) {
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

  // O pedido (propostas_os) é único por proposta e agrupa TODOS os boletins de
  // setor. Se já existe, reaproveitamos em vez de bloquear — abrir o boletim de
  // um novo setor não pode exigir um segundo pedido.
  const { data: pedidosData, error: pedidosError } = await client
    .from("propostas_os")
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
    return { success: true, id: String(pedidosData[0].id) };
  }

  // (Bloqueio de modelos removido aqui para permitir criação de OS retroativa. 
  // A prevenção de duplicidade ocorre em salvarModelosBoletim)

  const valor_total_calc = (propostaRow.valor_total && Number(propostaRow.valor_total) !== 0)
    ? Number(propostaRow.valor_total)
    : (Number(propostaRow.valor) || 0);

  // 2. Montar payload do pedido
  const payload = {
    id_int: Number(propostaRow.id_int),
    nome_vendedor: idVendedor,
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
    data_pedido: new Date().toISOString(),
    data_termino: input.data_termino || null
  };

  // Validação de payload final antes do insert
  if (!payload.nome_vendedor) {
    throw new Error("Payload inválido: nome_vendedor ausente antes do INSERT.");
  }

  // Log do payload em desenvolvimento
  if (process.env.NODE_ENV !== "production") {
    console.info("[Boletim] Payload pedido pai", payload);
  }

  // 3. Executar o INSERT
  const { data, error } = await client
    .from("propostas_os")
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

export interface ModeloBoletimInput {
  id_produto_proposta_origem: number | null;
  nome_modelo: string;
  descricao: string | null;
  quantidade: number;
  tipo_numeracao: string | null;
  numeracao_inicio: number | null;
  numeracao_fim: number | null;
  obs_impressao: string | null;
  bloco?: string | null;
  /** Setor do PRODUTO deste lote. Sem ele cai no `setor` geral da chamada. */
  setor?: string | null;
}

/**
 * Salva a lista de modelos do boletim em public.pedidos_modelos.
 * `setor` identifica a que boletim os modelos pertencem — a anti-duplicidade é
 * por (id_int, setor), de modo que setores diferentes convivem na mesma proposta.
 */
export async function salvarModelosBoletim(
  idInt: number,
  idPedido: string,
  modelosInput: ModeloBoletimInput[],
  setor?: string | null
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: "Conexão com o banco de dados não disponível." };
  }

  // 1. Validar inputs básicos
  for (const m of modelosInput) {
    if (m.quantidade <= 0) {
      return { success: false, error: "A quantidade de cada lote/modelo deve ser maior que zero." };
    }
    if (!m.nome_modelo.trim()) {
      return { success: false, error: "O nome de cada lote/modelo é obrigatório." };
    }
  }

  if (!idPedido) {
    return { success: false, error: "ID do pedido pai não fornecido." };
  }
  if (!idInt) {
    return { success: false, error: "ID interno (id_int) não fornecido." };
  }

  // 2. Anti-duplicidade POR SETOR: cada boletim tem os seus modelos. Abrir o
  // boletim de um novo setor não pode esbarrar nos modelos de outro setor.
  const setorDoLote = (setor || "").trim() || null;
  let queryExistentes = client.from("pedidos_modelos").select("id").eq("id_int", idInt);
  queryExistentes = setorDoLote
    ? queryExistentes.eq("setor", setorDoLote)
    : queryExistentes.is("setor", null);

  const { data: existingModelos, error: queryError } = await queryExistentes;

  if (queryError) {
    console.error("[BoletimPropostasService] Erro ao consultar modelos existentes:", queryError);
    return { success: false, error: `Erro ao verificar duplicidade de modelos: ${queryError.message}` };
  }

  if (existingModelos && existingModelos.length > 0) {
    return {
      success: false,
      error: setorDoLote
        ? `Já existem lotes cadastrados no setor ${setorDoLote} desta proposta.`
        : "Modelos/lotes já cadastrados para este pedido. Edição será liberada em etapa futura."
    };
  }

  // 3. Mapear os dados para o payload.
  // `descricao` e `obs_impressao` não existem em public.pedidos_modelos — o insert
  // falhava por coluna inexistente. A observação livre vai para `observacao_arte`.
  const payloads = modelosInput.map((m, idx) => ({
    id_int: idInt,
    id_produto_proposta_origem: m.id_produto_proposta_origem || null,
    nome_modelo: m.nome_modelo,
    quantidade: m.quantidade,
    // Setor por lote: um pedido pode ter produtos de setores diferentes, e cada
    // lote precisa ficar no boletim do SEU setor.
    setor: m.setor ?? setorDoLote,
    tipo_numeracao: m.tipo_numeracao || null,
    numeracao_inicio: m.numeracao_inicio || null,
    numeracao_fim: m.numeracao_fim || null,
    observacao_arte: m.descricao || m.obs_impressao || null,
    bloco: m.bloco || null,
    status_arte: "PENDENTE",
    status_producao: "BLOQUEADO",
    ordem: idx + 1
  }));

  // 4. Inserir em lote no Supabase
  const { error: insertError } = await client
    .from("pedidos_modelos")
    .insert(payloads);

  if (insertError) {
    console.error("[BoletimPropostasService] Erro ao salvar modelos de pedido:", insertError);
    return { success: false, error: insertError.message || "Falha ao salvar lotes/modelos no Supabase." };
  }

  return { success: true };
}

export interface ParsedObs {
  obsCriticas: string;
  designer: {
    user_id: string;
    nome: string;
    email: string;
  } | null;
  orientacoesDesign: string;
  obsImpressao: string;
  obsAcabamento: string;
  logistica?: {
    servico_transporte?: string;
    transportador?: string;
    peso_real?: string;
    qtd_volumes?: string;
    tipo_volume?: string;
    responsavel_logistica?: string;
    observacoes_frete?: string;
  };
  // A revisão/conferência de cada setor NÃO fica aqui: é uma linha por setor em
  // `propostas_os_setores` (colunas de verdade, desde 13/08/2026). A logística
  // acima continua sendo do pedido inteiro — é a aba Expedição.
}

export function parsePedidosObs(obsText: string | null | undefined): ParsedObs {
  const text = obsText || "";
  const result: ParsedObs = {
    obsCriticas: "",
    designer: null,
    orientacoesDesign: "",
    obsImpressao: "",
    obsAcabamento: ""
  };

  const tags = [
    { key: "obsCriticas", header: "[Observações críticas]" },
    { key: "designer", header: "[Designer]" },
    { key: "orientacoesDesign", header: "[Orientações para design]" },
    { key: "obsImpressao", header: "[Impressão]" },
    { key: "obsAcabamento", header: "[Acabamento]" },
    { key: "logistica", header: "[Logística]" }
  ];

  const extractBlock = (tagHeader: string): string => {
    const startIdx = text.indexOf(tagHeader);
    if (startIdx === -1) return "";
    const contentStart = startIdx + tagHeader.length;
    let endIdx = text.length;
    for (const otherTag of tags) {
      if (otherTag.header === tagHeader) continue;
      const idx = text.indexOf(otherTag.header, contentStart);
      if (idx !== -1 && idx < endIdx) {
        endIdx = idx;
      }
    }
    return text.substring(contentStart, endIdx).trim();
  };

  const obsCritContent = extractBlock("[Observações críticas]");
  const designerContent = extractBlock("[Designer]");
  const designContent = extractBlock("[Orientações para design]");
  const impContent = extractBlock("[Impressão]");
  const acabContent = extractBlock("[Acabamento]");
  const logisticaContent = extractBlock("[Logística]");

  const firstTagIndex = Math.min(
    ...tags.map(t => {
      const idx = text.indexOf(t.header);
      return idx === -1 ? Infinity : idx;
    })
  );
  let legacyContent = "";
  if (firstTagIndex !== Infinity && firstTagIndex > 0) {
    legacyContent = text.substring(0, firstTagIndex).trim();
  } else if (firstTagIndex === Infinity) {
    legacyContent = text.trim();
  }

  result.obsCriticas = obsCritContent || legacyContent || "";
  result.orientacoesDesign = designContent || "";
  result.obsImpressao = impContent || "";
  result.obsAcabamento = acabContent || "";

  if (designerContent) {
    const userIdMatch = designerContent.match(/user_id:\s*([^\n\r]+)/i);
    const nomeMatch = designerContent.match(/nome:\s*([^\n\r]+)/i);
    const emailMatch = designerContent.match(/email:\s*([^\n\r]+)/i);

    if (userIdMatch || nomeMatch || emailMatch) {
      result.designer = {
        user_id: userIdMatch ? userIdMatch[1].trim() : "",
        nome: nomeMatch ? nomeMatch[1].trim() : "",
        email: emailMatch ? emailMatch[1].trim() : ""
      };
    }
  }

  if (logisticaContent) {
    const servicoMatch = logisticaContent.match(/servico_transporte:\s*([^\n\r]+)/i);
    const transportadorMatch = logisticaContent.match(/transportador:\s*([^\n\r]+)/i);
    const pesoRealMatch = logisticaContent.match(/peso_real:\s*([^\n\r]+)/i);
    const qtdVolumesMatch = logisticaContent.match(/qtd_volumes:\s*([^\n\r]+)/i);
    const tipoVolumeMatch = logisticaContent.match(/tipo_volume:\s*([^\n\r]+)/i);
    const responsavelMatch = logisticaContent.match(/responsavel_logistica:\s*([^\n\r]+)/i);
    const obsFreteMatch = logisticaContent.match(/observacoes_frete:\s*([^\n\r]*)/i);

    result.logistica = {
      servico_transporte: servicoMatch ? servicoMatch[1].trim() : "",
      transportador: transportadorMatch ? transportadorMatch[1].trim() : "",
      peso_real: pesoRealMatch ? pesoRealMatch[1].trim() : "",
      qtd_volumes: qtdVolumesMatch ? qtdVolumesMatch[1].trim() : "",
      tipo_volume: tipoVolumeMatch ? tipoVolumeMatch[1].trim() : "",
      responsavel_logistica: responsavelMatch ? responsavelMatch[1].trim() : "",
      observacoes_frete: obsFreteMatch ? obsFreteMatch[1].trim() : ""
    };
  }

  return result;
}

export interface SerializeObsInput {
  obsCriticas?: string;
  designer?: {
    user_id: string;
    nome: string;
    email: string;
  } | null;
  orientacoesDesign?: string;
  obsImpressao?: string;
  obsAcabamento?: string;
  logistica?: {
    servico_transporte?: string;
    transportador?: string;
    peso_real?: string;
    qtd_volumes?: string;
    tipo_volume?: string;
    responsavel_logistica?: string;
    observacoes_frete?: string;
  };
  // A conferência de cada setor mora em `propostas_os_setores`, não neste texto.
}

export function serializePedidosObs(input: SerializeObsInput, existingObsText: string | null | undefined): string {
  const parsed = parsePedidosObs(existingObsText);

  const finalCriticas = input.obsCriticas !== undefined ? input.obsCriticas : parsed.obsCriticas;
  const finalDesigner = input.designer !== undefined ? input.designer : parsed.designer;
  const finalOrientacoes = input.orientacoesDesign !== undefined ? input.orientacoesDesign : parsed.orientacoesDesign;
  const finalImpressao = input.obsImpressao !== undefined ? input.obsImpressao : parsed.obsImpressao;
  const finalAcabamento = input.obsAcabamento !== undefined ? input.obsAcabamento : parsed.obsAcabamento;
  const finalLogistica = input.logistica !== undefined ? input.logistica : parsed.logistica;

  let serialized = "";
  serialized += `[Observações críticas]\n${finalCriticas.trim() || "-"}\n\n`;

  if (finalDesigner) {
    serialized += `[Designer]\nuser_id: ${finalDesigner.user_id}\nnome: ${finalDesigner.nome}\nemail: ${finalDesigner.email}\n\n`;
  }

  serialized += `[Orientações para design]\n${finalOrientacoes.trim() || "-"}\n\n`;
  serialized += `[Impressão]\n${finalImpressao.trim() || "-"}\n\n`;
  serialized += `[Acabamento]\n${finalAcabamento.trim() || "-"}`;

  if (finalLogistica) {
    serialized += `\n\n[Logística]\n`;
    serialized += `servico_transporte: ${finalLogistica.servico_transporte || ""}\n`;
    serialized += `transportador: ${finalLogistica.transportador || ""}\n`;
    serialized += `peso_real: ${finalLogistica.peso_real || ""}\n`;
    serialized += `qtd_volumes: ${finalLogistica.qtd_volumes || ""}\n`;
    serialized += `tipo_volume: ${finalLogistica.tipo_volume || ""}\n`;
    serialized += `responsavel_logistica: ${finalLogistica.responsavel_logistica || ""}\n`;
    serialized += `observacoes_frete: ${finalLogistica.observacoes_frete || ""}`;
  }

  return serialized;
}

export interface AtualizarBoletimResult {
  success: boolean;
  error?: string;
  details?: string;
  hint?: string;
  code?: string;
}

/**
 * Grava a orientacao tecnica de producao em `public.propostas.obs_tecnica`.
 *
 * E o MESMO registro que o vendedor edita na aba Producao da proposta: o Bloco 2
 * do boletim nao guarda copia nem espelho. Por isso a gravacao vai direto na
 * proposta, e nao em `propostas_os.obs` — o bloco [Orientacoes para design]
 * daquele texto etiquetado deixou de ser alimentado em 25/08/2026, e o que ja
 * estava la fica como esta.
 */
export async function atualizarObsTecnicaProposta(
  idInt: number,
  obsTecnica: string,
  overrideClient?: SupabaseClient
): Promise<{ success: boolean; error?: string }> {
  const client = overrideClient ?? getSupabaseClient();
  if (!client) {
    return { success: false, error: "Conexao com o banco de dados nao disponivel." };
  }

  const { error } = await client
    .from("propostas")
    .update({ obs_tecnica: obsTecnica })
    .eq("id_int", idInt);

  if (error) {
    console.error("[BoletimPropostasService] Erro ao gravar obs_tecnica:", error);
    return { success: false, error: error.message || "Falha ao salvar a orientacao tecnica." };
  }

  return { success: true };
}

export async function atualizarOrientacoesBoletim(
  idPedidoOuIdInt: string | number,
  obsText: string,
  dataTermino?: string
): Promise<AtualizarBoletimResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: "Conexão com o banco de dados não disponível." };
  }

  const paramStr = String(idPedidoOuIdInt).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paramStr);

  let selectQuery = client.from("propostas_os").select("id");

  if (isUuid) {
    selectQuery = selectQuery.eq("id", paramStr);
  } else {
    const cleanNumStr = paramStr.replace("#", "");
    const idInt = Number(cleanNumStr);
    if (!isNaN(idInt)) {
      selectQuery = selectQuery.eq("id_int", idInt);
    } else {
      return { success: false, error: "Parâmetro identificador do pedido inválido." };
    }
  }

  const { data: existingOs } = await selectQuery.maybeSingle();

  if (!existingOs) {
    if (!isUuid) {
      // OS não existe, vamos criar usando a lógica existente
      const cleanNumStr = paramStr.replace("#", "");
      const idInt = Number(cleanNumStr);
      const createResult = await criarPedidoParaBoletim({ id_int: idInt, descricao: `Pedido #${idInt}`, obs: obsText });
      if (!createResult.success) {
        return { success: false, error: "Falha ao criar o pedido inexistente: " + createResult.error };
      }
      return { success: true };
    } else {
      return { success: false, error: "Pedido não encontrado para atualização." };
    }
  }

  // OS existe, vamos atualizar
  const payloadToUpdate: any = { obs: obsText };
  if (dataTermino !== undefined) {
    payloadToUpdate.data_termino = dataTermino || null;
  }
  
  const { error } = await client.from("propostas_os").update(payloadToUpdate).eq(isUuid ? "id" : "id_int", isUuid ? paramStr : Number(paramStr.replace("#", "")));

  if (error) {
    console.error("[BoletimPropostasService] Erro ao atualizar orientações do boletim:", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message
    });
    return {
      success: false,
      error: error.message || "Erro desconhecido ao salvar o boletim.",
      details: error.details || undefined,
      hint: error.hint || undefined,
      code: error.code || undefined
    };
  }

  return { success: true };
}

export async function obterGabaritosOperacionais(): Promise<string[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data } = await client.from("producao_numeracoes").select("name").order("name");
  return data ? data.map(d => d.name) : [];
}

export async function obterFreteEscolhido(idInt: number, supabaseClient?: SupabaseClient | null): Promise<any | null> {
  const client = supabaseClient ?? getSupabaseClient();
  if (!client) return null;
  const { data } = await client
    .from("cotacao_frete")
    .select("*")
    .eq("id_int", idInt)
    .eq("escolhido", true)
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function atualizarModelosBoletim(modelosUpdates: { id: number, tipo_numeracao: string | null, gabarito_operacional: string | null, numeracao_inicio: number | null }[]): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Sem conexão." };

  for (const m of modelosUpdates) {
    if (!m.id || isNaN(Number(m.id))) continue;
    const { error } = await client
      .from("pedidos_modelos")
      .update({
        tipo_numeracao: m.tipo_numeracao,
        gabarito_operacional: m.gabarito_operacional,
        numeracao_inicio: m.numeracao_inicio
      })
      .eq("id", m.id);
    if (error) {
      console.error("[BoletimPropostasService] Erro ao atualizar modelo:", error);
      return { success: false, error: error.message };
    }
  }
  return { success: true };
}

/**
 * Avança o status macro da proposta para EM PRODUCAO apenas se o status atual for REVISAO PRODUCAO.
 *
 * Devolve o `statusInterno` RESULTANTE — o novo quando avançou, o atual quando a
 * guarda não se aplicava. A escrita não mudou; o que mudou é que ela deixa de ser
 * muda: quem chama precisa disso para refletir o status na própria tela, em vez
 * de o usuário só descobrir a mudança ao voltar para a lista.
 */
export async function avancarStatusParaEmProducao(
  idInt: number
): Promise<{ success: boolean; error?: string; statusInterno?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  // Fetch current status
  const { data, error } = await client.from("propostas").select("status_interno").eq("id_int", idInt).single();
  if (error || !data) return { success: false, error: "Proposta não encontrada" };

  if (data.status_interno === "REVISAO PRODUCAO") {
    const { error: updateError } = await client
      .from("propostas")
      .update({ status_interno: "EM PRODUCAO" })
      .eq("id_int", idInt)
      .eq("status_interno", "REVISAO PRODUCAO");
      
    if (updateError) return { success: false, error: updateError.message };

    await sendPropostaChatMessage({
      id_int: idInt,
      mensagem: "Status alterado automaticamente de [REVISAO PRODUCAO] para [EM PRODUCAO] após finalização do Boletim de Entrada.",
      tipo: "SISTEMA",
      autor_nome: "Sistema",
      autor_uid: null,
      autor_email: null,
      setor: "PRODUCAO",
      visivel_externo: false,
      anexos: null,
      id_cliente: null,
      avatar: null
    });

    return { success: true, statusInterno: "EM PRODUCAO" };
  }

  // Guarda não se aplicava: nada foi escrito, e o status que vale é o que já
  // estava lá.
  return { success: true, statusInterno: data.status_interno ?? undefined };
}


/*
 * `liberarPedidoParaFiscal` foi removida em 20/08/2026.
 *
 * Ela só ligava `propostas.libera_nf = true` para a ação "Liberar para NF" do
 * painel geral da Produção. Com a entrada na Fila de Faturamento acontecendo
 * junto da liberação para produção (`liberarPropostaParaProducao`, no módulo de
 * orçamentos), a ação deixou de existir e esta função ficou sem chamador.
 *
 * Não foi mantida "por via das dúvidas" de propósito: era o único outro caminho
 * de escrita em `libera_nf`, e um atalho para a fila que pula as guardas de
 * pagamento e arte não deve continuar disponível.
 */
