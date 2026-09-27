import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { criarClientServiceRole } from "@/features/cadastros/services/cadastro-online.server";
import { areaClienteFlagAtiva, derivarTokenAreaCliente } from "@/features/area-cliente/services/area-cliente.server";

/**
 * Link da área do cliente para um pedido — o que o botão "Copiar link da área
 * do cliente" da proposta usa.
 *
 * É uma rota, e não derivação no navegador, pelo mesmo motivo do cadastro
 * online: o token só existe onde `AREA_CLIENTE_TOKEN_SECRET` existe. Exige
 * sessão do ERP; qualquer usuário logado que abra a proposta pode copiar o
 * link, como já pode criar a cobrança por ela.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function erro(mensagem: string, status: number) {
  return NextResponse.json({ ok: false, mensagem }, { status });
}

export async function POST(request: Request) {
  let corpo: { idInt?: number | string };
  try {
    corpo = (await request.json()) as { idInt?: number | string };
  } catch {
    return erro("Requisicao invalida.", 400);
  }

  const idInt = Number(corpo.idInt);
  if (!Number.isInteger(idInt) || idInt <= 0) return erro("Pedido invalido.", 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[area-cliente/link] ENV do Supabase ausente.");
    return erro("Erro interno no servidor de banco de dados.", 500);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearer) return erro("Sessao nao encontrada.", 401);

  const comSessao = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: auth, error: erroAuth } = await comSessao.auth.getUser();
  if (erroAuth || !auth.user) return erro("Sessao invalida.", 401);

  if (!areaClienteFlagAtiva()) {
    return erro("A area do cliente esta desligada neste ambiente (AREA_CLIENTE_ENABLED).", 409);
  }

  const service = criarClientServiceRole();
  if (!service) return erro("Servico indisponivel no momento.", 500);

  const { data: proposta } = await service.from("propostas").select("id_int").eq("id_int", idInt).maybeSingle();
  if (!proposta) return erro("Proposta nao encontrada.", 404);

  const token = derivarTokenAreaCliente(idInt);
  if (!token) return erro("AREA_CLIENTE_TOKEN_SECRET ausente ou curto demais no servidor.", 500);

  return NextResponse.json({ ok: true, token, caminho: `/p/${token}` });
}
