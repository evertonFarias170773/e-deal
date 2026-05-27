import { cadastrosMock } from "@/lib/mocks/cadastros.mock";
import { propostasMock } from "@/lib/mocks/propostas.mock";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Cadastro } from "@/features/cadastros/types";
import type { SupabaseClienteRow } from "@/features/cadastros/types.supabase";
import { mapSupabaseClienteRowToCadastro } from "@/features/cadastros/mappers";

const PAGE_SIZE_MAX = 200;

type SupabasePropostaPageRow = {
  id_cliente?: unknown;
  created_at?: unknown;
  status_interno?: unknown;
  is_copia?: unknown;
};

type SupabasePropostaResumoRow = {
  id_cliente?: unknown;
  valor_total_sum?: unknown;
  valor_sum?: unknown;
  pedidos?: unknown;
};

export type CadastrosReadSource = "supabase" | "mock";

export type CadastrosPedidosResumo = {
  ultimaCompra: string | null;
  quantidadePedidos: number;
};

export type CadastrosListQuery = {
  pageIndex: number;
  pageSize?: number;
  search?: string;
};

export type CadastrosReadResult = {
  source: CadastrosReadSource;
  cadastros: Cadastro[];
  totalCount: number;
  hasNextPage: boolean;
  pageIndex: number;
  pageSize: number;
  loadedCount: number;
  warnings: string[];
  pedidosResumoByCliente: Record<number, CadastrosPedidosResumo>;
};

export type CadastrosDashboardClienteResumo = {
  idCliente: number;
  nome: string;
  fantasia?: string;
  cidadeUf: string;
  valorTotal: number;
  quantidadePedidos: number;
};

export type CadastrosDashboardCidadeResumo = {
  cidadeUf: string;
  valorTotal: number;
  quantidadePedidos: number;
  quantidadeClientes: number;
};

export type CadastrosDashboardResumo = {
  source: CadastrosReadSource;
  activeCount: number;
  topClientes: CadastrosDashboardClienteResumo[];
  topCidades: CadastrosDashboardCidadeResumo[];
  aniversariantesMock: string[];
  warnings: string[];
};

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const normalized = Number(String(value).replace(",", "."));
  return Number.isFinite(normalized) ? normalized : fallback;
}

function normalizeIdCliente(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeSearchTerm(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[%*,]/g, "");
}

function sortCadastrosByIdClienteDesc(cadastros: Cadastro[]) {
  return [...cadastros].sort((a, b) => b.idCliente - a.idCliente);
}

function buildCadastrosSearchClause(search: string) {
  const normalized = normalizeSearchTerm(search);
  if (!normalized) {
    return "";
  }

  const digits = normalized.replace(/\D/g, "");
  const clauses = [
    `nome.ilike.*${normalized}*`,
    `fantasia.ilike.*${normalized}*`,
    `apelido.ilike.*${normalized}*`,
    `email.ilike.*${normalized}*`,
    `email_contato.ilike.*${normalized}*`,
    `whatsapp_1.ilike.*${normalized}*`,
    `whatsapp_2.ilike.*${normalized}*`,
    `telefone_fixo.ilike.*${normalized}*`
  ];

  if (digits) {
    clauses.unshift(`id_cliente.eq.${digits}`);
    clauses.push(`documento.ilike.*${digits}*`);
  } else {
    clauses.push(`documento.ilike.*${normalized}*`);
  }

  return clauses.join(",");
}

function cloneMockCadastros() {
  return cadastrosMock.map((cadastro) => ({
    ...cadastro,
    enderecos: [...cadastro.enderecos],
    contatos: [...cadastro.contatos],
    vinculosComerciais: [...cadastro.vinculosComerciais]
  }));
}

function buildMockPedidosResumoByCliente(cadastros: Cadastro[]) {
  const resumoByCliente: Record<number, CadastrosPedidosResumo> = {};
  const approvedByCliente = new Map<number, string[]>();

  for (const proposta of propostasMock) {
    if (proposta.status !== "APROVADO") {
      continue;
    }

    const idCliente = proposta.cliente.idCliente;
    const existing = approvedByCliente.get(idCliente) ?? [];
    existing.push(proposta.data);
    approvedByCliente.set(idCliente, existing);
  }

  for (const cadastro of cadastros) {
    const datas = approvedByCliente.get(cadastro.idCliente) ?? [];
    const ultimaCompra = datas.reduce<string | null>((current, value) => {
      if (!current || value > current) {
        return value;
      }

      return current;
    }, null);

    resumoByCliente[cadastro.idCliente] = {
      ultimaCompra,
      quantidadePedidos: datas.length
    };
  }

  return resumoByCliente;
}

