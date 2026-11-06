/**
 * Aviso "pedido pronto" pelo WhatsApp da Ideal (ChatGuru) — Expedição (06/11/2026).
 *
 * POST { acao, ... } com o JWT do usuário do Vibe:
 *   listar   { ids: number[] }               último aviso de cada pedido (expedicao.view)
 *   enviar   { id_int }                       1º aviso; se já existe um, devolve o que existe e NÃO envia
 *   reenviar { id_int, seq_atual, confirmado } nova reserva, só com confirmação da tentativa vista
 *   status   { id_int }                       consulta message_status no ChatGuru
 * enviar/reenviar/status exigem expedicao.processar (ou ADM).
 *
 * Mesmo padrão da integração do Imposition (painel/_compartilhado/whatsapp_artes.ts):
 * POST form-urlencoded, action=message_send, 20 s, redirect "error"; aceite =
 * HTTP 2xx + result success + code 201 + message_id. Reserva no banco ANTES do
 * POST; depois da reserva o POST nunca se repete sozinho. Sem chat_add.
 *
 * Pedido e contato são relidos aqui, na hora. O destino é propostas.id_contato,
 * que precisa pertencer ao cliente ou ao faturado do pedido.
 *
 * MODO TESTE: ligado enquanto CHATGURU_PEDIDO_PRONTO_MODO_TESTE não for
 * "desligado". Ligado, todo destino vira o número de teste (cliente #14) e
 * qualquer outro número é recusado.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  Recusa,
  destinoFinal,
  envioAceito,
  envioRecusado,
  formaDeEnvio,
  limpar,
  linhasDeItens,
  modoTesteLigado,
  montarMensagem,
  telefoneWhatsApp,
  type ItemPedido
} from "./logica.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function responder(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false }
});

type Registro = {
  id: string;
  id_int: number;
  seq: number;
  estado: string;
  message_id: string | null;
  modo_teste: boolean;
  autor_nome: string | null;
  criado_em: string;
  atualizado_em: string;
};

const COLUNAS = "id, id_int, seq, estado, message_id, modo_teste, autor_nome, criado_em, atualizado_em";

function publico(r: Registro | null) {
  if (!r) return null;
  return {
    seq: r.seq,
    estado: r.estado,
    message_id: r.message_id,
    modo_teste: r.modo_teste,
    autor_nome: r.autor_nome,
    criado_em: r.criado_em,
    atualizado_em: r.atualizado_em
  };
}

async function ultimoRegistro(idInt: number): Promise<Registro | null> {
  const { data, error } = await admin
    .from("expedicao_aviso_pronto")
    .select(COLUNAS)
    .eq("id_int", idInt)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Recusa(503, "Não foi possível ler o aviso no banco. Tente de novo.");
  return (data as Registro | null) ?? null;
}

/** Usuário do Vibe pelo JWT + as permissões da Expedição (mesma regra da tela). */
async function quemChama(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new Recusa(401, "Sessão não encontrada. Faça login novamente.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Recusa(401, "Sessão expirada. Faça login novamente.");

  const { data: u } = await admin
    .from("usuarios")
    .select("nome_usuario, email, id_perfil, is_admin, is_super_adm")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!u) throw new Recusa(403, "Usuário sem cadastro no Vibe.");

  let permissoes: string[] = [];
  if (u.id_perfil != null) {
    const { data: perfil } = await admin
      .from("perfis")
      .select("permissoes")
      .eq("id", u.id_perfil)
      .eq("ativo", true)
      .maybeSingle();
    permissoes = Array.isArray(perfil?.permissoes) ? perfil.permissoes : [];
  }
  const adm = Boolean(u.is_super_adm || u.is_admin);
  const tem = (codigo: string) => adm || permissoes.includes("*") || permissoes.includes(codigo);
  return {
    id: data.user.id,
    nome: limpar(u.nome_usuario) || limpar(u.email) || "Usuário",
    podeVer: tem("expedicao.view") || tem("expedicao.processar"),
    podeOperar: tem("expedicao.processar")
  };
}

