import { NextResponse } from "next/server";
import { validateCadastroInitialStep } from "@/features/cadastros/services/cadastros.service";
import { normalizeDocumentDigits, validateDocumentByTipo, type DocumentoTipo } from "@/features/cadastros/utils/documento";

type ConsultaDocumentoRequestBody = {
  tipoPessoa?: string;
  documento?: string;
  idCliente?: number | string;
};

type DocumentoConsultaPayload = {
  nome: string;
  fantasia: string;
  documento: string;
  tipoPessoa: "FISICA" | "JURIDICA";
  dataFundacao: string;
  emailContato: string;
  telefoneFixo: string;
  cidadeUf: string;
  insEstadual: string;
  tipoContribuinte: "CONTRIBUINTE" | "ISENTO" | "";
  enderecoPreparado: {
    id_cliente: number;
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    tipo_endereco: "PRINCIPAL";
    obs: string;
  } | null;
};

type CnpjApiResponse = {
  razao_social?: string;
  estabelecimento?: {
    cnpj?: string;
    nome_fantasia?: string;
    data_inicio_atividade?: string;
    email?: string;
    ddd1?: string;
    telefone1?: string;
    cep?: string;
    tipo_logradouro?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: { nome?: string };
    estado?: { sigla?: string };
    inscricoes_estaduais?: Array<{
      ativo?: boolean;
      situacao?: string;
      inscricao_estadual?: string;
    }>;
  };
};

type CnpjInscricaoEstadual = {
  ativo?: boolean;
  situacao?: string;
  inscricao_estadual?: string;
};

type CpfApiResponse = {
  data?: {
    cpf?: string;
    nameUpper?: string;
    name?: string;
    birthDate?: string;
  };
};

