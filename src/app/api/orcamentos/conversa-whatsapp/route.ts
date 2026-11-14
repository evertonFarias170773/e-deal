import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  escolhaDeContatos,
  mesmoTelefone,
  numeroDaConversa,
  type ContatoEscolhido,
  type ConversaWhatsapp
} from "@/features/orcamentos/lib/conversa-whatsapp";
import { telefoneParaApi } from "@/lib/telefone/telefone-br";

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
 * PONTE COM O CONTATO DO PEDIDO: os avisos do ChatGuru (função
 * expedicao-pedido-pronto, que não muda nesta rodada) recusam pedido sem
 * `propostas.id_contato` ativo do cliente. Ao gravar a principal, se o pedido não
 * tem um contato válido, ele passa a apontar para o contato do cliente com o
 * mesmo telefone da principal; sem nenhum, o contato é criado a partir da
 * conversa (nome e telefone do Guru). Contato válido que já existe fica.
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

function limpar(texto: unknown, max = 150): string {
  if (typeof texto !== "string") return "";
  return texto.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
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

type PropostaDaConversa = {
  id_int: number;
  id_cliente: number | string | null;
  chatguru_chat_id: string | null;
  id_contato: string | null;
};

/** A proposta pela sessão do usuário: se a RLS não a mostra, não há conversa para ver. */
async function proposta(usuario: SupabaseClient, idInt: number) {
  const { data, error } = await usuario
    .from("propostas")
    .select("id_int, id_cliente, chatguru_chat_id, id_contato")
    .eq("id_int", idInt)
    .maybeSingle();
  if (error) return { erro: "Não foi possível ler a proposta.", status: 500 } as const;
  if (!data) return { erro: `Proposta #${idInt} não encontrada.`, status: 404 } as const;
  return { dados: data as PropostaDaConversa } as const;
}

/** As conversas escolhidas do pedido (linhas da tabela), pela sessão do usuário. */
async function escolhidasDoPedido(usuario: SupabaseClient, idInt: number) {
  const { data, error } = await usuario
    .from("propostas_contatos_chatguru")
    .select("chat_id, nome, telefone, principal")
    .eq("id_int", idInt)
    .order("principal", { ascending: false })
    .order("escolhido_em", { ascending: true });
  if (error) return null;
  return (data ?? []) as { chat_id: string; nome: string | null; telefone: string | null; principal: boolean }[];
}

/**
 * Ponte com o contato do pedido (ver o topo): devolve o contato que o pedido deve
 * ter, ou null quando o atual já serve. Escrita só no insert do contato novo.
 */
async function contatoParaAPrincipal(
  usuario: SupabaseClient,
  idCliente: number,
  principal: ConversaWhatsapp,
  idContatoAtual: string | null
): Promise<{ id: number; nome: string } | null | { erro: string }> {
  const { data, error } = await usuario
    .from("contatos")
    .select("id, nome_contato, whats, ativo")
    .eq("id_cliente", idCliente);
  if (error) return { erro: "Não foi possível ler os contatos do cliente." };
  const ativos = ((data ?? []) as { id: number; nome_contato: string | null; whats: string | null; ativo: boolean | null }[])
    .filter((c) => c.ativo !== false);
  const atual = ativos.find((c) => String(c.id) === String(idContatoAtual ?? "").trim());
  if (atual) return null;
  const doTelefone = ativos.find((c) => mesmoTelefone(c.whats, principal.numero));
  if (doTelefone) return { id: doTelefone.id, nome: limpar(doTelefone.nome_contato) || principal.nome };
  const { data: criado, error: erroCriar } = await usuario
    .from("contatos")
    .insert({ id_cliente: idCliente, nome_contato: principal.nome, whats: telefoneParaApi(principal.numero) || principal.numero, ativo: true })
    .select("id")
    .single();
  if (erroCriar || !criado) return { erro: "Não foi possível criar o contato do pedido a partir da conversa." };
  return { id: Number((criado as { id: number }).id), nome: principal.nome };
}

/**
 * Grava a escolha: linhas da tabela (insere as novas, apaga as que saíram, uma
 * principal) e, na proposta, `chatguru_chat_id` = principal e a ponte do contato.
 * A ordem deixa o pedido sempre com no máximo uma principal (índice único).
 */
async function gravarEscolha(
  ctx: Contexto,
  dados: PropostaDaConversa,
  conversas: ConversaWhatsapp[],
  escolha: { chatIds: string[]; principal: string }
): Promise<{ escolhidas: ContatoEscolhido[] } | { erro: string; status: number }> {
  const idInt = dados.id_int;
  const porId = new Map(conversas.map((c) => [c.chat_id, c]));
  const atuais = await escolhidasDoPedido(ctx.usuario, idInt);
  if (atuais === null) return { erro: "Não foi possível ler os contatos do pedido.", status: 500 };

  const novas = escolha.chatIds.filter((id) => !atuais.some((a) => a.chat_id === id));
  if (novas.length > 0) {
    const { error } = await ctx.usuario.from("propostas_contatos_chatguru").insert(
      novas.map((id) => ({
        id_int: idInt,
        chat_id: id,
        nome: porId.get(id)?.nome ?? null,
        telefone: porId.get(id)?.numero ?? null,
        principal: false,
        escolhido_por: ctx.uid,
        escolhido_por_nome: ctx.quem
      }))
    );
    if (error) return { erro: error.message || "Não foi possível gravar os contatos do pedido.", status: 500 };
  }
  const saem = atuais.filter((a) => !escolha.chatIds.includes(a.chat_id)).map((a) => a.chat_id);
  if (saem.length > 0) {
    const { error } = await ctx.usuario.from("propostas_contatos_chatguru").delete().eq("id_int", idInt).in("chat_id", saem);
    if (error) return { erro: error.message || "Não foi possível tirar contatos do pedido.", status: 500 };
  }
  const tirar = await ctx.usuario
    .from("propostas_contatos_chatguru")
    .update({ principal: false })
    .eq("id_int", idInt)
    .eq("principal", true)
    .neq("chat_id", escolha.principal);
  if (tirar.error) return { erro: tirar.error.message || "Não foi possível trocar o contato principal.", status: 500 };
  const marcar = await ctx.usuario
    .from("propostas_contatos_chatguru")
    .update({ principal: true })
    .eq("id_int", idInt)
    .eq("chat_id", escolha.principal);
  if (marcar.error) return { erro: marcar.error.message || "Não foi possível marcar o contato principal.", status: 500 };

  const principal = porId.get(escolha.principal)!;
  const atualizacao: Record<string, unknown> = { chatguru_chat_id: principal.chat_id };
  const idCliente = Number(dados.id_cliente);
  if (Number.isInteger(idCliente) && idCliente > 0) {
    const contato = await contatoParaAPrincipal(ctx.usuario, idCliente, principal, dados.id_contato);
    if (contato && "erro" in contato) return { erro: contato.erro, status: 500 };
    if (contato) {
      atualizacao.id_contato = String(contato.id);
      atualizacao.contato = contato.nome;
    }
  }
  const { data, error } = await ctx.usuario.from("propostas").update(atualizacao).eq("id_int", idInt).select("id_int");
  if (error) return { erro: error.message || "Não foi possível gravar a conversa na proposta.", status: 500 };
  if (!data || data.length === 0) return { erro: "A proposta não aceitou a gravação.", status: 403 };

  return {
    escolhidas: escolha.chatIds.map((id) => ({ ...porId.get(id)!, principal: id === escolha.principal }))
  };
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
