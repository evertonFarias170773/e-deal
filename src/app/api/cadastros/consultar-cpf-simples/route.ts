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
  let body: ConsultaCpfRequestBody;

  try {
    body = (await request.json()) as ConsultaCpfRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Corpo da requisição inválido." },
      { status: 400 }
    );
  }

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

  const token = process.env.CPFHUB_API_TOKEN ?? process.env.CPFHUB_TOKEN ?? process.env.CPFHUB_API_KEY;
  const headers: HeadersInit = {};

  if (token) {
    headers["x-api-key"] = token;
  } else {
    // If there is no token configured, we should return an error explicitly, as requested: "Se API falhar ou token ausente, retornar erro controlado"
    return NextResponse.json(
      { success: false, message: "Serviço de consulta de CPF não configurado no servidor." },
      { status: 500 }
    );
  }

  const result = await fetchJsonWithTimeout<CpfApiResponse>(`https://api.cpfhub.io/cpf/${localValidation.digits}`, headers);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, message: "Não foi possível consultar o CPF no serviço externo." },
      { status: 502 }
    );
  }

  const data = result.data.data ?? {};
  const nome = toText(data.nameUpper) || toText(data.name);

  if (!nome) {
    return NextResponse.json(
      { success: false, message: "Nome não encontrado para este CPF." },
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
