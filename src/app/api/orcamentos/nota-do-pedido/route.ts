import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  notasDeVendaVivas,
  textoLinhaDoTempoNotaDivergente,
  type NotaDoBanco
} from "@/features/orcamentos/lib/nota-x-pedido";

/**
 * POST /api/orcamentos/nota-do-pedido — NF-e de venda viva x Salvar da proposta
 * (02/11/2026). A regra está em `lib/nota-x-pedido.ts`.
 *
 * POST { id_int, acao: "consultar" } -> as NF-e de venda vivas do pedido, LIDAS DO
 *   BANCO (número, status, valor). A tela usa para decidir se pergunta antes de salvar.
 * POST { id_int, acao: "registrar" } -> chamada DEPOIS de salvar com "Salvar mesmo
 *   assim": relê as notas e o total do pedido no banco e grava uma linha na linha do
 *   tempo (`propostas_chat`). Nada do que a tela mandou entra no texto além do id.
 *
 * Só leitura de `notas_fiscais` e `propostas`; a única escrita é a linha do tempo,
 * com a sessão do usuário (mesmo padrão de `faturado-fora`).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id_int?: number; acao?: string } | null;
  const idInt = Number(body?.id_int);
  const acao = body?.acao;
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int é obrigatório." }, { status: 400 });
  }
  if (acao !== "consultar" && acao !== "registrar") {
    return NextResponse.json({ success: false, message: "acao deve ser consultar ou registrar." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, message: "Erro interno no servidor." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  const { data: linhas, error: erroNotas } = await supabase
    .from("notas_fiscais")
    .select("ref, numero_nf, status, tipo_nota, ambiente, valor_total_nf")
    .eq("id_int", idInt);
  if (erroNotas) {
    return NextResponse.json({ success: false, message: `Não foi possível ler as notas do pedido (${erroNotas.message}).` }, { status: 500 });
  }
  const notas = notasDeVendaVivas((linhas ?? []) as NotaDoBanco[]);

  if (acao === "consultar") {
    return NextResponse.json({ success: true, notas });
  }

  // registrar: só quando há nota viva; o total vem do banco, já salvo.
  if (notas.length === 0) return NextResponse.json({ success: true, registrado: false });

  const { data: proposta, error: erroProposta } = await supabase
    .from("propostas")
    .select("id_cliente, valor_total, valor")
    .eq("id_int", idInt)
    .maybeSingle();
  if (erroProposta || !proposta) {
    return NextResponse.json({ success: false, message: "Não foi possível ler o pedido para registrar." }, { status: 500 });
  }
  const total = Number(proposta.valor_total ?? proposta.valor ?? 0);

  const { data: usuario } = await supabase.from("usuarios").select("nome_usuario").eq("user_id", authData.user.id).maybeSingle();
  const autorNome = String(usuario?.nome_usuario ?? "").trim() || authData.user.email || "Usuário";

  const { error: erroChat } = await supabase.from("propostas_chat").insert([
    {
      id_int: idInt,
      id_cliente: proposta.id_cliente ?? null,
      tipo: "SISTEMA",
      setor: "Fiscal",
      visivel_externo: false,
      autor_uid: authData.user.id,
      autor_nome: autorNome,
      autor_email: authData.user.email ?? null,
      mensagem: textoLinhaDoTempoNotaDivergente(autorNome, notas, total)
    }
  ]);
  if (erroChat) {
    return NextResponse.json({ success: false, message: `O pedido foi salvo, mas a linha do tempo falhou (${erroChat.message}).` }, { status: 500 });
  }
  return NextResponse.json({ success: true, registrado: true });
}
