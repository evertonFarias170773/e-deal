import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { gerarPixBancoInter } from "@/features/cobrancas/services/banco-inter.service";

/**
 * Identidade do devedor NÃO vem do payload: sai de `pagamentos_v2`, lida aqui
 * dentro. O front montava `nome`/`cpfCnpj` a partir de `proposta.cliente`,
 * enquanto a linha da cobrança é gravada com o pagador (`propostas.id_faturado`)
 * — o Inter recebia uma pessoa e o ERP registrava outra. A rota do Cartão Asaas
 * já lia da linha; este é o mesmo contrato.
 */
type GerarPixRequest = {
  cobrancaId: string;
  idEmpresa?: number;
  seuNumero: string;
  valorNominal: number;
  dataVencimento: string;
  telefone?: string;
  endereco: string;
  cidade: string;
  uf: string;
  cep: string;
};

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

export async function POST(request: Request) {
  let body: GerarPixRequest;

  try {
    body = (await request.json()) as GerarPixRequest;
  } catch {
    return NextResponse.json(
      { success: false, message: "Corpo da requisicao invalido." },
      { status: 400 }
    );
  }

  const {
    cobrancaId,
    seuNumero,
    valorNominal,
    dataVencimento,
    telefone,
    endereco,
    cidade,
    uf,
    cep
  } = body;

  // Validacoes basicas do payload
  if (!cobrancaId || !seuNumero || !valorNominal) {
    return NextResponse.json(
      { success: false, message: "Campos obrigatorios ausentes no body." },
      { status: 400 }
    );
  }

  // 1. Obter ENV
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[GerarPix] ENV AUSENTE");
    return NextResponse.json(
      { success: false, message: "Erro interno no servidor de banco de dados." },
      { status: 500 }
    );
  }

  // 2. Autenticação JWT
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  const supabaseUser = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  // 3. Validação da cobrança e RLS
  const { data: cobranca, error: fetchErr } = await supabaseUser
    .from("pagamentos_v2")
    .select("id, id_empresa, tipo_cobranca, valor, status, pix_copia_cola, linha_digitavel, cod_solicitacao_inter, cliente, documento")
    .eq("id", cobrancaId)
    .maybeSingle();

  if (fetchErr || !cobranca) {
    return NextResponse.json(
      { success: false, message: "Cobrança não encontrada ou fora do escopo de acesso do usuário." },
      { status: 404 }
    );
  }

  const tipo = cobranca.tipo_cobranca?.toUpperCase() || "";
  if (tipo !== "E-PIX" && tipo !== "PIX") {
    return NextResponse.json(
      { success: false, message: "Esta cobrança não é do tipo PIX." },
      { status: 400 }
    );
  }

  if (cobranca.status === "CANCELADO") {
    return NextResponse.json(
      { success: false, message: "Esta cobrança está cancelada." },
      { status: 400 }
    );
  }

  // Idempotência: se o PIX já foi gerado para esta cobrança (retry sobre a
  // mesma cobrança pendente — ex.: após falha anterior na leitura da resposta
  // do webhook), não rechama a integração externa — cada chamada ao webhook
  // pode emitir uma cobrança real no Banco Inter, então reprocessar geraria
  // um PIX duplicado para a mesma cobrança interna. Devolve os dados já salvos.
  if (cobranca.pix_copia_cola) {
    return NextResponse.json({
      success: true,
      idempotente: true,
      data: {
        id: cobranca.id,
        pix_copia_cola: cobranca.pix_copia_cola,
        linha_digitavel: cobranca.linha_digitavel,
        cod_solicitacao_inter: cobranca.cod_solicitacao_inter
      }
    });
  }

  // Cobrança já emitida no banco, mas sem o QR capturado (o webhook leu a
  // cobrança de volta antes de o PIX ficar pronto). Reemitir criaria OUTRA
  // cobrança real no emissor — a idempotência acima não cobre este caso porque
  // depende de `pix_copia_cola`, que é justamente o que faltou.
  if (cobranca.cod_solicitacao_inter) {
    return NextResponse.json(
      {
        success: false,
        code: "PIX_EMITIDO_SEM_QR",
        message:
          "Esta cobrança já foi emitida no banco, mas o QR do PIX não foi capturado. Não gere outra para a mesma cobrança: consulte o financeiro para recuperar o código, ou cancele esta cobrança e crie uma nova."
      },
      { status: 409 }
    );
  }

  const idEmpresaReal = Number(cobranca.id_empresa);
  if (!idEmpresaReal) {
    return NextResponse.json(
      { success: false, message: "Cobrança sem empresa associada." },
      { status: 400 }
    );
  }

  // 4. Identidade do devedor — SEMPRE da linha da cobrança, nunca do payload.
  // Os dois campos saem da mesma linha, então não há como o nome ser de uma
  // pessoa e o documento de outra (era o caso do retry automático do PIX, que
  // mandava `pagador.nome` junto com `proposta.cliente.documento`).
  const nome = String(cobranca.cliente ?? "").trim();
  const cpfCnpj = soDigitos(cobranca.documento);

  if (!nome) {
    return NextResponse.json(
      { success: false, message: "Cobrança sem nome do pagador gravado — não é possível emitir o PIX." },
      { status: 400 }
    );
  }

  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return NextResponse.json(
      { success: false, message: "CPF/CNPJ do pagador inválido ou ausente na cobrança." },
      { status: 400 }
    );
  }

  // 5. Executar integração real do PIX
  const resPix = await gerarPixBancoInter(supabaseUser, {
    cobrancaId,
    idEmpresa: idEmpresaReal,
    seuNumero,
    valorNominal,
    dataVencimento,
    telefone,
    cpfCnpj,
    nome,
    endereco,
    cidade,
    uf,
    cep
  });

  if (!resPix.success) {
    // 409 quando a cobrança já existe no emissor: é conflito de estado, não
    // falha transitória, e o front não pode sugerir "tente novamente".
    // 502 segue para falha de comunicação, onde repetir é legítimo.
    const jaEmitida = resPix.cobrancaEmitida === true;
    return NextResponse.json(
      {
        success: false,
        ...(jaEmitida ? { code: "PIX_EMITIDO_SEM_QR" } : {}),
        message: resPix.error || "Erro de processamento no Banco Inter."
      },
      { status: jaEmitida ? 409 : 502 }
    );
  }

  return NextResponse.json({
    success: true,
    data: resPix.data
  });
}
