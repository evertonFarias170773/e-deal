import { NextResponse } from "next/server";
import { normalizeDocumentDigits, validateDocumentByTipo } from "@/features/cadastros/utils/documento";

type ConsultaCpfRequestBody = {
  documento?: string;
};

type CpfApiResponse = {
  data?: {
    cpf?: string;
    nameUpper?: string;
    name?: string;
    birthDate?: string;
  };
};

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
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

export async function POST(request: Request) {
  const startTime = Date.now();
  let body: ConsultaCpfRequestBody;

  try {
    body = (await request.json()) as ConsultaCpfRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Corpo da requisição inválido." },
      { status: 400 }
    );
  }

  // Somente números
  const documento = normalizeDocumentDigits(toText(body.documento));

  if (!documento) {
    return NextResponse.json(
      { success: false, message: "Informe o documento para consultar." },
      { status: 400 }
    );
  }

  const localValidation = validateDocumentByTipo(documento, "CPF");
  if (!localValidation.isValid) {
    return NextResponse.json(
      { success: false, message: "CPF inválido." },
      { status: 400 }
    );
  }

  const maskedCpf = documento.slice(0, 3) + "******" + documento.slice(-2);
  const endpoint = `https://api.cpfhub.io/cpf/${localValidation.digits}`;

  const token = process.env.CPFHUB_API_TOKEN ?? process.env.CPFHUB_TOKEN ?? process.env.CPFHUB_API_KEY;
  const headers: HeadersInit = {};

  if (token) {
    headers["x-api-key"] = token;
  } else {
    return NextResponse.json(
      { success: false, message: "Serviço de consulta de CPF não configurado no servidor." },
      { status: 500 }
    );
  }

  const result = await fetchJsonWithTimeout<any>(endpoint, headers);
  const duration = Date.now() - startTime;
  
  if (!result.ok) {
    if (process.env.NODE_ENV === "development") {
      console.error(`[CPF_API_ERROR] Falha na consulta de CPF ${maskedCpf}. Endpoint: https://api.cpfhub.io/cpf/{cpf}. Status HTTP: ${result.status}. Tempo: ${duration}ms`);
    }

    if (result.status === 401 || result.status === 403) {
      return NextResponse.json({ success: false, message: "Falha de autenticação na API de CPF." }, { status: 403 });
    }
    if (result.status === 429) {
      return NextResponse.json({ success: false, message: "Limite de consultas de CPF atingido. Tente novamente mais tarde." }, { status: 429 });
    }
    if (result.status === 404) {
      return NextResponse.json({ success: false, message: "CPF não encontrado na base de dados." }, { status: 404 });
    }
    
    return NextResponse.json(
      { success: false, message: "A API de CPF está indisponível no momento." },
      { status: 502 }
    );
  }

  // Tenta encontrar o nome em diversos formatos possíveis
  const d = result.data || {};
  
  // body de resposta sanitizado para logs
  if (process.env.NODE_ENV === "development") {
    const sanitizedBody = JSON.stringify(d, (key, value) => {
      if (typeof value === "string" && value.length > 5 && (key.toLowerCase().includes("cpf") || key.toLowerCase().includes("doc"))) {
        return "***";
      }
      return value;
    });
    console.log(`[CPF_API_SUCCESS] Consulta CPF ${maskedCpf}. Tempo: ${duration}ms. Retorno: ${sanitizedBody}`);
  }

  const nome = 
    toText(d.data?.nameUpper) || 
    toText(d.data?.name) || 
    toText(d.data?.nome) || 
    toText(d.nome) || 
    toText(d.result?.nome) || 
    toText(d.pessoa?.nome) || 
    toText(d.dados?.nome);

  if (!nome) {
    if (process.env.NODE_ENV === "development") {
      console.error(`[CPF_API_ERROR] Retorno da API sem nome legível para CPF ${maskedCpf}.`);
    }
    return NextResponse.json(
      { success: false, message: "A API retornou sucesso, mas sem campo de nome legível." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    payload: {
      nome,
      documento: localValidation.digits
    }
  });
}
