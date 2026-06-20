import { NextResponse } from "next/server";

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
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
  try {
    const { tipo, documento } = await request.json();

    if (!tipo || !documento) {
      return NextResponse.json(
        { success: false, errorMessage: "Tipo de documento e número são obrigatórios." },
        { status: 400 }
      );
    }

    const cleanDoc = documento.replace(/\D/g, "");

    if (tipo === "CPF") {
      return NextResponse.json(
        { success: false, errorMessage: "Use a rota exclusiva /api/verificacao/cpf para consultas de CPF." },
        { status: 400 }
      );
    } else if (tipo === "CNPJ") {
      if (cleanDoc.length !== 14) {
        return NextResponse.json(
          { success: false, errorMessage: "CNPJ deve conter 14 dígitos." },
          { status: 400 }
        );
      }

      const result = await fetchJsonWithTimeout<any>(`https://publica.cnpj.ws/cnpj/${cleanDoc}`);
      if (!result.ok) {
        return NextResponse.json(
          { success: false, errorMessage: "Não foi possível consultar o CNPJ no serviço externo." },
          { status: 502 }
        );
      }

      const data = result.data;
      const estabelecimento = data.estabelecimento || {};
      const cidade = toText(estabelecimento.cidade?.nome);
      const uf = toText(estabelecimento.estado?.sigla).toUpperCase();
      
      const tipoLogradouro = toText(estabelecimento.tipo_logradouro);
      const logradouro = toText(estabelecimento.logradouro);
      const enderecoCompleto = [
        tipoLogradouro ? `${tipoLogradouro} ${logradouro}` : logradouro,
        toText(estabelecimento.numero),
        toText(estabelecimento.complemento),
        toText(estabelecimento.bairro),
        cidade && uf ? `${cidade}/${uf}` : ""
      ].filter(Boolean).join(", ");

      const ddd1 = toText(estabelecimento.ddd1);
      const tel1 = toText(estabelecimento.telefone1);
      const telefone = ddd1 && tel1 ? `(${ddd1}) ${tel1}` : "";

      const socioPrincipal = data.socios && data.socios.length > 0 ? toText(data.socios[0].nome) : "";
      
      const atividadePrincipal = data.estabelecimento?.atividade_principal 
        ? `${data.estabelecimento.atividade_principal.id} - ${data.estabelecimento.atividade_principal.descricao}`
        : "";

      return NextResponse.json({
        success: true,
        data: {
          documento,
          tipo: "CNPJ",
          razaoSocial: toText(data.razao_social),
          nomeFantasia: toText(estabelecimento.nome_fantasia),
          contato: toText(estabelecimento.email) || socioPrincipal,
          telefone: telefone,
          email: toText(estabelecimento.email),
          endereco: enderecoCompleto,
          cep: toText(estabelecimento.cep),
          capitalSocial: data.capital_social ? Number(data.capital_social) : undefined,
          naturezaJuridica: data.natureza_juridica ? `${data.natureza_juridica.id} - ${data.natureza_juridica.descricao}` : "",
          qualificacaoResponsavel: data.qualificacao_do_responsavel ? `${data.qualificacao_do_responsavel.id} - ${data.qualificacao_do_responsavel.descricao}` : "",
          situacaoCadastral: toText(estabelecimento.situacao_cadastral),
          dataAbertura: toText(estabelecimento.data_inicio_atividade),
          socioPrincipal: socioPrincipal,
          atividadePrincipal: atividadePrincipal,
          simplesNacional: data.simples ? (data.simples.simples === "Sim" ? "Optante" : "Não optante") : "",
          mei: data.simples ? (data.simples.mei === "Sim" ? "Sim" : "Não") : "",
          consultaData: new Date().toISOString(),
          rawPayload: data
        }
      });
    }

    return NextResponse.json(
      { success: false, errorMessage: "Tipo de documento inválido. Escolha CPF ou CNPJ." },
      { status: 400 }
    );
  } catch (err) {
    console.error("Erro na rota de verificação de documento:", err);
    return NextResponse.json(
      { success: false, errorMessage: "Falha interna ao processar consulta." },
      { status: 500 }
    );
  }
}