function parseTipoPessoa(value: string | undefined): DocumentoTipo | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "CPF" || normalized === "FISICA") {
    return "CPF";
  }

  if (normalized === "CNPJ" || normalized === "JURIDICA") {
    return "CNPJ";
  }

  return null;
}

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeIsoDate(value: string) {
  const text = toText(value);
  if (!text) {
    return "";
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`;
  }

  return "";
}

function mountLogradouro(tipoLogradouro: string, logradouro: string) {
  const parts = [toText(tipoLogradouro), toText(logradouro)].filter(Boolean);
  return parts.join(" ");
}

function findInscricaoEstadualAtiva(inscricoes: CnpjInscricaoEstadual[] | undefined) {
  if (!Array.isArray(inscricoes)) {
    return "";
  }

  const found = inscricoes.find((item) => {
    if (item?.ativo === true) {
      return true;
    }

    return toText(item?.situacao).toLowerCase() === "ativa";
  });

  return toText(found?.inscricao_estadual);
}

async function fetchJsonWithTimeout<T>(url: string, headers?: HeadersInit): Promise<{ ok: true; data: T } | { ok: false; status?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function consultarCnpj(documentoDigits: string, idCliente: number): Promise<DocumentoConsultaPayload | null> {
  const result = await fetchJsonWithTimeout<CnpjApiResponse>(`https://publica.cnpj.ws/cnpj/${documentoDigits}`);
  if (!result.ok) {
    return null;
  }

  const estabelecimento = result.data.estabelecimento ?? {};
  const cidade = toText(estabelecimento.cidade?.nome);
  const uf = toText(estabelecimento.estado?.sigla).toUpperCase();
  const cidadeUf = cidade && uf ? `${cidade} - ${uf}` : "";
  const telefoneFixo = `${toText(estabelecimento.ddd1)}${toText(estabelecimento.telefone1)}`;
  const insEstadual = findInscricaoEstadualAtiva(estabelecimento.inscricoes_estaduais);
  const tipoContribuinte = insEstadual ? "CONTRIBUINTE" : "ISENTO";
  const razaoSocial = toText(result.data.razao_social);
  const nomeFantasia = toText(estabelecimento.nome_fantasia) || razaoSocial;

  return {
    nome: razaoSocial,
    fantasia: nomeFantasia,
    documento: normalizeDocumentDigits(toText(estabelecimento.cnpj)) || documentoDigits,
    tipoPessoa: "JURIDICA",
    dataFundacao: normalizeIsoDate(toText(estabelecimento.data_inicio_atividade)),
    emailContato: toText(estabelecimento.email),
    telefoneFixo,
    cidadeUf,
    insEstadual,
    tipoContribuinte,
    enderecoPreparado: {
      id_cliente: idCliente,
      cep: normalizeDocumentDigits(toText(estabelecimento.cep)),
      endereco: mountLogradouro(toText(estabelecimento.tipo_logradouro), toText(estabelecimento.logradouro)),
      numero: toText(estabelecimento.numero),
      complemento: toText(estabelecimento.complemento),
      bairro: toText(estabelecimento.bairro),
      cidade,
      uf,
      tipo_endereco: "PRINCIPAL",
      obs: "Endereço importado da consulta CNPJ"
    }
  };
}

async function consultarCpf(documentoDigits: string): Promise<DocumentoConsultaPayload | null> {
  const token = process.env.CPFHUB_API_TOKEN ?? process.env.CPFHUB_TOKEN ?? process.env.CPFHUB_API_KEY;
  const headers: HeadersInit = {};

  if (token) {
    headers["x-api-key"] = token;
  }

  const result = await fetchJsonWithTimeout<CpfApiResponse>(`https://api.cpfhub.io/cpf/${documentoDigits}`, headers);
  if (!result.ok) {
    return null;
  }

  const data = result.data.data ?? {};
  const nome = toText(data.nameUpper) || toText(data.name);

  return {
    nome,
    fantasia: "",
    documento: normalizeDocumentDigits(toText(data.cpf)) || documentoDigits,
    tipoPessoa: "FISICA",
    dataFundacao: normalizeIsoDate(toText(data.birthDate)),
    emailContato: "",
    telefoneFixo: "",
    cidadeUf: "",
    insEstadual: "",
    tipoContribuinte: "",
    enderecoPreparado: null
  };
}

export async function POST(request: Request) {
  let body: ConsultaDocumentoRequestBody;

  try {
    body = (await request.json()) as ConsultaDocumentoRequestBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Corpo da requisição inválido."
      },
      { status: 400 }
    );
  }

  const tipoPessoa = parseTipoPessoa(body.tipoPessoa);
  const documento = normalizeDocumentDigits(toText(body.documento));
  const idCliente = Number(body.idCliente);

  if (!tipoPessoa || !documento) {
    return NextResponse.json(
      {
        success: false,
        message: "Informe tipoPessoa e documento para consultar."
      },
      { status: 400 }
    );
  }

  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return NextResponse.json(
      {
        success: false,
        message: "ID do cliente inválido para consulta."
      },
      { status: 400 }
    );
  }

  const localValidation = validateDocumentByTipo(documento, tipoPessoa);
  if (!localValidation.isValid) {
    return NextResponse.json(
      {
        success: false,
        message: localValidation.message
      },
      { status: 400 }
    );
  }

  const validationResult = await validateCadastroInitialStep({
    idCliente,
    documentoDigits: localValidation.digits
  });

  if (validationResult.idConflict || validationResult.documentoConflict) {
    return NextResponse.json(
      {
        success: false,
        duplicated: true,
        idConflict: validationResult.idConflict,
        documentoConflict: validationResult.documentoConflict,
        message: "Documento ou ID já cadastrado. A consulta externa foi cancelada."
      },
      { status: 409 }
    );
  }

  if (!validationResult.success) {
    return NextResponse.json(
      {
        success: false,
        message: validationResult.errorMessage || "Falha ao validar dados antes da consulta externa."
      },
      { status: 500 }
    );
  }

  const payload =
    tipoPessoa === "CNPJ"
      ? await consultarCnpj(localValidation.digits, idCliente)
      : await consultarCpf(localValidation.digits);

  if (!payload) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Não foi possível consultar os dados externos agora. Você pode continuar e preencher os dados manualmente."
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    payload
  });
}
