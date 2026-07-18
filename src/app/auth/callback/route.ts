import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/dashboard";

  // Lista de caminhos internos explicitamente permitidos para evitar Open Redirect
  const ALLOWED_NEXT_ROUTES = ["/dashboard", "/atualizar-senha", "/boas-vindas"];

  if (!ALLOWED_NEXT_ROUTES.includes(next)) {
    next = "/dashboard";
  }

  const isRecoveryFlow = next === "/atualizar-senha";

  if (!code) {
    if (isRecoveryFlow) {
      return NextResponse.redirect(`${origin}/atualizar-senha?error=link_ausente`);
    }
    return NextResponse.redirect(`${origin}/login?error=Codigo de autenticacao ausente`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[AuthCallback] Falha na troca do codigo por sessao:", error.message);
    if (isRecoveryFlow) {
      const errorMsg = error.message.toLowerCase();
      // Erros comuns de expiração ou reuso de código PKCE no Supabase
      if (
        errorMsg.includes("flow state not found") || 
        errorMsg.includes("code expired") || 
        errorMsg.includes("invalid grant") ||
        errorMsg.includes("bad code")
      ) {
        return NextResponse.redirect(`${origin}/atualizar-senha?error=link_expirado`);
      }
      return NextResponse.redirect(
        `${origin}/atualizar-senha?error=falha_autenticacao&desc=${encodeURIComponent(error.message)}`
      );
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
