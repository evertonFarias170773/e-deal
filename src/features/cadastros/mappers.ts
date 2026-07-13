import type {
  Cadastro,
  CadastroContato,
  CadastroEndereco,
  CadastroVinculoComercial
} from "@/features/cadastros/types";
import type {
  SupabaseClienteRow,
  SupabaseClienteSocioRow,
  SupabaseContatoRow,
  SupabaseEnderecoRow
} from "@/features/cadastros/types.supabase";

const categoriaPermitida = new Set<Cadastro["categoria"]>([
  "CLIENTE",
  "TRANSPORTADORA",
  "FORNECEDOR",
  "ORGAO_PUBLICO"
]);

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

function toInteger(value: unknown, fallback = 0) {
  const parsed = toNumber(value, fallback);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return ["true", "1", "sim", "s", "yes", "y"].includes(value.trim().toLowerCase());
  }

  return fallback;
}

function normalizeCategoria(value: unknown): Cadastro["categoria"] {
  const normalized = toText(value).toUpperCase();
  if (categoriaPermitida.has(normalized as Cadastro["categoria"])) {
    return normalized as Cadastro["categoria"];
  }

  return "CLIENTE";
}

function normalizeRisco(value: unknown): Cadastro["riscoCredito"] {
  const normalized = toText(value).toUpperCase();
  if (normalized === "ALTO" || normalized === "MEDIO" || normalized === "BAIXO") {
    return normalized;
  }

  return "MEDIO";
}

function normalizeTipoPessoa(documento: string, explicitValue?: unknown): Cadastro["tipoPessoa"] {
  const normalized = toText(explicitValue).toUpperCase();
  if (normalized === "FISICA" || normalized === "JURIDICA") {
    return normalized;
  }

  const onlyDigits = documento.replace(/\D/g, "");
  return onlyDigits.length === 11 ? "FISICA" : "JURIDICA";
}

function formatDocumentFromRow(value: unknown) {
  return toText(value).replace(/\D/g, "");
}

function resolveCidadeUf(row: SupabaseClienteRow) {
  return toText(row.cidade_uf) || "Não informado";
}

function resolveWhatsapp(row: SupabaseClienteRow) {
  return (
    toText(row.whatsapp_1) ||
    toText(row.whatsapp_2) ||
    toText(row.contato) ||
    toText(row.telefone_fixo)
  );
}

function resolveEmail(row: SupabaseClienteRow) {
  return toText(row.email_contato) || toText(row.email_financeiro) || toText(row.email);
}

function resolveObservacoes(row: SupabaseClienteRow) {
  return toText(row.obs);
}

export function mapSupabaseClienteRowToCadastro(row: SupabaseClienteRow): Cadastro {
  const documento = formatDocumentFromRow(row.documento);
  const idCliente = toInteger(row.id_cliente, 0);

  return {
    id: `cad_${idCliente || row.id}`,
    idCliente,
    idVendedor: toText(row.id_vendedor) || null,
    nome: toText(row.nome),
    fantasia: toText(row.fantasia) || toText(row.apelido) || undefined,
    apelido: toText(row.apelido) || undefined,
    contato: toText(row.contato) || undefined,
    categoria: normalizeCategoria(row.categoria),
    documento,
    tipoPessoa: normalizeTipoPessoa(documento, row.tipo_pessoa),
    cidadeUf: resolveCidadeUf(row),
    vendedor: toText(row.nome_vendedor) || "Não informado",
    vendedor_padrao: toText(row.nome_vendedor) || undefined,
    ativo: toBoolean(row.ativo, true),
    restricao: toBoolean(row.restricao, false),
    verificado: toBoolean(row.verificado, false),
    riscoCredito: normalizeRisco(row.risco_credito),
    limiteCredito: toNumber(row.limite_credito, 0),
    creditoDisponivel: toNumber(row.credito, 0),
    padraoPagamento: toText(row.padrao_pagamento) || "Não informado",
    ultimaCompra: toText(row.ultima_compra) || new Date().toISOString().slice(0, 10),
    totalCompras: toNumber(row.total_compras, 0),
    whatsapp: resolveWhatsapp(row),
    whatsapp2: toText(row.whatsapp_2) || undefined,
    telefoneFixo: toText(row.telefone_fixo) || undefined,
    email: resolveEmail(row),
    emailFinanceiro: toText(row.email_financeiro) || undefined,
    site: undefined,
    empresaPadrao: toText(row.empresa_padrao) || "Não informado",
    observacoes: resolveObservacoes(row),
    dataCadastro: toText(row.data_cadastro) || undefined,
    tipoContribuinte: toText(row.tipo_contribuinte) || undefined,
    inscricaoEstadual: toText(row.ins_estadual) || undefined,
    inscricaoMunicipal: toText(row.ins_municipal) || undefined,
    isentoInscricaoEstadual: false,
    dataFundacao: toText(row.data_fundacao) || undefined,
    is_bonus: toBoolean(row.is_bonus, false),
    usaPrecoFixo: toBoolean(row.usa_preco_fixo, false),
    bonusAtivo: toBoolean(row.is_bonus, false),
    percentualBonus: toNumber(row.percentual_bunus, 0),
    dataVerificacao: toText(row.data_verificacao) || undefined,
    motivoErro: toText(row.motivo_erro) || undefined,
    cpfInvalido: toBoolean(row.cpf_invalido, false),
    cpfErro: toText(row.cpf_erro) || undefined,
    nota: toBoolean(row.nota, false),
    sendMail: toBoolean(row.recebe_email, false),
    sendWhats: toBoolean(row.recebe_whatsapp, false),
    modeloCobrancaId: toText(row.id_modelo_cobranca) || undefined,
    enderecos: [],
    contatos: [],
    vinculosComerciais: []
  };
}