function buildMockDashboardResumo(): CadastrosDashboardResumo {
  const baseCadastros = cloneMockCadastros().filter(
    (cadastro) => cadastro.categoria === "CLIENTE" && cadastro.ativo
  );
  const baseCadastrosById = new Map(baseCadastros.map((cadastro) => [cadastro.idCliente, cadastro] as const));

  const activeCount = baseCadastros.length;

  const approvedResumo = new Map<
    number,
    { idCliente: number; nome: string; fantasia?: string; cidadeUf: string; valorTotal: number; quantidadePedidos: number }
  >();

  for (const proposta of propostasMock) {
    if (proposta.status !== "APROVADO") {
      continue;
    }

    const idCliente = proposta.cliente.idCliente;
    const cadastroBase = baseCadastrosById.get(idCliente);
    if (!cadastroBase) {
      continue;
    }

    const valorTotal = proposta.resumo.valorTotal;
    const current =
      approvedResumo.get(idCliente) ??
      {
        idCliente,
        nome: cadastroBase.nome,
        fantasia: cadastroBase.fantasia || undefined,
        cidadeUf: cadastroBase.cidadeUf,
        valorTotal: 0,
        quantidadePedidos: 0
      };

    current.valorTotal += valorTotal;
    current.quantidadePedidos += 1;
    approvedResumo.set(idCliente, current);
  }

  const topClientes = [...approvedResumo.values()]
    .sort((a, b) => b.valorTotal - a.valorTotal || b.quantidadePedidos - a.quantidadePedidos || a.nome.localeCompare(b.nome))
    .slice(0, 3);

  const cidadeResumo = new Map<string, CadastrosDashboardCidadeResumo>();
  for (const cliente of approvedResumo.values()) {
    const cidadeUf = cliente.cidadeUf || "Não informado";
    const current = cidadeResumo.get(cidadeUf) ?? {
      cidadeUf,
      valorTotal: 0,
      quantidadePedidos: 0,
      quantidadeClientes: 0
    };

    current.valorTotal += cliente.valorTotal;
    current.quantidadePedidos += cliente.quantidadePedidos;
    current.quantidadeClientes += 1;
    cidadeResumo.set(cidadeUf, current);
  }

  const topCidades = [...cidadeResumo.values()]
    .sort((a, b) => b.valorTotal - a.valorTotal || b.quantidadePedidos - a.quantidadePedidos || b.quantidadeClientes - a.quantidadeClientes)
    .slice(0, 3);

  return {
    source: "mock",
    activeCount,
    topClientes,
    topCidades,
    aniversariantesMock: baseCadastros.slice(0, 3).map((cadastro) => cadastro.nome),
    warnings: ["Fallback mock ativado para os resumos de cadastros."]
  };
}

