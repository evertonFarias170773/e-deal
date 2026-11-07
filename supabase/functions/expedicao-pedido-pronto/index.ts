/**
 * Aviso "pedido pronto" pelo WhatsApp da Ideal (ChatGuru) — Expedição.
 * 06/11/2026: message_send. 07/11/2026: diálogo com template aprovado (conta
 * WABA: texto livre só chega dentro da janela de 24 h).
 *
 * POST { acao, ... } com o JWT do usuário do Vibe:
 *   listar   { ids: number[] }               último aviso e o diálogo de cada pedido (expedicao.view)
 *   enviar   { id_int }                       1º aviso; se já existe um, devolve o que existe e NÃO envia
 *   reenviar { id_int, seq_atual, confirmado } nova reserva, só com confirmação da tentativa vista
 *   status   { id_int }                       message_status, só para avisos antigos (message_send)
 * enviar/reenviar/status exigem expedicao.processar (ou ADM).
 *
 * ENVIO POR DIÁLOGO (Guia "Envio de WhatsApp por diálogos ChatGuru", 07/11/2026):
 *   1. diálogo pela forma de envio (logica.escolherDialogo; despacho vence orçamento);
 *   2. reserva no banco ANTES de qualquer POST: por pedido (seq) e por conversa
 *      (destino_chave = SHA-256 de [endpoint, account, phone, número]);
 *   3. chat_update_custom_fields com os campos do diálogo (field__<Nome>); só segue
 *      com 2xx + success + code 200;
 *   4. dialog_execute com o dialog_id, mesma conta, remetente e conversa;
 *      sucesso = code 200 + "Diálogo executado" -> estado 'executado'.
 *   Não há message_id: nada é inventado e message_status não é consultado.
 *   Recusa explícita -> 'falhou' (libera a conversa). Qualquer incerteza ->
 *   'desconhecido' (a conversa fica travada até alguém conferir no ChatGuru).
 *   Depois da reserva nenhum POST se repete sozinho.
 *
 * Pedido e contato são relidos aqui, na hora. O destino é propostas.id_contato,
 * que precisa pertencer ao cliente ou ao faturado do pedido.
 *
 * MODO TESTE: ligado enquanto CHATGURU_PEDIDO_PRONTO_MODO_TESTE não for
 * "desligado". Ligado, só pedido do cliente #14 (e contato do cliente #14).
 *
 * Recusa do ChatGuru por número ("Chat não encontrado."): a resposta traz o
 * número enviado e o contato, para a tela oferecer "Corrigir número". Nada disso
 * é gravado. O Vibe não tenta outro formato sozinho.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DIALOGOS,
  Recusa,
  SEM_MODELO,
  camposAceitos,
  camposDoDialogo,
  chaveDaConversa,
  cidadeDestino,
  conferirModoTeste,
  dialogoExecutado,
  envioRecusado,
  escolherDialogo,
  limpar,
  modoTesteLigado,
  nomeDoDialogo,
  notaParaODialogo,
  rastreioCorreiosValido,
  recusaPorNumero,
  telefoneWhatsApp,
  type EscolhaDialogo
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
  dialogo_id: string | null;
  destino_chave: string | null;
  modo_teste: boolean;
  autor_nome: string | null;
  criado_em: string;
  atualizado_em: string;
};

const COLUNAS = "id, id_int, seq, estado, message_id, dialogo_id, destino_chave, modo_teste, autor_nome, criado_em, atualizado_em";

function publico(r: Registro | null) {
  if (!r) return null;
  return {
    seq: r.seq,
    estado: r.estado,
    message_id: r.message_id,
    dialogo: nomeDoDialogo(r.dialogo_id),
    // Aviso por diálogo em incerteza: a conversa fica travada para novos avisos.
    trava_conversa: r.estado === "desconhecido" && Boolean(r.destino_chave),
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

type Frete = {
  escolha: EscolhaDialogo;
  rastreio: string | null;
  idEndereco: string | null;
};

/**
 * Forma de envio e diálogo de cada pedido, em lote (o listar da tela e o envio
 * usam o mesmo caminho). Só leitura.
 */
