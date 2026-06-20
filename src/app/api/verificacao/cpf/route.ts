import { NextResponse } from "next/server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

async function fetchWithRetry(url: string, headers: HeadersInit, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeout);

      // Status codes for which we should NOT retry
      if ([400, 401, 403, 404, 422].includes(response.status)) {
        return { ok: false, status: response.status, data: await response.json().catch(() => null) };
      }

      // Status codes that warrant a retry (Rate limit and Server Errors)
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        if (attempt === maxRetries) {
          return { ok: false, status: response.status };
        }
        await sleep(500 * attempt); // Short backoff: 500ms, 1000ms
        continue;
      }

      if (!response.ok) {
        if (attempt === maxRetries) return { ok: false, status: response.status };
        await sleep(500 * attempt);
        continue;
      }

      const data = await response.json();
      return { ok: true, data };
    } catch (error) {
      clearTimeout(timeout);
      if (attempt === maxRetries) {
        return { ok: false, error };
      }
      await sleep(500 * attempt);
    }
  }
  return { ok: false };
}

export async function POST(request: Request) {
  try {
    const { cpf } = await request.json();

    if (!cpf) {
      return NextResponse.json(
        { success: false, errorMessage: "O CPF é obrigatório." },
        { status: 400 }
      );
    }

    const cleanCpf = String(cpf).replace(/\D/g, "");

    if (cleanCpf.length !== 11) {
      return NextResponse.json(
        { success: false, errorMessage: "CPF deve conter exatos 11 dígitos." },
        { status: 422 }
      );
    }

    // Prefer CPFHUB_API_KEY, fallback to CPFHUB_API_TOKEN as per guidelines
    const token = process.env.CPFHUB_API_KEY ?? process.env.CPFHUB_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { success: false, errorMessage: "Serviço de consulta de CPF não configurado no servidor (token ausente)." },
        { status: 500 }
      );
    }

    const headers: HeadersInit = { "x-api-key": token };
    const result = await fetchWithRetry(`https://api.cpfhub.io/cpf/${cleanCpf}`, headers);

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        return NextResponse.json(
          { success: false, errorMessage: "Falha de autenticação com a API externa (verifique o token)." },
          { status: 403 }
        );
      }
      if (result.status === 404) {
        return NextResponse.json(
          { success: false, errorMessage: "CPF não encontrado na base de dados." },
          { status: 404 }
        );
      }
      if (result.status === 429) {
        return NextResponse.json(
          { success: false, errorMessage: "Limite de requisições excedido. Tente novamente em instantes." },
          { status: 429 }
        );
      }
      if (result.status && result.status >= 500) {
        return NextResponse.json(
          { success: false, errorMessage: "Serviço externo temporariamente indisponível." },
          { status: result.status }
        );
      }

      return NextResponse.json(
        { success: false, errorMessage: "Falha ao consultar CPF no serviço externo." },
        { status: 502 }
      );
    }

    const data = result.data?.data || result.data || {};
    const nome = toText(data.nameUpper) || toText(data.name) || toText(data.nome);

    if (!nome) {
      return NextResponse.json(
        { success: false, errorMessage: "Nome não retornado pela API para este CPF." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        documento: cleanCpf,
        tipo: "CPF",
        nome,
        dataNascimento: toText(data.birthDate) || toText(data.data_nascimento),
        situacaoCadastral: toText(data.status) || toText(data.situacao) || "REGULAR",
        consultaData: new Date().toISOString(),
        rawPayload: data,
      },
    });
  } catch (err) {
    console.error("[CPF Route] Erro interno:", err);
    return NextResponse.json(
      { success: false, errorMessage: "Falha interna ao processar consulta de CPF." },
      { status: 500 }
    );
  }
}
