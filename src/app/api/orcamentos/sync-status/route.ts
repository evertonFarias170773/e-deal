import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";
import { featureFlags } from "@/lib/feature-flags";
import { aplicarStatusRecomendadoProposta } from "@/features/orcamentos/services/status-writer.service";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {

    // 2. Validação da Sessão / Token (Segurança Server-Side)
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

    // Criar client autenticado com o token para respeitar RLS do usuário
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

    // Passar o usuário para a function de status
    const enrichedUser = {
      id: userId,
      name: authData.user.user_metadata?.full_name || authData.user.email?.split("@")[0] || "Usuário Sistema",
      email: authData.user.email || ""
    };

    // 4. Receber dados mínimos (apenas idInt)
    const { idInt } = await request.json();
    
    if (!idInt || typeof idInt !== 'number') {
      return NextResponse.json(
        { success: false, errorMessage: "ID da proposta inválido." },
        { status: 400 }
      );
    }

    // 5. Chamar a Service de Escrita
    const usuarioParaLog = {
      uid: enrichedUser.id || authData.user.id,
      nome: enrichedUser.name || "Usuário Desconhecido",
      email: enrichedUser.email || authData.user.email || ""
    };

    const result = await aplicarStatusRecomendadoProposta(idInt, usuarioParaLog, authClient);

    if (!result.success) {
      return NextResponse.json(
        { success: false, errorMessage: result.errorMessage },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error("[API][AplicarStatus] Exceção:", error);
    return NextResponse.json(
      { success: false, errorMessage: "Erro interno no servidor." },
      { status: 500 }
    );
  }
}