async function fretesDosPedidos(ids: number[]): Promise<Map<number, Frete>> {
  const mapa = new Map<number, Frete>();
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const [propRes, expRes, cotRes] = await Promise.all([
      admin
        .from("propostas")
        .select("id_int, modalidade_frete, categoria_frete, id_transportadora_cliente, frete_escolhido, id_endereco_ent")
        .in("id_int", lote),
      admin
        .from("expedicoes")
        .select(
          "id_int, tipo_frete, modalidade_frete, categoria_frete, transportadora_nome, id_transportadora_cliente, id_endereco_entrega, codigo_rastreamento, correios_codigo_objeto, prepostagem_cancelada_em"
        )
        .in("id_int", lote),
      admin.from("cotacao_frete").select("id_int, servico, id").in("id_int", lote).eq("escolhido", true).order("id", { ascending: false })
    ]);
    if (propRes.error || expRes.error || cotRes.error) throw new Recusa(503, "Não foi possível ler a forma de envio dos pedidos.");

    const exps = new Map<number, Record<string, unknown>>();
    for (const e of expRes.data ?? []) if (!exps.has(Number(e.id_int))) exps.set(Number(e.id_int), e);
    const cots = new Map<number, string | null>();
    for (const c of cotRes.data ?? []) if (!cots.has(Number(c.id_int))) cots.set(Number(c.id_int), c.servico ?? null);

    const idsTransp = Array.from(
      new Set((propRes.data ?? []).map((p) => Number(p.id_transportadora_cliente)).filter((n) => Number.isFinite(n) && n > 0))
    );
    const nomes = new Map<number, string>();
    if (idsTransp.length) {
      const { data: ts } = await admin.from("clientes").select("id_cliente, nome, fantasia").in("id_cliente", idsTransp);
      for (const t of ts ?? []) nomes.set(Number(t.id_cliente), limpar(t.fantasia) || limpar(t.nome));
    }

    for (const p of propRes.data ?? []) {
      const idInt = Number(p.id_int);
      const e = exps.get(idInt) ?? null;
      const rastreio = e && !e.prepostagem_cancelada_em
        ? rastreioCorreiosValido(e.correios_codigo_objeto as string | null, e.codigo_rastreamento as string | null)
        : null;
      const escolha = escolherDialogo({
        despacho: e
          ? {
              tipo_frete: e.tipo_frete as string | null,
              modalidade_frete: e.modalidade_frete as string | null,
              categoria_frete: e.categoria_frete as string | null,
              transportadora_nome: e.transportadora_nome as string | null,
              id_transportadora_cliente: e.id_transportadora_cliente as number | null
            }
          : null,
        orcamento: {
          modalidade_frete: p.modalidade_frete,
          categoria_frete: p.categoria_frete,
          id_transportadora_cliente: p.id_transportadora_cliente,
          nomeTransportadora: nomes.get(Number(p.id_transportadora_cliente)) ?? null,
          servicoCotacao: cots.get(idInt) ?? p.frete_escolhido ?? null
        },
        rastreioCorreios: rastreio
      });
      const idEndereco = String((e?.id_endereco_entrega as string | null) ?? p.id_endereco_ent ?? "").trim() || null;
      mapa.set(idInt, { escolha, rastreio, idEndereco });
    }
  }
  return mapa;
}

/**
 * Nota do pedido para o diálogo. Faturado no sistema antigo (faturado_fora_em):
 * expedicoes.nf_numero_manual. Senão, a NF-e de venda ou NFS-e autorizada em
 * produção. Sem nota, "—".
 */
async function notaDoPedido(idInt: number): Promise<string> {
  const [prop, exp, nfe, nfse] = await Promise.all([
    admin.from("propostas").select("faturado_fora_em").eq("id_int", idInt).maybeSingle(),
    admin.from("expedicoes").select("nf_numero_manual").eq("id_int", idInt).limit(1).maybeSingle(),
    admin
      .from("notas_fiscais")
      .select("numero_nf, tipo_nota")
      .eq("id_int", idInt)
      .eq("status", "AUTORIZADA")
      .eq("ambiente", "producao"),
    admin.from("notas_servico").select("numero_nfse").eq("id_int", idInt).eq("status", "AUTORIZADA").eq("ambiente", "producao")
  ]);
  if (prop.error || exp.error || nfe.error || nfse.error) throw new Recusa(503, "Não foi possível ler a nota fiscal do pedido.");
  return notaParaODialogo({
    faturadoNoSistemaAntigo: Boolean(prop.data?.faturado_fora_em),
    nfNumeroManual: exp.data?.nf_numero_manual ?? null,
    numerosDoVibe: [
      ...(nfe.data ?? []).filter((n) => (n.tipo_nota ?? "").toUpperCase() !== "REMESSA").map((n) => n.numero_nf),
      ...(nfse.data ?? []).map((n) => n.numero_nfse)
    ]
  });
}

