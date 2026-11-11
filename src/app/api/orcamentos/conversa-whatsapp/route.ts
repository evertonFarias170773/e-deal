import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { numeroDaConversa, type ConversaWhatsapp } from "@/features/orcamentos/lib/conversa-whatsapp";

/**
 * Conversa do WhatsApp da proposta (abas Geral e Artes), 10/11/2026.
 *
 * GET  ?id_int=&id_cliente=   as conversas do Guru do cliente (visão
 *                 chatguru_contatos_3478, codigo_cliente = id_cliente), a
 *                 escolhida (`propostas.chatguru_chat_id`) e o status da arte.
 *                 id_cliente (11/11/2026) é o cliente que está na tela: proposta
 *                 nova (sem id_int) ou cliente trocado e ainda não salvo. Aí a
 *                 lista é desse cliente, a escolhida da proposta não vale
 *                 (`clienteDaProposta` = false) e a tela guarda a escolha até o
 *                 Salvar, que grava por este mesmo POST. O cliente só é lido se a
 *                 sessão do usuário enxerga o cadastro dele.
 * POST {id_int, chat_id}  grava a escolha, só se o chat_id é de uma conversa do
 *                 cliente da proposta, relida agora.
 *
 * A visão do Guru não tem acesso para anon/authenticated: a leitura dela é com a
 * chave de serviço. Todo o resto (ler a proposta, gravar a escolha) é com a sessão
 * de quem clicou: a RLS e a autoria da auditoria continuam valendo, e quem não
 * enxerga a proposta não enxerga as conversas.
 */

function erro(mensagem: string, status: number) {
  return NextResponse.json({ success: false, message: mensagem }, { status });
}

function limpar(texto: unknown, max = 150): string {
  if (typeof texto !== "string") return "";
  return texto.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

type Contexto = { usuario: SupabaseClient; servico: SupabaseClient };

async function contexto(request: Request): Promise<Contexto | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    console.error("[API][ConversaWhatsapp] ENV AUSENTE (url, anon ou service role)");
    return erro("Erro interno no servidor de banco de dados.", 500);
  }
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return erro("Sessão não encontrada.", 401);
  const usuario = createSupabaseClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await usuario.auth.getUser();
  if (error || !data.user) return erro("Sessão inválida.", 401);
  const servico = createSupabaseClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return { usuario, servico };
}

/** A proposta pela sessão do usuário: se a RLS não a mostra, não há conversa para ver. */
async function proposta(usuario: SupabaseClient, idInt: number) {
  const { data, error } = await usuario
    .from("propostas")
    .select("id_int, id_cliente, chatguru_chat_id")
    .eq("id_int", idInt)
    .maybeSingle();
  if (error) return { erro: "Não foi possível ler a proposta.", status: 500 } as const;
  if (!data) return { erro: `Proposta #${idInt} não encontrada.`, status: 404 } as const;
  return { dados: data as { id_int: number; id_cliente: number | string | null; chatguru_chat_id: string | null } } as const;
}