/** Relê pedido, contato, itens e frete na hora do envio. */
async function contextoDoPedido(idInt: number) {
  const { data: p, error } = await admin
    .from("propostas")
    .select("id_int, id_cliente, id_faturado, id_contato, status_interno, modalidade_frete, id_transportadora_cliente")
    .eq("id_int", idInt)
    .maybeSingle();
  if (error) throw new Recusa(503, "Não foi possível ler o pedido. Tente de novo.");
  if (!p) throw new Recusa(404, `Pedido ${idInt} não encontrado.`);
  if ((p.status_interno ?? "").toUpperCase() !== "EXPEDICAO") {
    throw new Recusa(409, `O pedido ${idInt} não está pronto para expedir (status ${p.status_interno ?? "vazio"}).`);
  }

  const idContato = Number(String(p.id_contato ?? "").trim());
  if (!Number.isInteger(idContato) || idContato <= 0) {
    throw new Recusa(422, "O pedido não tem contato. Escolha o contato na proposta.");
  }
  const { data: contato } = await admin
    .from("contatos")
    .select("id, id_cliente, nome_contato, whats, ativo")
    .eq("id", idContato)
    .maybeSingle();
  if (!contato) throw new Recusa(422, "O contato do pedido não existe mais no cadastro.");
  if (contato.ativo === false) throw new Recusa(422, "O contato do pedido está inativo no cadastro.");
  const donos = [Number(p.id_cliente), Number(p.id_faturado)].filter((n) => Number.isFinite(n) && n > 0);
  if (!donos.includes(Number(contato.id_cliente))) {
    throw new Recusa(409, "O contato do pedido não pertence ao cliente nem ao faturado. Corrija o contato na proposta.");
  }

  const [itensRes, expRes, cotRes] = await Promise.all([
    admin.from("produtos_proposta").select("nome_produto, qtd, status_item").eq("id_int", idInt).order("id"),
    admin
      .from("expedicoes")
      .select("modalidade_frete, tipo_frete, transportadora_nome, id_transportadora_cliente")
      .eq("id_int", idInt)
      .maybeSingle(),
    admin.from("cotacao_frete").select("servico").eq("id_int", idInt).eq("escolhido", true).limit(1).maybeSingle()
  ]);
  if (itensRes.error) throw new Recusa(503, "Não foi possível ler os itens do pedido.");
  const itens = linhasDeItens((itensRes.data ?? []) as ItemPedido[]);
  if (itens.length === 0) throw new Recusa(422, "O pedido não tem itens ativos.");

  const idTransp = Number(expRes.data?.id_transportadora_cliente ?? p.id_transportadora_cliente);
  let nomeTransp: string | null = null;
  if (Number.isFinite(idTransp) && idTransp > 0) {
    const { data: t } = await admin.from("clientes").select("nome, fantasia").eq("id_cliente", idTransp).maybeSingle();
    nomeTransp = limpar(t?.fantasia) || limpar(t?.nome) || null;
  }

  const forma = formaDeEnvio({
    expedicao: expRes.data ?? null,
    modalidadeOrcamento: p.modalidade_frete ?? null,
    servicoCotacao: cotRes.data?.servico ?? null,
    nomeTransportadoraCadastro: nomeTransp
  });

  return { idContato, contato, texto: montarMensagem({ nomeContato: contato.nome_contato ?? "", idInt, itens, formaEnvio: forma }) };
}

function configChatGuru() {
  const endpoint = env("CHATGURU_ENDPOINT");
  const key = env("CHATGURU_KEY");
  const account = env("CHATGURU_ACCOUNT_ID");
  const phone = env("CHATGURU_PHONE_ID");
  if (!/^https:\/\/(?:[a-z0-9-]+\.chatguru\.app|app\.zap\.guru)\/api\/v1\/?$/.test(endpoint) || !key || !account || !phone) {
    throw new Recusa(503, "Integração com o ChatGuru não configurada.");
  }
  return { endpoint, key, account, phone, ddi: env("CHATGURU_DEFAULT_DDI") };
}

async function chamarChatGuru(cfg: ReturnType<typeof configChatGuru>, action: string, extra: Record<string, string>) {
  const resposta = await fetch(cfg.endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: cfg.key, account_id: cfg.account, phone_id: cfg.phone, action, ...extra })
  });
  const data = await resposta.json();
  return { http: resposta.status, data };
}

/** Grava o resultado SÓ na reserva que este pedido criou e que ainda está em 'preparando'. */
async function salvar(idReserva: string, estado: string, messageId: string | null): Promise<Registro> {
  const { data, error } = await admin
    .from("expedicao_aviso_pronto")
    .update({ estado, message_id: messageId, atualizado_em: new Date().toISOString() })
    .eq("id", idReserva)
    .eq("estado", "preparando")
    .select(COLUNAS)
    .maybeSingle();
  if (error || !data) {
    throw new Recusa(503, "O ChatGuru respondeu, mas o resultado não foi gravado. Consulte o ChatGuru antes de tentar de novo.");
  }
  return data as Registro;
}

