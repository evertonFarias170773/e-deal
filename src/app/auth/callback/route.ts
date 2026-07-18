import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  let next = searchParams.get("next") ?? "/dashboard";

  // Lista de caminhos internos explicitamente permitidos para evitar Open Redirect
  const ALLOWED_NEXT_ROUTES = ["/dashboard", "/atualizar-senha", "/boas-vindas"];

  if (!ALLOWED_NEXT_ROUTES.includes(next)) {
    next = "/dashboard";
  }

  const isRecoveryFlow = next === "/atualizar-senha" || type === "recovery";

  const supabase = await createClient();

  // 1. Fluxo de Redefinição de Senha via Token Hash (OTP/E-mail)
  if (tokenHash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });

    if (error) {
      console.error("[AuthCallback] Falha na verificacao do token_hash:", error.message);
      return NextResponse.redirect(`${origin}/atualizar-senha?error=link_expirado`);
    }

    return NextResponse.redirect(`${origin}${next}`);
  }

  // 2. Fluxo de Autenticação Tradicional via Código PKCE (OAuth / Google)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[AuthCallback] Falha na troca do codigo por sessao:", error.message);
      if (isRecoveryFlow) {
        const errorMsg = error.message.toLowerCase();
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

  // Se nenhum parâmetro esperado foi fornecido
  if (isRecoveryFlow) {
    return NextResponse.redirect(`${origin}/atualizar-senha?error=link_ausente`);
  }

  return NextResponse.redirect(`${origin}/login?error=Parametros de autenticacao ausentes`);
}