function buildMockListResult(query: Required<Pick<CadastrosListQuery, "pageIndex">> & CadastrosListQuery): CadastrosReadResult {
  const pageSize = Math.min(Math.max(query.pageSize ?? PAGE_SIZE_MAX, 1), PAGE_SIZE_MAX);
  const search = normalizeSearchTerm(query.search ?? "");
  const digits = search.replace(/\D/g, "");

  const filtered = sortCadastrosByIdClienteDesc(
    cloneMockCadastros().filter((cadastro) => {
      const baseMatch = cadastro.categoria === "CLIENTE" && cadastro.ativo;
      if (!baseMatch) {
        return false;
      }

      if (!search) {
        return true;
      }

      const searchable = [
        cadastro.idCliente.toString(),
        cadastro.nome,
        cadastro.fantasia ?? "",
        cadastro.documento,
        cadastro.documento.replace(/\D/g, ""),
        cadastro.whatsapp,
        cadastro.whatsapp2 ?? "",
        cadastro.telefoneFixo ?? "",
        cadastro.email,
        cadastro.emailFinanceiro ?? "",
        cadastro.cidadeUf,
        cadastro.vendedor
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(search.toLowerCase()) || (digits ? cadastro.idCliente.toString() === digits : false);
    })
  );

  const from = query.pageIndex * pageSize;
  const to = from + pageSize;
  const pageItems = filtered.slice(from, to);

  return {
    source: "mock",
    cadastros: pageItems,
    totalCount: filtered.length,
    hasNextPage: to < filtered.length,
    pageIndex: query.pageIndex,
    pageSize,
    loadedCount: pageItems.length,
    warnings: ["Fallback mock ativado para a listagem de cadastros."],
    pedidosResumoByCliente: buildMockPedidosResumoByCliente(pageItems)
  };
}

function resolveAggregateNumber(value: unknown, fallback = 0) {
  const parsed = toNumber(value, Number.NaN);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return fallback;
}

async function fetchPedidosResumoByCliente(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>,
  clienteIds: number[]
) {
  if (!clienteIds.length) {
    return {};
  }

  const { data, error } = await client
    .from("propostas")
    .select("id_cliente, created_at, status_interno, is_copia")
    .eq("status_interno", "APROVADO")
    .eq("is_copia", false)
    .in("id_cliente", clienteIds)
    .returns<SupabasePropostaPageRow[]>();

  if (error) {
    throw error;
  }

  const resumoByCliente: Record<number, CadastrosPedidosResumo> = {};
  for (const row of data ?? []) {
    const idCliente = normalizeIdCliente(row.id_cliente);
    if (!idCliente) {
      continue;
    }

    const createdAt = toText(row.created_at);
    const current = resumoByCliente[idCliente] ?? {
      ultimaCompra: null,
      quantidadePedidos: 0
    };

    current.quantidadePedidos += 1;
    if (createdAt && (!current.ultimaCompra || createdAt > current.ultimaCompra)) {
      current.ultimaCompra = createdAt;
    }

    resumoByCliente[idCliente] = current;
  }

  return resumoByCliente;
}

async function fetchDashboardResumoSupabase(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>
): Promise<CadastrosDashboardResumo> {
  const [activeCountResult, proposalsResult] = await Promise.all([
    client
      .from("clientes")
      .select("id_cliente", { count: "exact", head: true })
      .eq("categoria", "CLIENTE")
      .eq("ativo", true),
    client
      .from("propostas")
      .select("id_cliente, valor_total_sum:valor_total.sum(), valor_sum:valor.sum(), pedidos:id_int.count()")
      .eq("status_interno", "APROVADO")
      .eq("is_copia", false)
      .not("id_cliente", "is", null)
      .returns<SupabasePropostaResumoRow[]>()
  ]);

  if (activeCountResult.error) {
    throw activeCountResult.error;
  }

  if (proposalsResult.error) {
    throw proposalsResult.error;
  }

  const activeCount = activeCountResult.count ?? 0;
  const proposalRows = proposalsResult.data ?? [];
  const proposalClientIds = [...new Set(
    proposalRows
      .map((row) => normalizeIdCliente(row.id_cliente))
      .filter((value): value is number => value !== null)
  )];

  const clientRowsResult = proposalClientIds.length
    ? await client
        .from("clientes")
        .select("id,id_cliente,nome,fantasia,cidade_uf,categoria,ativo")
        .eq("categoria", "CLIENTE")
        .eq("ativo", true)
        .in("id_cliente", proposalClientIds)
        .returns<SupabaseClienteRow[]>()
    : { data: [], error: null };

  if (clientRowsResult.error) {
    throw clientRowsResult.error;
  }

  const clientById = new Map<
    number,
    {
      nome: string;
      fantasia?: string;
      cidadeUf: string;
    }
  >();

  for (const row of clientRowsResult.data ?? []) {
    const idCliente = normalizeIdCliente(row.id_cliente);
    if (!idCliente) {
      continue;
    }

    clientById.set(idCliente, {
      nome: toText(row.nome) || `Cliente ${idCliente}`,
      fantasia: toText(row.fantasia) || undefined,
      cidadeUf: toText(row.cidade_uf) || "Não informado"
    });
  }

  type TopClienteResumo = {
    idCliente: number;
    nome: string;
    fantasia: string | undefined;
    cidadeUf: string;
    valorTotal: number;
    quantidadePedidos: number;
  };

  const topClientes = proposalRows
    .map((row) => {
      const idCliente = normalizeIdCliente(row.id_cliente);
      if (!idCliente) {
        return null;
      }

      const cliente = clientById.get(idCliente);
      if (!cliente) {
        return null;
      }

      const valorTotal = resolveAggregateNumber(row.valor_total_sum, resolveAggregateNumber(row.valor_sum, 0));
      const quantidadePedidos = resolveAggregateNumber(row.pedidos, 0);

      return {
        idCliente,
        nome: cliente.nome,
        fantasia: cliente.fantasia,
        cidadeUf: cliente.cidadeUf,
        valorTotal,
        quantidadePedidos
      };
    })
    .filter((item): item is TopClienteResumo => item !== null)
    .sort((a, b) => b.valorTotal - a.valorTotal || b.quantidadePedidos - a.quantidadePedidos || a.nome.localeCompare(b.nome))
    .slice(0, 3);

  const cidadeResumo = new Map<string, CadastrosDashboardCidadeResumo>();
  for (const row of proposalRows) {
    const idCliente = normalizeIdCliente(row.id_cliente);
    if (!idCliente) {
      continue;
    }

    const clienteBase = clientById.get(idCliente);
    if (!clienteBase) {
      continue;
    }

    const cidadeUf = clienteBase.cidadeUf || "Não informado";
    const valorTotal = resolveAggregateNumber(row.valor_total_sum, resolveAggregateNumber(row.valor_sum, 0));
    const quantidadePedidos = resolveAggregateNumber(row.pedidos, 0);
    const current = cidadeResumo.get(cidadeUf) ?? {
      cidadeUf,
      valorTotal: 0,
      quantidadePedidos: 0,
      quantidadeClientes: 0
    };

    current.valorTotal += valorTotal;
    current.quantidadePedidos += quantidadePedidos;
    current.quantidadeClientes += 1;
    cidadeResumo.set(cidadeUf, current);
  }

  const topCidades = [...cidadeResumo.values()]
    .sort((a, b) => b.valorTotal - a.valorTotal || b.quantidadePedidos - a.quantidadePedidos || b.quantidadeClientes - a.quantidadeClientes)
    .slice(0, 3);

  return {
    source: "supabase",
    activeCount,
    topClientes,
    topCidades,
    aniversariantesMock: cloneMockCadastros()
      .filter((cadastro) => cadastro.categoria === "CLIENTE" && cadastro.ativo)
      .slice(0, 3)
      .map((cadastro) => cadastro.nome),
    warnings: [
      `Leitura real aplicada em public.clientes e public.propostas para os resumos globais.`
    ]
  };
}

export async function getCadastrosReadOnlyList(query: CadastrosListQuery): Promise<CadastrosReadResult> {
  const pageSize = Math.min(Math.max(query.pageSize ?? PAGE_SIZE_MAX, 1), PAGE_SIZE_MAX);
  const pageIndex = Math.max(query.pageIndex, 0);
  const from = pageIndex * pageSize;
  const to = from + pageSize - 1;
  const client = getSupabaseClient();

  if (!client) {
    return buildMockListResult({ ...query, pageIndex, pageSize });
  }

  const searchClause = buildCadastrosSearchClause(query.search ?? "");

  try {
    let request = client
      .from("clientes")
      .select("id,id_cliente,nome,apelido,documento,email_contato,telefone_fixo,whatsapp_1,whatsapp_2,ativo,restricao,limite_credito,fantasia,email,nome_vendedor,categoria,risco_credito,cidade_uf,credito", {
        count: "exact"
      })
      .eq("categoria", "CLIENTE")
      .eq("ativo", true)
      .order("id_cliente", { ascending: false });

    if (searchClause) {
      request = request.or(searchClause);
    }

    request = request.range(from, to);

    const { data, error, count } = await request.returns<SupabaseClienteRow[]>();
    if (error) {
      throw error;
    }

    const cadastros = sortCadastrosByIdClienteDesc((data ?? []).map(mapSupabaseClienteRowToCadastro));
    const pedidosResumoByCliente = await fetchPedidosResumoByCliente(
      client,
      cadastros.map((cadastro) => cadastro.idCliente)
    );
    const totalCount = typeof count === "number" ? count : cadastros.length;

    return {
      source: "supabase",
      cadastros,
      totalCount,
      hasNextPage: from + cadastros.length < totalCount,
      pageIndex,
      pageSize,
      loadedCount: cadastros.length,
      warnings: ["Leitura real aplicada em public.clientes com paginação server-side de 200 registros."],
      pedidosResumoByCliente
    };
  } catch (error) {
    console.log("[Cadastros][List] erro na leitura real - fallback mock ativado.", { error });
    return buildMockListResult({ ...query, pageIndex, pageSize });
  }
}

export async function getCadastrosDashboardResumo(): Promise<CadastrosDashboardResumo> {
  const client = getSupabaseClient();
  if (!client) {
    return buildMockDashboardResumo();
  }

  try {
    return await fetchDashboardResumoSupabase(client);
  } catch (error) {
    console.log("[Cadastros][Resumo] erro na leitura real - fallback mock ativado.", { error });
    return buildMockDashboardResumo();
  }
}