export function mapSupabaseEnderecoRowToCadastroEndereco(row: SupabaseEnderecoRow): CadastroEndereco {
  const tipo = toText(row.tipo_endereco).toLowerCase();

  return {
    id: row.id,
    tipo: (tipo as CadastroEndereco["tipo"]) || "principal",
    cep: toText(row.cep),
    endereco: toText(row.endereco),
    numero: toText(row.numero),
    complemento: toText(row.complemento) || undefined,
    bairro: toText(row.bairro),
    cidade: toText(row.cidade),
    uf: toText(row.uf),
    obs: toText(row.obs) || undefined,
    recebedor: toText(row.recebedor) || undefined,
    cpfRecebedor: toText(row.cpf_recebedor) || undefined
  };
}

export function mapSupabaseContatoRowToCadastroContato(row: SupabaseContatoRow): CadastroContato {
  return {
    id: row.id,
    nome: toText(row.nome_contato) || toText(row.nome),
    cargo: toText(row.cargo),
    whatsapp: toText(row.whats),
    email: toText(row.e_mail)
  };
}

export function mapSupabaseSocioRowToCadastroVinculo(row: SupabaseClienteSocioRow): CadastroVinculoComercial {
  return mapSupabaseSocioRowToCadastroVinculoWithRelated(row, null);
}

export function mapSupabaseSocioRowToCadastroVinculoWithRelated(
  row: SupabaseClienteSocioRow,
  relatedCadastro: Pick<Cadastro, "nome" | "documento"> | null
): CadastroVinculoComercial {
  return {
    id: row.id,
    idClienteRelacionado: toInteger(row.id_cliente_socio, 0),
    nome: relatedCadastro?.nome || "Cadastro vinculado",
    documento: relatedCadastro?.documento || "",
    tipoRelacao: toText(row.tipo_relacao) || "Sociedade"
  };
}

export function mergeSupabaseRelacionamentos(
  cadastro: Cadastro,
  relacionamentos: {
    enderecos?: SupabaseEnderecoRow[];
    contatos?: SupabaseContatoRow[];
    socios?: Array<{
      row: SupabaseClienteSocioRow;
      relatedCadastro?: Pick<Cadastro, "nome" | "documento"> | null;
    }>;
  }
) {
  return {
    ...cadastro,
    enderecos: (relacionamentos.enderecos ?? []).map(mapSupabaseEnderecoRowToCadastroEndereco),
    contatos: (relacionamentos.contatos ?? []).map(mapSupabaseContatoRowToCadastroContato),
    vinculosComerciais: (relacionamentos.socios ?? []).map(({ row, relatedCadastro }) =>
      mapSupabaseSocioRowToCadastroVinculoWithRelated(row, relatedCadastro ?? null)
    )
  };
}
