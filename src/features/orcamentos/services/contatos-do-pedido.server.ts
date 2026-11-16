import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  mesmoTelefone,
  numeroDaConversa,
  type ContatoEscolhido,
  type ConversaWhatsapp
} from "@/features/orcamentos/lib/conversa-whatsapp";

/*
 * Contatos do pedido pelo ChatGuru — o lado do servidor (14/11/2026, decisão da
 * diretoria). Saiu da rota /api/orcamentos/conversa-whatsapp em 16/11/2026 para
 * a liberação para produção usar a MESMA gravação.
 *
 * O pedido guarda UMA OU MAIS conversas em `propostas_contatos_chatguru`, uma
 * delas a principal, espelhada em `propostas.chatguru_chat_id`.
 *
 * CONTATO DO CADASTRO: ao gravar a principal, se o pedido não tem um contato
 * válido, ele passa a apontar para o contato ativo do cliente com o mesmo
 * telefone da principal. Sem nenhum, o pedido fica sem contato: nada aqui cria
 * linha em `contatos`. Contato válido que já existe fica.
 *
 * A visão do Guru (`chatguru_contatos_3478`) só é lida com a chave de serviço.
 * A gravação é com o client de quem chamou: a RLS e a autoria continuam valendo.
 */

export function limpar(texto: unknown, max = 150): string {
  if (typeof texto !== "string") return "";
  return texto.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Quem grava: o client (sessão do usuário ou serviço) e a autoria da linha. */
export type AutorDaGravacao = { usuario: SupabaseClient; uid: string | null; quem: string };

export type PropostaDaConversa = {
  id_int: number;
  id_cliente: number | string | null;
  chatguru_chat_id: string | null;
  id_contato: string | null;
};

export type LinhaEscolhida = { chat_id: string; nome: string | null; telefone: string | null; principal: boolean };

/** A proposta pelo client de quem chamou: se a RLS não a mostra, não há conversa para ver. */
export async function lerPropostaDaConversa(usuario: SupabaseClient, idInt: number) {
  const { data, error } = await usuario
    .from("propostas")
    .select("id_int, id_cliente, chatguru_chat_id, id_contato")
    .eq("id_int", idInt)
    .maybeSingle();
  if (error) return { erro: "Não foi possível ler a proposta.", status: 500 } as const;
  if (!data) return { erro: `Proposta #${idInt} não encontrada.`, status: 404 } as const;
  return { dados: data as PropostaDaConversa } as const;
}

/** As conversas escolhidas do pedido (linhas da tabela). null = falha de leitura. */
export async function escolhidasDoPedido(usuario: SupabaseClient, idInt: number): Promise<LinhaEscolhida[] | null> {
  const { data, error } = await usuario
    .from("propostas_contatos_chatguru")
    .select("chat_id, nome, telefone, principal")
    .eq("id_int", idInt)
    .order("principal", { ascending: false })
    .order("escolhido_em", { ascending: true });
  if (error) return null;
  return (data ?? []) as LinhaEscolhida[];
}

/** Client com a chave de serviço, só para ler a visão do Guru. null = ambiente sem a chave. */
export function clienteDeServico(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createSupabaseClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Conversas do remetente 3478 do cliente, com a regra de número da lista
 * (`numeroDaConversa`: 55 + DDD ou número estrangeiro, 084ba9c5). null = falha.
 */
export async function conversasDoCliente(servico: SupabaseClient, idCliente: unknown): Promise<ConversaWhatsapp[] | null> {
  const id = Number(idCliente);
  if (!Number.isInteger(id) || id <= 0) return [];
  const { data, error } = await servico
    .from("chatguru_contatos_3478")
    .select("chat_id, nome_chatguru, telefone_normalizado")
    .eq("codigo_cliente", String(id))
    .limit(50);
  if (error) {
    console.error("[ContatosDoPedido] leitura do Guru:", error.message);
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

/**
 * Ponte com o contato do pedido (ver o topo): devolve o contato que o pedido deve
 * ter, ou null quando o atual já serve ou não há contato do mesmo telefone.
 * Só lê a tabela contatos; nunca grava nela.
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
  // Sem contato com o mesmo telefone: o pedido fica como está. A tabela contatos
  // não recebe nada daqui (14/11/2026); a v28 dos avisos aceita a principal sem contato.
  return null;
}

/**
 * Grava a escolha: linhas da tabela (insere as novas, apaga as que saíram, uma
 * principal) e, na proposta, `chatguru_chat_id` = principal e a ponte do contato.
 * A ordem deixa o pedido sempre com no máximo uma principal (índice único).
 */
export async function gravarEscolha(
  autor: AutorDaGravacao,
  dados: PropostaDaConversa,
  conversas: ConversaWhatsapp[],
  escolha: { chatIds: string[]; principal: string }
): Promise<{ escolhidas: ContatoEscolhido[] } | { erro: string; status: number }> {
  const { usuario } = autor;
  const idInt = dados.id_int;
  const porId = new Map(conversas.map((c) => [c.chat_id, c]));
  const atuais = await escolhidasDoPedido(usuario, idInt);
  if (atuais === null) return { erro: "Não foi possível ler os contatos do pedido.", status: 500 };

  const novas = escolha.chatIds.filter((id) => !atuais.some((a) => a.chat_id === id));
  if (novas.length > 0) {
    const { error } = await usuario.from("propostas_contatos_chatguru").insert(
      novas.map((id) => ({
        id_int: idInt,
        chat_id: id,
        nome: porId.get(id)?.nome ?? null,
        telefone: porId.get(id)?.numero ?? null,
        principal: false,
        escolhido_por: autor.uid || null,
        escolhido_por_nome: autor.quem
      }))
    );
    if (error) return { erro: error.message || "Não foi possível gravar os contatos do pedido.", status: 500 };
  }
  const saem = atuais.filter((a) => !escolha.chatIds.includes(a.chat_id)).map((a) => a.chat_id);
  if (saem.length > 0) {
    const { error } = await usuario.from("propostas_contatos_chatguru").delete().eq("id_int", idInt).in("chat_id", saem);
    if (error) return { erro: error.message || "Não foi possível tirar contatos do pedido.", status: 500 };
  }
  const tirar = await usuario
    .from("propostas_contatos_chatguru")
    .update({ principal: false })
    .eq("id_int", idInt)
    .eq("principal", true)
    .neq("chat_id", escolha.principal);
  if (tirar.error) return { erro: tirar.error.message || "Não foi possível trocar o contato principal.", status: 500 };
  const marcar = await usuario
    .from("propostas_contatos_chatguru")
    .update({ principal: true })
    .eq("id_int", idInt)
    .eq("chat_id", escolha.principal);
  if (marcar.error) return { erro: marcar.error.message || "Não foi possível marcar o contato principal.", status: 500 };

  const principal = porId.get(escolha.principal)!;
  const atualizacao: Record<string, unknown> = { chatguru_chat_id: principal.chat_id };
  const idCliente = Number(dados.id_cliente);
  if (Number.isInteger(idCliente) && idCliente > 0) {
    const contato = await contatoParaAPrincipal(usuario, idCliente, principal, dados.id_contato);
    if (contato && "erro" in contato) return { erro: contato.erro, status: 500 };
    if (contato) {
      atualizacao.id_contato = String(contato.id);
      atualizacao.contato = contato.nome;
    }
  }
  const { data, error } = await usuario.from("propostas").update(atualizacao).eq("id_int", idInt).select("id_int");
  if (error) return { erro: error.message || "Não foi possível gravar a conversa na proposta.", status: 500 };
  if (!data || data.length === 0) return { erro: "A proposta não aceitou a gravação.", status: 403 };

  return {
    escolhidas: escolha.chatIds.map((id) => ({ ...porId.get(id)!, principal: id === escolha.principal }))
  };
}

/** O que a liberação faz com a conversa que a tela pré-marca. */
export type ConversaUnica =
  | { situacao: "ja_gravada" }
  | { situacao: "gravada_agora"; conversa: ConversaWhatsapp }
  | { situacao: "sem_unica"; conversas: number }
  | { situacao: "falha"; erro: string };

/**
 * Pedido sem contato gravado (nem linha, nem `chatguru_chat_id`) e cliente com
 * UMA conversa no Guru: é a conversa que a aba Geral mostra marcada como
 * principal ("única conversa") e a que os avisos usam sozinhos. A liberação a
 * grava como principal, pela mesma `gravarEscolha` do Salvar, em vez de recusar
 * (16/11/2026, caso 25289). Com duas ou mais conversas, ou nenhuma, nada é
 * gravado: alguém precisa escolher na aba Geral.
 *
 * `apenasConferir`: não grava; diz o que faria (prova sem escrita).
 */
export async function gravarConversaUnicaSeFaltar(
  autor: AutorDaGravacao,
  idInt: number,
  opcoes: { apenasConferir?: boolean; servico?: SupabaseClient | null } = {}
): Promise<ConversaUnica> {
  const p = await lerPropostaDaConversa(autor.usuario, idInt);
  if ("erro" in p) return { situacao: "falha", erro: p.erro ?? "Falha ao ler a proposta." };
  if (limpar(p.dados.chatguru_chat_id, 80)) return { situacao: "ja_gravada" };
  const linhas = await escolhidasDoPedido(autor.usuario, idInt);
  if (linhas === null) return { situacao: "falha", erro: "Não foi possível ler os contatos do pedido." };
  if (linhas.length > 0) return { situacao: "ja_gravada" };

  const servico = opcoes.servico ?? clienteDeServico();
  if (!servico) return { situacao: "falha", erro: "Sem acesso às conversas do ChatGuru neste servidor." };
  const conversas = await conversasDoCliente(servico, p.dados.id_cliente);
  if (conversas === null) return { situacao: "falha", erro: "Não foi possível ler as conversas do cliente no ChatGuru." };
  if (conversas.length !== 1) return { situacao: "sem_unica", conversas: conversas.length };

  const unica = conversas[0];
  if (opcoes.apenasConferir) return { situacao: "gravada_agora", conversa: unica };
  const r = await gravarEscolha(autor, p.dados, conversas, { chatIds: [unica.chat_id], principal: unica.chat_id });
  if ("erro" in r) return { situacao: "falha", erro: r.erro };
  return { situacao: "gravada_agora", conversa: unica };
}

/**
 * O callback que `liberarPropostaParaProducao` recebe do servidor: true = o
 * pedido tem (ou passou a ter) contato; false = precisa escolher; null = falha.
 */
export function contatoUnicoNaLiberacao(autor: AutorDaGravacao, opcoes: { apenasConferir?: boolean } = {}) {
  return async (idInt: number): Promise<boolean | null> => {
    const r = await gravarConversaUnicaSeFaltar(autor, idInt, opcoes);
    if (r.situacao === "falha") {
      console.error(`[ContatosDoPedido] liberação #${idInt}: ${r.erro}`);
      return null;
    }
    return r.situacao !== "sem_unica";
  };
}
