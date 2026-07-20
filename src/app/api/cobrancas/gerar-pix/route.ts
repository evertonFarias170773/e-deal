import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { gerarPixBancoInter } from "@/features/cobrancas/services/banco-inter.service";

type GerarPixRequest = {
  cobrancaId: string;
  idEmpresa?: number;
  seuNumero: string;
  valorNominal: number;
  dataVencimento: string;
  telefone?: string;
  cpfCnpj: string;
  nome: string;
  endereco: string;
  cidade: string;
  uf: string;
  cep: string;
};

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
    cpfCnpj,
    nome,
    endereco,
    cidade,
    uf,
    cep
  } = body;

  // Validacoes basicas do payload
  if (!cobrancaId || !seuNumero || !valorNominal || !cpfCnpj || !nome) {
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

  // 3. Autorização / Permissão
  const temPermissao = await verificarPermissaoServerSide(
    supabaseUser,
    authData.user.id,
    "cobrancas.emitir_boleto"
  );
  if (!temPermissao) {
    return NextResponse.json({ success: false, message: "Sem permissão para gerar cobrança." }, { status: 403 });
  }

  // 4. Validação da cobrança e RLS
  const { data: cobranca, error: fetchErr } = await supabaseUser
    .from("pagamentos_v2")
    .select("id, id_empresa, tipo_cobranca, valor")
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

  const idEmpresaReal = Number(cobranca.id_empresa);
  if (!idEmpresaReal) {
    return NextResponse.json(
      { success: false, message: "Cobrança sem empresa associada." },
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
    return NextResponse.json(
      { success: false, message: resPix.error || "Erro de processamento no Banco Inter." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    data: resPix.data
  });
}
