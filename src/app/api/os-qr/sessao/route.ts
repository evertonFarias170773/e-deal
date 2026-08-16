import { NextResponse } from "next/server";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diz à página pública do QR se quem escaneou já está logado no ERP e pode
 * abrir o boletim.
 *
 * Existe porque `/os` vive fora do layout `(erp)` — não há AuthProvider ali, e
 * o client não teria como saber o perfil. Só lê a sessão do cookie: sem Bearer,
 * porque o celular do chão de fábrica nunca terá um.
 *
 * `pedidos.view` é o gate: Produção tem na lista do perfil, Admin e Super Admin
 * passam pelo wildcard em verificarPermissaoServerSide. Quem não tem fica na
 * página pública, que é o comportamento útil — em vez de cair numa tela de
 * acesso negado depois do redirect.
 *
 * Nunca recebe nem devolve o token do QR: responde só sobre a sessão.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return NextResponse.json(
        { autenticado: false, podeEditar: false },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const podeEditar = await verificarPermissaoServerSide(supabase, data.user.id, "pedidos.view");
    return NextResponse.json(
      { autenticado: true, podeEditar },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // Falha aqui nunca pode derrubar o fluxo público de status.
    return NextResponse.json(
      { autenticado: false, podeEditar: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