async function conversasDoCliente(servico: SupabaseClient, idCliente: unknown): Promise<ConversaWhatsapp[] | null> {
  const id = Number(idCliente);
  if (!Number.isInteger(id) || id <= 0) return [];
  const { data, error } = await servico
    .from("chatguru_contatos_3478")
    .select("chat_id, nome_chatguru, telefone_normalizado")
    .eq("codigo_cliente", String(id))
    .limit(50);
  if (error) {
    console.error("[API][ConversaWhatsapp] leitura do Guru:", error.message);
    return null;
  }
  const vistas = new Set<string>();
  const lista: ConversaWhatsapp[] = [];
  for (const c of data ?? []) {
    const chat = limpar(c.chat_id, 80);
    const numero = numeroDaConversa(c.telefone_normalizado);
    if (!chat || !numero || vistas.has(chat)) continue;
    vistas.add(chat);
    lista.push({ chat_id: chat, nome: limpar(c.nome_chatguru) || "—", numero });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function idDoPedido(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Cliente da tela: só se a sessão do usuário enxerga o cadastro dele. */
async function clienteVisivel(usuario: SupabaseClient, idCliente: number): Promise<boolean | null> {
  const { data, error } = await usuario.from("clientes").select("id_cliente").eq("id_cliente", idCliente).maybeSingle();
  if (error) return null;
  return Boolean(data);
}

export async function GET(request: Request) {
  const ctx = await contexto(request);
  if (ctx instanceof NextResponse) return ctx;
  const params = new URL(request.url).searchParams;
  const idInt = idDoPedido(params.get("id_int"));
  const idClienteTela = idDoPedido(params.get("id_cliente"));
  if (!idInt && !idClienteTela) return erro("Pedido ou cliente inválido.", 400);

  let idCliente: number | null = idClienteTela;
  let chatIdGravado: string | null = null;
  let statusArte: string | null = null;
  let clienteDaProposta = false;
  if (idInt) {
    const p = await proposta(ctx.usuario, idInt);
    if ("erro" in p) return erro(p.erro ?? "Falha.", p.status ?? 500);
    const gravado = idDoPedido(p.dados.id_cliente);
    clienteDaProposta = gravado !== null && (idClienteTela === null || idClienteTela === gravado);
    if (clienteDaProposta) {
      idCliente = gravado;
      chatIdGravado = limpar(p.dados.chatguru_chat_id, 80) || null;
    }
    const arte = await ctx.usuario
      .from("pedidos_artes")
      .select("status")
      .eq("id_int", idInt)
      .order("created_at", { ascending: false })
      .limit(1);
    if (arte.error) return erro("Não foi possível ler o status da arte.", 500);
    statusArte = (arte.data?.[0]?.status as string | null | undefined) ?? null;
  }
  if (!clienteDaProposta && idCliente !== null) {
    const visivel = await clienteVisivel(ctx.usuario, idCliente);
    if (visivel === null) return erro("Não foi possível ler o cliente.", 500);
    if (!visivel) return erro("Cliente não encontrado.", 404);
  }
  const conversas = await conversasDoCliente(ctx.servico, idCliente);
  if (conversas === null) return erro("Não foi possível ler as conversas do cliente no ChatGuru.", 503);

  return NextResponse.json({ success: true, conversas, chatIdGravado, statusArte, clienteDaProposta });
}

export async function POST(request: Request) {
  const ctx = await contexto(request);
  if (ctx instanceof NextResponse) return ctx;
  let corpo: { id_int?: unknown; chat_id?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return erro("Corpo da requisição inválido.", 400);
  }
  const idInt = idDoPedido(corpo?.id_int);
  const chatId = limpar(corpo?.chat_id, 80);
  if (!idInt || !chatId) return erro("Pedido ou conversa inválidos.", 400);

  const p = await proposta(ctx.usuario, idInt);
  if ("erro" in p) return erro(p.erro ?? "Falha.", p.status ?? 500);
  const conversas = await conversasDoCliente(ctx.servico, p.dados.id_cliente);
  if (conversas === null) return erro("Não foi possível ler as conversas do cliente no ChatGuru.", 503);
  const conversa = conversas.find((c) => c.chat_id === chatId);
  if (!conversa) return erro("Esta conversa não é do cliente da proposta no ChatGuru. Abra a lista de novo.", 409);

  const { data, error } = await ctx.usuario
    .from("propostas")
    .update({ chatguru_chat_id: conversa.chat_id })
    .eq("id_int", idInt)
    .select("id_int");
  if (error) return erro(error.message || "Não foi possível gravar a conversa na proposta.", 500);
  if (!data || data.length === 0) return erro("A proposta não aceitou a gravação.", 403);
  return NextResponse.json({ success: true, conversa });
}
