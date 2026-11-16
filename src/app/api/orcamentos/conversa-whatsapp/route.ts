import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { escolhaDeContatos } from "@/features/orcamentos/lib/conversa-whatsapp";
import {
  conversasDoCliente,
  escolhidasDoPedido,
  gravarEscolha,
  lerPropostaDaConversa as proposta,
  limpar
} from "@/features/orcamentos/services/contatos-do-pedido.server";

/*
 * Contatos do pedido pelo ChatGuru (14/11/2026, decisão da diretoria): o pedido
 * guarda UMA OU MAIS conversas em `propostas_contatos_chatguru`, uma delas a
 * principal. A principal é o Comprador da aba Artes e é espelhada em
 * `propostas.chatguru_chat_id` nesta mesma gravação.
 *
 * GET devolve também `escolhidas` (as linhas do pedido; pedido antigo sem linha e
 * com `chatguru_chat_id` volta essa conversa como principal).
 * POST aceita {id_int, chat_ids, principal} (a escolha inteira, aba Geral) ou
 * {id_int, chat_id} (só a principal, aba Artes: as outras ficam).
 *
 * CONTATO DO CADASTRO: ao gravar a principal, se o pedido não tem um contato
 * válido, ele passa a apontar para o contato ativo do cliente com o mesmo
 * telefone da principal. Sem nenhum, o pedido fica sem contato: esta rota NUNCA
 * cria linha em `contatos` (14/11/2026; a v28 da expedicao-pedido-pronto aceita
 * a principal sem `id_contato`). Contato válido que já existe fica.
 */

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

type Contexto = { usuario: SupabaseClient; servico: SupabaseClient; uid: string; quem: string };

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
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const quem = limpar(meta.name ?? meta.nome ?? data.user.email ?? "", 120) || "Usuário";
  return { usuario, servico, uid: data.user.id, quem };
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
  let linhas: { chat_id: string; principal: boolean }[] = [];
  if (idInt) {
    const p = await proposta(ctx.usuario, idInt);
    if ("erro" in p) return erro(p.erro ?? "Falha.", p.status ?? 500);
    const gravado = idDoPedido(p.dados.id_cliente);
    clienteDaProposta = gravado !== null && (idClienteTela === null || idClienteTela === gravado);
    if (clienteDaProposta) {
      idCliente = gravado;
      chatIdGravado = limpar(p.dados.chatguru_chat_id, 80) || null;
      const escolhidas = await escolhidasDoPedido(ctx.usuario, idInt);
      if (escolhidas === null) return erro("Não foi possível ler os contatos do pedido.", 500);
      linhas = escolhidas;
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

  // Pedido antigo sem linha na tabela: a conversa de chatguru_chat_id é a principal.
  const escolhidas =
    linhas.length > 0
      ? linhas.map((l) => ({ chat_id: l.chat_id, principal: l.principal }))
      : chatIdGravado
        ? [{ chat_id: chatIdGravado, principal: true }]
        : [];

  return NextResponse.json({ success: true, conversas, chatIdGravado, escolhidas, statusArte, clienteDaProposta });
}

export async function POST(request: Request) {
  const ctx = await contexto(request);
  if (ctx instanceof NextResponse) return ctx;
  let corpo: { id_int?: unknown; chat_id?: unknown; chat_ids?: unknown; principal?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return erro("Corpo da requisição inválido.", 400);
  }
  const idInt = idDoPedido(corpo?.id_int);
  if (!idInt) return erro("Pedido inválido.", 400);

  const p = await proposta(ctx.usuario, idInt);
  if ("erro" in p) return erro(p.erro ?? "Falha.", p.status ?? 500);
  const conversas = await conversasDoCliente(ctx.servico, p.dados.id_cliente);
  if (conversas === null) return erro("Não foi possível ler as conversas do cliente no ChatGuru.", 503);

  let pedidos: string[];
  let principalPedida: string;
  if (Array.isArray(corpo?.chat_ids)) {
    // Escolha inteira (aba Geral).
    pedidos = corpo.chat_ids.map((c) => limpar(c, 80)).filter(Boolean);
    principalPedida = limpar(corpo?.principal, 80);
  } else {
    // Só a principal (aba Artes): as outras escolhidas ficam.
    principalPedida = limpar(corpo?.chat_id, 80);
    if (!principalPedida) return erro("Pedido ou conversa inválidos.", 400);
    const atuais = await escolhidasDoPedido(ctx.usuario, idInt);
    if (atuais === null) return erro("Não foi possível ler os contatos do pedido.", 500);
    pedidos = [...atuais.map((a) => a.chat_id), principalPedida];
  }
  const escolha = escolhaDeContatos(pedidos, principalPedida);
  if (!escolha) return erro("Escolha pelo menos uma conversa do ChatGuru.", 400);
  const fora = escolha.chatIds.find((id) => !conversas.some((c) => c.chat_id === id));
  if (fora) return erro("Uma das conversas não é do cliente da proposta no ChatGuru. Abra a lista de novo.", 409);

  const r = await gravarEscolha(ctx, p.dados, conversas, escolha);
  if ("erro" in r) return erro(r.erro, r.status);
  const conversa = r.escolhidas.find((c) => c.principal)!;
  return NextResponse.json({ success: true, conversa, escolhidas: r.escolhidas });
}