/** Relê pedido, contato, forma de envio, nota e cidade na hora do envio. */
async function contextoDoPedido(idInt: number, modoTeste: boolean) {
  const { data: p, error } = await admin
    .from("propostas")
    .select("id_int, id_cliente, id_faturado, id_contato, status_interno")
    .eq("id_int", idInt)
    .maybeSingle();
  if (error) throw new Recusa(503, "Não foi possível ler o pedido. Tente de novo.");
  if (!p) throw new Recusa(404, `Pedido ${idInt} não encontrado.`);
  if ((p.status_interno ?? "").toUpperCase() !== "EXPEDICAO") {
    throw new Recusa(409, `O pedido ${idInt} não está pronto para expedir (status ${p.status_interno ?? "vazio"}).`);
  }
  conferirModoTeste(modoTeste, p.id_cliente);

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
  conferirModoTeste(modoTeste, p.id_cliente, contato.id_cliente);

  const frete = (await fretesDosPedidos([idInt])).get(idInt);
  if (!frete?.escolha.dialogo) throw new Recusa(409, frete?.escolha.bloqueio ?? SEM_MODELO);
  if (frete.escolha.bloqueio) throw new Recusa(409, frete.escolha.bloqueio);
  const dialogo = frete.escolha.dialogo;

  let cidade: string | null = null;
  if (frete.idEndereco && /^[0-9a-f-]{36}$/i.test(frete.idEndereco)) {
    const { data: end } = await admin.from("enderecos").select("cidade, uf").eq("id", frete.idEndereco).maybeSingle();
    cidade = cidadeDestino(end?.cidade, end?.uf);
  }
  const campos = camposDoDialogo(dialogo, {
    idInt,
    notaFiscal: await notaDoPedido(idInt),
    cidadeDestino: cidade,
    rastreio: frete.rastreio
  });

  return { idContato, contato, dialogo, escolha: frete.escolha, campos };
}

