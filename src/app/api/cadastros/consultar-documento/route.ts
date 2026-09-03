import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { validateCadastroInitialStep } from "@/features/cadastros/services/cadastros.service";
import { normalizeDocumentDigits, validateDocumentByTipo, type DocumentoTipo } from "@/features/cadastros/utils/documento";
import type { CodigoTipoContribuinte } from "@/lib/fiscal/tipo-contribuinte";

type ConsultaDocumentoRequestBody = {
  tipoPessoa?: string;
  documento?: string;
  idCliente?: number | string;
  /**
   * `"reconsulta"` = o cadastro JA EXISTE e esta sendo reconsultado. Ausente ou
   * qualquer outro valor = fluxo de CRIACAO, com o comportamento de sempre.
   */
  modo?: string;
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
  tipoContribuinte: CodigoTipoContribuinte | "";
  enderecoPreparado: {
    // `null` no cadastro automatico: o numero ainda nao existe quando a consulta
    // roda. Ninguem le este campo — quem grava o endereco usa o id devolvido pelo
    // insert do cadastro (result.cadastro.idCliente), nao este.
    id_cliente: number | null;
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

async function consultarCnpj(documentoDigits: string, idCliente: number | null): Promise<DocumentoConsultaPayload | null> {
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
  // Codigo da SEFAZ desde 25/08/2026, o mesmo vocabulario da NF. Com inscricao
  // estadual ativa na Receita o CNPJ e contribuinte de ICMS (1); sem ela a
  // consulta nao tem como distinguir isento (2) de nao contribuinte (9), e o
  // padrao seguro e o 9 — declarar contribuinte quem nao e custa rejeicao.
  const tipoContribuinte: CodigoTipoContribuinte = insEstadual ? "1" : "9";
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
  // Autenticação JWT — o MESMO bloco de gerar-boleto, gerar-pix e gerar-cartao-asas.
  //
  // Esta rota consome credencial ou cota da empresa (OpenAI, cnpj.ws, CPFHub) e
  // respondia sem sessão nenhuma: qualquer pessoa com a URL queimava dinheiro e
  // cota do fornecedor. Só sessão, sem permissão nova — mesmo nível das rotas de
  // cobrança. A checagem vem ANTES de qualquer chamada externa.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[API][ConsultarDocumento] ENV AUSENTE");
    return NextResponse.json(
      { success: false, message: "Erro interno no servidor de banco de dados." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const tokenSessao = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!tokenSessao) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  const supabaseSessao = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${tokenSessao}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabaseSessao.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

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
  // Cadastro automatico chega SEM idCliente (ausente ou null). A consulta a
  // Receita e a checagem de documento nao dependem do numero — so a checagem de
  // duplicidade por ID depende, e essa e pulada quando nao ha ID.
  //
  // `Number(undefined)` e NaN e `Number(null)` e 0: por isso a ausencia e
  // detectada por identidade, antes de qualquer conversao.
  const idClienteAusente =
    body.idCliente === undefined || body.idCliente === null || body.idCliente === "";
  const idCliente = idClienteAusente ? null : Number(body.idCliente);

  if (!tipoPessoa || !documento) {
    return NextResponse.json(
      {
        success: false,
        message: "Informe tipoPessoa e documento para consultar."
      },
      { status: 400 }
    );
  }

  // Com ID informado o 400 continua exatamente como era.
  if (idCliente !== null && (!Number.isInteger(idCliente) || idCliente <= 0)) {
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

  // `supabaseSessao` (o client autenticado montado acima) vai JUNTO: sem ele a
  // checagem de duplicidade consultava `clientes` como `anon`, tomava 401 desde
  // 93e0a9b e o nulo era lido como "sem conflito".
  const validationResult = await validateCadastroInitialStep(
    {
      idCliente,
      documentoDigits: localValidation.digits
    },
    supabaseSessao
  );

  /**
   * A TRAVA DE DUPLICIDADE E DO FLUXO DE CRIACAO, NAO DA CONSULTA (26/08/2026).
   *
   * `validateCadastroInitialStep` recusa qualquer id ou documento que ja exista
   * — o que e exatamente certo ao CRIAR e exatamente errado ao RECONSULTAR: um
   * cadastro existente sempre bate consigo mesmo. Era por isso que o botao
   * "Reconsultar" da tela de edicao devolvia HTTP 409 em 100% dos casos e nunca
   * chegou a atualizar nada.
   *
   * No modo reconsulta o conflito CONSIGO MESMO deixa de barrar. Qualquer outro
   * continua barrando, inclusive:
   *   - o CNPJ consultado pertencer a OUTRO cadastro (colisao real);
   *   - o id existir com um documento diferente do que veio na requisicao.
   *
   * A consulta em si — a chamada a Receita e o mapeamento dos campos — nao muda
   * uma linha. Sem `modo: "reconsulta"` o comportamento e byte a byte o de
   * antes, e o fluxo de criacao passa por aqui sem enxergar diferenca.
   */
  const ehReconsulta = toText(body.modo).trim().toLowerCase() === "reconsulta";
  // Capturados antes de qualquer `if`: o tipo do resultado e uma uniao
  // discriminada, e estreitar por um dos campos torna os outros inalcancaveis.
  const idConflict = validationResult.idConflict ?? null;
  const documentoConflict = validationResult.documentoConflict ?? null;
  const validacaoOk = validationResult.success === true;

  const conflitoEhOProprioCadastro =
    ehReconsulta &&
    idConflict !== null &&
    Number(idConflict.idCliente) === idCliente &&
    normalizeDocumentDigits(toText(idConflict.documento)) === localValidation.digits &&
    (documentoConflict === null || Number(documentoConflict.idCliente) === idCliente);

  if ((idConflict || documentoConflict) && !conflitoEhOProprioCadastro) {
    return NextResponse.json(
      {
        success: false,
        duplicated: true,
        idConflict,
        documentoConflict,
        message: ehReconsulta
          ? "O CNPJ informado pertence a outro cadastro. A consulta foi cancelada."
          : "Documento ou ID já cadastrado. A consulta externa foi cancelada."
      },
      { status: 409 }
    );
  }

  if (!validacaoOk && !conflitoEhOProprioCadastro) {
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
