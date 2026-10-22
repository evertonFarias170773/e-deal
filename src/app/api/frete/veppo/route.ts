/**
 * POST /api/frete/veppo — cotação VEPPO da tela do orçamento (21/10/2026).
 *
 * Até esta data o navegador chamava o webhook `coordenadas` do n8n direto. Agora
 * a tela chama esta rota, que exige sessão e passa pela função de servidor
 * (services/frete-veppo.server): regra de sempre (RS e fora de Porto Alegre),
 * lista `cidades_veppo` e só então o webhook. Cidade não atendida responde
 * `status: "NAO_ATENDIDA"` sem chamar o n8n.
 *
 * Só leitura: nada é gravado (a cotação escolhida é gravada pela tela, como antes).
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cotarVeppoNoServidor } from "@/features/orcamentos/services/frete-veppo.server";
import { MENSAGEM_CIDADE_NAO_ATENDIDA } from "@/features/orcamentos/lib/cidade-veppo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { peso?: unknown; valor?: unknown; cidade?: unknown; uf?: unknown; id_int?: unknown };

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, error: "Erro interno no servidor." }, { status: 500 });
  }

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada." }, { status: 401 });
  }
  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessão inválida." }, { status: 401 });
  }

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }
  const peso = Number(corpo.peso);
  const valor = Number(corpo.valor);
  const cidade = typeof corpo.cidade === "string" ? corpo.cidade : "";
  const uf = typeof corpo.uf === "string" ? corpo.uf : "";
  if (!cidade || !uf || !Number.isFinite(peso) || !Number.isFinite(valor)) {
    return NextResponse.json({ success: false, error: "Informe cidade, UF, peso e valor." }, { status: 400 });
  }
  const idInt = typeof corpo.id_int === "number" || typeof corpo.id_int === "string" ? corpo.id_int : undefined;

  const resultado = await cotarVeppoNoServidor({ peso, valor, cidade, uf, id_int: idInt });
  return NextResponse.json({
    success: true,
    status: resultado.status,
    fretes: resultado.fretes,
    mensagem: resultado.status === "NAO_ATENDIDA" ? MENSAGEM_CIDADE_NAO_ATENDIDA : undefined
  });
}