function configChatGuru() {
  // Valores crus (sem trim) para a chave da conversa sair igual à do contrato.
  const endpoint = Deno.env.get("CHATGURU_ENDPOINT") ?? "";
  const key = env("CHATGURU_KEY");
  const account = Deno.env.get("CHATGURU_ACCOUNT_ID") ?? "";
  const phone = Deno.env.get("CHATGURU_PHONE_ID") ?? "";
  if (!/^https:\/\/(?:[a-z0-9-]+\.chatguru\.app|app\.zap\.guru)\/api\/v1\/?$/.test(endpoint) || !key || !account.trim() || !phone.trim()) {
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
async function salvar(idReserva: string, estado: string): Promise<Registro> {
  const { data, error } = await admin
    .from("expedicao_aviso_pronto")
    .update({ estado, atualizado_em: new Date().toISOString() })
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
  const modelos: Record<number, { dialogo: string | null; bloqueio: string | null }> = {};
  for (const [id, f] of await fretesDosPedidos(lista)) {
    modelos[id] = { dialogo: f.escolha.dialogo, bloqueio: f.escolha.bloqueio };
  }
  return { avisos, modelos };
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
      return responder(200, { ok: true, modo_teste: modoTeste, ...(await listar(corpo?.ids)) });
    }

    if (!["enviar", "reenviar", "status"].includes(acao)) throw new Recusa(400, "Ação inválida.");
    if (!quem.podeOperar) throw new Recusa(403, "Sem permissão para operar a Expedição (expedicao.processar).");
    const idInt = Number(corpo?.id_int);
    if (!Number.isInteger(idInt) || idInt <= 0) throw new Recusa(400, "Pedido inválido.");

    const ultimo = await ultimoRegistro(idInt);

    if (acao === "status") {
      // Só avisos antigos (message_send) têm message_id. Diálogo não tem status a consultar.
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

    const ctx = await contextoDoPedido(idInt, modoTeste);
    const cfg = configChatGuru();
    const destino = telefoneWhatsApp(ctx.contato.whats, cfg.ddi);
    const dialogId = DIALOGOS[ctx.dialogo].id;
    const destinoChave = await chaveDaConversa(cfg.endpoint, cfg.account, cfg.phone, destino);

    const { data: reserva, error: errReserva } = await admin.rpc("expedicao_aviso_pronto_reservar_dialogo", {
      p_id_int: idInt,
      p_seq_atual: ultimo?.seq ?? 0,
      p_id_contato: ctx.idContato,
      p_modo_teste: modoTeste,
      p_autor: quem.id,
      p_autor_nome: quem.nome,
      p_dialogo_id: dialogId,
      p_destino_chave: destinoChave
    });
    if (errReserva || !reserva?.resultado) throw new Recusa(503, "Não foi possível reservar o envio. Nada foi enviado.");
    if (reserva.resultado === "ocupado") {
      throw new Recusa(
        409,
        `Há um aviso de pedido pronto sem confirmação para o WhatsApp ${destino}. Nada foi enviado. Confira no ChatGuru antes: a conversa fica travada até isso ser resolvido.`
      );
    }
    if (reserva.resultado !== "reservado" || !reserva.id) {
      return responder(200, { ok: true, modo_teste: modoTeste, ja_existia: true, aviso: publico(await ultimoRegistro(idInt)) });
    }
    const idReserva = String(reserva.id);

    // Daqui em diante nenhum POST ao ChatGuru se repete automaticamente.
    let resultado: Registro;
    // Motivo e etapa da recusa: só voltam na resposta, nunca são gravados.
    let motivoChatGuru: string | null = null;
    let etapa: "campos" | "dialogo" = "campos";
    let porNumero = false;
    try {
      const r1 = await chamarChatGuru(cfg, "chat_update_custom_fields", { chat_number: destino, ...ctx.campos });
      if (!camposAceitos(r1.http, r1.data)) {
        motivoChatGuru = limpar(r1.data?.description, 200) || null;
        const recusado = envioRecusado(r1.http, r1.data);
        porNumero = recusado && recusaPorNumero(motivoChatGuru);
        resultado = await salvar(idReserva, recusado ? "falhou" : "desconhecido");
      } else {
        etapa = "dialogo";
        const r2 = await chamarChatGuru(cfg, "dialog_execute", { chat_number: destino, dialog_id: dialogId });
        if (dialogoExecutado(r2.http, r2.data)) {
          resultado = await salvar(idReserva, "executado");
        } else {
          motivoChatGuru = limpar(r2.data?.description, 200) || null;
          const recusado = envioRecusado(r2.http, r2.data);
          porNumero = recusado && recusaPorNumero(motivoChatGuru);
          resultado = await salvar(idReserva, recusado ? "falhou" : "desconhecido");
        }
      }
    } catch (e) {
      if (e instanceof Recusa) throw e;
      resultado = await salvar(idReserva, "desconhecido");
    }

    return responder(200, {
      ok: true,
      modo_teste: modoTeste,
      ja_existia: false,
      aviso: publico(resultado),
      modelo: { dialogo: ctx.dialogo, bloqueio: null },
      etapa_chatguru: resultado.estado === "executado" ? null : etapa,
      motivo_chatguru: motivoChatGuru,
      // Só na recusa por número: o que foi enviado e de qual contato (não gravado).
      recusa_numero: porNumero ? { numero_enviado: destino, id_contato: ctx.idContato } : null
    });
  } catch (e) {
    if (e instanceof Recusa) return responder(e.status, { ok: false, mensagem: e.message });
    console.error("[expedicao-pedido-pronto]", e instanceof Error ? e.message : "erro");
    return responder(500, { ok: false, mensagem: "Erro inesperado. Consulte o status antes de tentar de novo." });
  }
});
