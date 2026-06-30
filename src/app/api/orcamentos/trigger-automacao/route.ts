import { NextResponse } from "next/server";
import { aplicarStatusRecomendadoProposta, OrigemAutomacao } from "@/features/orcamentos/services/status-writer.service";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    // 2. Extração dos dados
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ success: false, errorMessage: "Corpo da requisição inválido." }, { status: 400 });
    }

    const idInt = Number(body?.id_int);
    if (!idInt || isNaN(idInt)) {
      return NextResponse.json({ success: false, errorMessage: "id_int ausente ou inválido." }, { status: 400 });
    }

    const origem = body?.origem as OrigemAutomacao;
    if (!origem || !["AUTO_FINANCEIRO", "AUTO_ARTE", "AUTO_MODELOS"].includes(origem)) {
      return NextResponse.json({ success: false, errorMessage: "Origem inválida ou não autorizada para automação." }, { status: 400 });
    }

    // 3. Validação da Sessão / Token (Segurança Server-Side)
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, errorMessage: "Acesso negado: Token ausente." },
        { status: 401 }
      );
    }
    
    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { success: false, errorMessage: "Configuração do servidor incorreta." },
        { status: 500 }
      );
    }

    // Criar client autenticado com o token para respeitar RLS do usuário (Sem Service Role)
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: authData, error: authError } = await authClient.auth.getUser();
    
    if (authError || !authData?.user) {
      return NextResponse.json(
        { success: false, errorMessage: "Acesso negado: Token inválido ou expirado." },
        { status: 401 }
      );
    }

    const userId = authData.user.id;

    // Buscar dados mínimos do usuário apenas para preencher os logs
    const { data: usuarioData } = await authClient
      .from("usuarios")
      .select("nome_usuario, email")
      .eq("user_id", userId)
      .maybeSingle();

    // Passar o usuário enriquecido para a function de status
    const enrichedUser = {
      uid: userId,
      nome: usuarioData?.nome_usuario || authData.user.user_metadata?.full_name || "Sistema Automático",
      email: usuarioData?.email || authData.user.email || ""
    };

    // 4. Delegação para o Status Writer
    // O status writer já encapsula: 
    // - diagnostico (engine server-side)
    // - verificação se mudou o status
    // - validação da whitelist baseada na origem
    // - optimistic locking
    // - leitura confirmatória
    // - logs formatados
    
    const resultado = await aplicarStatusRecomendadoProposta(
      idInt,
      enrichedUser,
      authClient,
      origem
    );

    if (!resultado.success) {
      console.warn(`[TriggerAutomacao] Operação abortada/falhou: ${resultado.errorMessage}`);
      return NextResponse.json(
        { success: false, errorMessage: resultado.errorMessage },
        { status: 400 } // Não usar 500 se for bloqueado por whitelist, RLS ou se status não mudou. 400 é mais adequado.
      );
    }

    return NextResponse.json({ success: true, message: "Status automatizado com sucesso." });
  } catch (err: any) {
    console.error("[API][trigger-automacao] Erro interno:", err);
    return NextResponse.json(
      { success: false, errorMessage: err.message || "Erro interno no servidor ao rodar automação." },
      { status: 500 }
    );
  }
}
