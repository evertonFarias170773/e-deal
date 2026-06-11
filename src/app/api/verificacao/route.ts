import { NextResponse } from "next/server";

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

    // Mock response for CPF / CNPJ verification
    if (tipo === "CPF") {
      if (cleanDoc.length !== 11) {
        return NextResponse.json(
          { success: false, errorMessage: "CPF deve conter 11 dígitos." },
          { status: 400 }
        );
      }

      // Simulated CPF response
      return NextResponse.json({
        success: true,
        source: "mock",
        data: {
          documento: documento,
          tipo: "CPF",
          nome: "EVERTON DE FARIAS",
          dataNascimento: "17/07/1973",
          situacaoCadastral: "REGULAR",
          protocolo: `RF-${Math.floor(100000000 + Math.random() * 900000000)}-${Math.floor(Math.random() * 9)}`,
          consultaData: new Date().toISOString(),
          codigoControle: "9F2C.3B8A.1A7E.4D9C",
          observacoes: "Cadastro regular junto à Receita Federal do Brasil."
        }
      });
    } else if (tipo === "CNPJ") {
      if (cleanDoc.length !== 14) {
        return NextResponse.json(
          { success: false, errorMessage: "CNPJ deve conter 14 dígitos." },
          { status: 400 }
        );
      }

      // Simulated CNPJ response
      return NextResponse.json({
        success: true,
        source: "mock",
        data: {
          documento: documento,
          tipo: "CNPJ",
          razaoSocial: "IDEAL GRÁFICA EXPRESSA EIRELI",
          nomeFantasia: "Ideal Gráfica",
          situacaoCadastral: "ATIVA",
          dataAbertura: "01/06/2010",
          naturezaJuridica: "213-5 - Empresário (Individual)",
          atividadePrincipal: "18.13-0-01 - Impressão de material para uso publicitário",
          endereco: "Rua Farrapos, 450 - Floresta - Porto Alegre/RS",
          cep: "90020-070",
          inscricaoEstadual: "096/3492810",
          consultaData: new Date().toISOString(),
          capitalSocial: 150000,
          regimeTributario: "Simples Nacional"
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
