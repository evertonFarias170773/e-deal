import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { ehAdmNoServidor } from "@/features/orcamentos/lib/marcar-entregue";
import { marcarPedidoComoEntregue } from "@/features/orcamentos/services/marcar-entregue.server";

/**
 * "Marcar como entregue" — atalho TEMPORARIO da lista de Pedidos (11/10/2026).
 *
 * POST { id_int } -> LIBERADO vira ENTREGUE, com `expedicoes.data_entrega` e uma
 * linha em `os_status_log` (origem ATALHO_LISTA_ENTREGUE, autor e data). O que e,
 * por que existe e a ordem das escritas: `lib/marcar-entregue.ts` e
 * `services/marcar-entregue.server.ts`.
 *
 * PERMISSAO: so ADM (`is_super_adm` ou `is_admin`, o mesmo teste da pagina),
 * conferida AQUI, no servidor. Esconder a opcao na tela nao protege nada.
 *
 * IDEMPOTENTE: repetir o clique (status ja ENTREGUE) responde 200 com
 * `idempotente: true` e nao grava nada — nem segundo registro de log, nem data
 * nova.
 *
 * A ROTA E A TRANCA DO APP — E SO DO APP. A RLS de `propostas` e `expedicoes` e
 * aberta a `authenticated` (mesma ressalva de `faturado-fora`); a escrita sai com
 * a SESSAO do usuario, sem chave de servico. Apertar a RLS e decisao maior.
 *
 * SEM "DESMARCAR" nesta rodada, por decisao do dono.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { id_int?: number };

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();

  const body = (await request.json().catch(() => null)) as Corpo | null;
  const idInt = Number(body?.id_int);

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int inválido." }, { status: 400 });
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nome_usuario, is_super_adm, is_admin")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (!ehAdmNoServidor(usuario)) {
    return NextResponse.json(
      { success: false, message: "Só administrador pode marcar um pedido como entregue." },
      { status: 403 }
    );
  }

  const resultado = await marcarPedidoComoEntregue(supabase, {
    idInt,
    autor: {
      uid: authData.user.id,
      nome: String(usuario?.nome_usuario ?? "").trim() || authData.user.email || "Administrador"
    }
  });

  if (!resultado.success) {
    return NextResponse.json(
      { success: false, code: resultado.code, message: resultado.message },
      { status: resultado.httpStatus }
    );
  }
  return NextResponse.json(resultado);
}