async function listar(ids: unknown) {
  const lista = Array.isArray(ids)
    ? Array.from(new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 1000)
    : [];
  const avisos: Record<number, ReturnType<typeof publico>> = {};
  for (let i = 0; i < lista.length; i += 200) {
    const { data, error } = await admin
      .from("expedicao_aviso_pronto")
      .select(COLUNAS)
      .in("id_int", lista.slice(i, i + 200))
      .order("seq", { ascending: false });
    if (error) throw new Recusa(503, "Não foi possível ler os avisos.");
    for (const r of (data ?? []) as Registro[]) {
      if (!avisos[r.id_int]) avisos[r.id_int] = publico(r);
    }
  }
  return avisos;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder(405, { ok: false, mensagem: "Use POST." });

  try {
    const quem = await quemChama(req);
    const corpo = await req.json().catch(() => ({}));
    const acao = String(corpo?.acao ?? "");
    const modoTeste = modoTesteLigado(Deno.env.get("CHATGURU_PEDIDO_PRONTO_MODO_TESTE"));

    if (acao === "listar") {
      if (!quem.podeVer) throw new Recusa(403, "Sem permissão da Expedição.");
      return responder(200, { ok: true, modo_teste: modoTeste, avisos: await listar(corpo?.ids) });
    }

    if (!["enviar", "reenviar", "status"].includes(acao)) throw new Recusa(400, "Ação inválida.");
    if (!quem.podeOperar) throw new Recusa(403, "Sem permissão para operar a Expedição (expedicao.processar).");
    const idInt = Number(corpo?.id_int);
    if (!Number.isInteger(idInt) || idInt <= 0) throw new Recusa(400, "Pedido inválido.");

    const ultimo = await ultimoRegistro(idInt);

    if (acao === "status") {
      if (!ultimo?.message_id || ultimo.estado === "enviado") {
        return responder(200, { ok: true, modo_teste: modoTeste, aviso: publico(ultimo) });
      }
      const cfg = configChatGuru();
      let atual = ultimo;
      try {
        const { http, data } = await chamarChatGuru(cfg, "message_status", { message_id: ultimo.message_id });
        if (http >= 200 && http < 300 && data?.result === "success" && Number(data?.code) === 200 && data?.message_status === "sent") {
          const { data: up } = await admin
            .from("expedicao_aviso_pronto")
            .update({ estado: "enviado", atualizado_em: new Date().toISOString() })
            .eq("id", ultimo.id)
            .eq("message_id", ultimo.message_id)
            .select(COLUNAS)
            .maybeSingle();
          if (up) atual = up as Registro;
        }
        return responder(200, {
          ok: true,
          modo_teste: modoTeste,
          aviso: publico(atual),
          status_chatguru: typeof data?.message_status === "string" ? data.message_status.slice(0, 40) : null
        });
      } catch {
        throw new Recusa(502, "Não foi possível consultar o ChatGuru. Nada foi reenviado.");
      }
    }

    // enviar: se já houve aviso, devolve o que existe. Nunca envia de novo sem "reenviar".
    if (acao === "enviar" && ultimo) {
      return responder(200, { ok: true, modo_teste: modoTeste, ja_existia: true, aviso: publico(ultimo) });
    }
    if (acao === "reenviar") {
      if (!ultimo) throw new Recusa(409, "Este pedido ainda não teve aviso. Use Avisar cliente.");
      if (corpo?.confirmado !== true || Number(corpo?.seq_atual) !== ultimo.seq) {
        throw new Recusa(409, "O aviso mudou desde que a tela abriu. Atualize e confirme de novo.");
      }
      if (ultimo.estado === "preparando") throw new Recusa(409, "Já há um envio em andamento para este pedido.");
    }

    const ctx = await contextoDoPedido(idInt);
    const cfg = configChatGuru();
    const numeroContato = telefoneWhatsApp(ctx.contato.whats, cfg.ddi);
    const destino = destinoFinal(numeroContato, modoTeste);

    const { data: reserva, error: errReserva } = await admin.rpc("expedicao_aviso_pronto_reservar", {
      p_id_int: idInt,
      p_seq_atual: ultimo?.seq ?? 0,
      p_id_contato: ctx.idContato,
      p_modo_teste: modoTeste,
      p_autor: quem.id,
      p_autor_nome: quem.nome
    });
    if (errReserva) throw new Recusa(503, "Não foi possível reservar o envio. Nada foi enviado.");
    if (!reserva) {
      return responder(200, { ok: true, modo_teste: modoTeste, ja_existia: true, aviso: publico(await ultimoRegistro(idInt)) });
    }

    // Daqui em diante o POST ao ChatGuru nunca se repete automaticamente.
    let resultado: Registro;
    try {
      const { http, data } = await chamarChatGuru(cfg, "message_send", { chat_number: destino, text: ctx.texto });
      const messageId = envioAceito(http, data);
      if (messageId) {
        resultado = await salvar(String(reserva), data?.message_status === "sent" ? "enviado" : "aguardando", messageId);
      } else {
        resultado = await salvar(String(reserva), envioRecusado(http, data) ? "falhou" : "desconhecido", null);
      }
    } catch (e) {
      if (e instanceof Recusa) throw e;
      resultado = await salvar(String(reserva), "desconhecido", null);
    }

    return responder(200, { ok: true, modo_teste: modoTeste, ja_existia: false, aviso: publico(resultado) });
  } catch (e) {
    if (e instanceof Recusa) return responder(e.status, { ok: false, mensagem: e.message });
    console.error("[expedicao-pedido-pronto]", e instanceof Error ? e.message : "erro");
    return responder(500, { ok: false, mensagem: "Erro inesperado. Consulte o status antes de tentar de novo." });
  }
});
