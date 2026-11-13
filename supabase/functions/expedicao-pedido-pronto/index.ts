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
 *   liberar  { id_int, seq, resposta, confirmado } só ADM: aviso de diálogo em 'desconhecido'
 *            depois de conferir no ChatGuru; "enviada" -> 'executado', "nao_enviada" -> 'falhou'
 *   testar   { id_int, dialogo, confirmado }   "Testar modelo": só modo teste e cliente #14;
 *            diálogo escolhido na tela, sem olhar a forma de envio; campo que o
 *            pedido não tem vai com valor de teste (logica.camposDeTeste). Linha
 *            nova com envio_teste = true: não conta como "aviso já enviado", mas a
 *            trava por conversa vale igual.
 * enviar/reenviar/status/testar exigem expedicao.processar (ou ADM).
 *
 * AVISO "PEDIDO EM PRODUÇÃO" (07/11/2026), fora da Expedição, mesma tabela com
 * evento = 'pedido_em_producao' (o pedido pronto é 'pedido_pronto'):
 *   producao_preparar { id_int }        contato responsável, conversa do ChatGuru (ou a
 *                                       escolha) e se o envio seria recusado; só leitura
 *   producao_enviar   { id_int, reenviar?, seq_atual?, confirmado? }
 *                                       só com o pedido já liberado (is_prd_aprovado);
 *                                       1º envio devolve o que existe se já houve; reenviar
 *                                       exige confirmação da tentativa vista
 *   Exigem propostas.release_producao (ou ADM). Diálogo DIALOGO_PRODUCAO, sem campos
 *   personalizados até 09/11 (desde então grava Link_do_Cliente). Mesma trava por conversa, mesmo critério de
 *   sucesso, mesmo modo teste, mesmo "Ver conversas do cliente" e "Liberar número".
 *
 * LINK E BLOQUEIO (09/11/2026): o template do Pedido em Produção usa {Link_do_Cliente}.
 * Antes do dialog_execute o Vibe grava field__Link_do_Cliente com o final do link de
 * aprovação do próprio pedido, numero_pedido-token como o Imposition (10/11/2026; o
 * template tem o começo fixo), de pedidos_links_cliente (os_id "vibe_<id_int>", ativo;
 * nunca gera token). Sem link: "Pedido sem link de aprovação". Enquanto a trava por conversa não
 * for a mesma do envio de arte do Imposition, só modo teste + cliente #14 envia; o
 * resto recebe "Envio de aviso de produção em ajuste" (a liberação segue igual).
 * Desde 10/11/2026 esse bloqueio saiu (decisão da diretoria): o aviso de produção
 * vai para o cliente real como o da Expedição, regido só pelo modo teste.
 *
 * enviar, reenviar, testar e producao_enviar aceitam também chat_ids (string[]) ou
 * todas = true: a escolha feita na tela quando a regra do DESTINO pediu.
 *
 * DIAGNÓSTICO (07/11/2026): só para ADM, a resposta do envio traz o HTTP e o
 * texto devolvido pelo ChatGuru em cada etapa (logica.diagnosticoSeguro: sem a
 * chave e sem os dados do contato). Nunca é gravado.
 *
 * ENVIO POR DIÁLOGO (Guia "Envio de WhatsApp por diálogos ChatGuru", 07/11/2026):
 *   1. diálogo pela forma de envio (logica.escolherDialogo; despacho vence orçamento);
 *   2. reserva no banco ANTES de qualquer POST: por pedido (seq) e por conversa
 *      (destino_chave = SHA-256 de [endpoint, account, phone, número]);
 *   3. chat_update_custom_fields com os campos do diálogo (field__<Nome>); só segue
 *      com 2xx + success + code 200;
 *   4. dialog_execute com o dialog_id, mesma conta, remetente e conversa;
 *      sucesso = code 200 + "Diálogo executado" (em dialog_execution_return, como o
 *      ChatGuru responde de verdade, ou em description) -> estado 'executado'.
 *   Não há message_id: nada é inventado e message_status não é consultado.
 *   Recusa explícita -> 'falhou' (libera a conversa). Qualquer incerteza ->
 *   'desconhecido' (a conversa fica travada até alguém conferir no ChatGuru).
 *   Depois da reserva nenhum POST se repete sozinho.
 *
 * Pedido e contato são relidos aqui, na hora. O contato responsável é
 * propostas.id_contato, que precisa pertencer ao cliente ou ao faturado do pedido.
 *
 * DESTINO (09/11/2026, decisão da diretoria): a conversa sai da visão
 * chatguru_contatos_3478 (só servidor, atualizada pelo webhook do ChatGuru), com
 * codigo_cliente = id_cliente do pedido; contatos.whats só serve para casar.
 *   - o WhatsApp do contato casa (DDD + 8 últimos) com exatamente uma conversa:
 *     envia para o telefone_normalizado dela, sem perguntar;
 *   - casa com mais de uma, ou com nenhuma, e o cliente tem conversas: a resposta
 *     traz `escolha` (lista das conversas) e NADA é enviado; a tela pergunta e
 *     chama de novo com chat_ids (uma ou várias) ou todas = true;
 *   - sem conversa: recusa com "Cliente sem conversa no ChatGuru (remetente 3478)".
 *   Cada conversa é uma linha (seq) com o chat_id usado. Nada é gravado em
 *   contatos nem nas tabelas do ChatGuru.
 *   conversas { id_int }   só leitura: as conversas do cliente e a decisão da regra
 *                          ("Ver conversas do cliente"); não olha o modo teste.
 *
 * MODO TESTE: ligado enquanto CHATGURU_PEDIDO_PRONTO_MODO_TESTE não for
 * "desligado". Ligado, pedido do cliente #14 (e contato do cliente #14) envia como
 * sempre, para a conversa do próprio cliente #14.
 *
 * MODO HOMOLOGAÇÃO (10/11/2026): com o modo teste ligado, pedido de cliente real
 * (fora do #14) nos dois avisos (enviar/reenviar e producao_enviar) sai com os
 * dados reais do pedido (número, nota, cidade, rastreio, link de aprovação), mas
 * SEMPRE para a conversa de teste do cliente #14 no 3478 (logica.conversaDeTeste,
 * "Edison Junior - 14"), nunca para o cliente; chat_ids/todas da tela são
 * ignorados. Linha com envio_teste = true (publico.homologacao): fora do "já
 * enviado", então o aviso de verdade continua possível com o modo teste
 * desligado. Cada chamada é um envio novo. Regra dos 2 minutos: envio em
 * andamento na conversa de teste, ou diálogo executado nela há menos de 120 s,
 * recusa antes de reservar com "Conversa de teste ocupada, tente em 2 minutos."
 * (nada gravado nem travado); a recusa dos 120 s do próprio ChatGuru vira o mesmo
 * texto. A liberação para a produção não depende do envio. Desligar o modo teste
 * continua sendo só pela variável do servidor.
 *
 * Recusa do ChatGuru por número ("Chat não encontrado."): a resposta traz o
 * número enviado e o chat_id, para a tela oferecer "Ver conversas do cliente".
 * O Vibe não tenta outro número sozinho.
 *
 * v19 — TRAVA COMPARTILHADA COM O IMPOSITION (proposta revisão 4,
 * docs/technical/CHATGURU-TRAVA-COMPARTILHADA-PROPOSTA.md):
 *   - PAUSA: CHATGURU_AVISOS_PAUSA "ligada" (ou qualquer valor que não seja vazio
 *     ou "desligada") recusa todo aviso novo antes de reservar a linha, com
 *     "Envio de avisos pausado por alguns minutos. Tente de novo em instantes.".
 *     Liberar número, listar e conversas seguem funcionando.
 *   - TRAVAR: depois de reservar a linha e antes de qualquer POST,
 *     imposition_whatsapp_conversa_travar(destino_chave, 'vibe:<id>'). "ocupado"
 *     (envio de arte em curso ou margem correndo) ou qualquer erro (função ainda
 *     não existe, banco fora): a linha vira 'falhou' e nada sai (fail-closed).
 *   - SOLTAR: 'executado' solta com a margem do banco; 'falhou' (inclusive a recusa
 *     dos 120 s) solta sem margem; 'desconhecido' não solta. O Liberar número
 *     solta sem margem, antes de gravar a liberação.
 *   - TRAVA PRESA: se o soltar falhar depois de 'executado' ou 'falhou', o aviso
 *     volta com trava_compartilhada_presa e o ADM usa Liberar número (modo
 *     "trava": confirmação, registro em liberado_por/liberado_em, resposta nula).
 *     Só solta a chave 'vibe:' do próprio aviso, nunca a de um envio de arte.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DIALOGOS,
  LIBERACAO,
  Recusa,
  SEM_MODELO,
  camposAceitos,
  camposDeTeste,
  camposDoDialogo,
  chaveDaConversa,
  cidadeDestino,
  conferirModoTeste,
  conferirTeste,
  diagnosticoSeguro,
  dialogoExecutado,
  dialogoValido,
  CLIENTE_TESTE,
  DIALOGO_PRODUCAO,
  conferirEnvioProducao,
  linkDoAvisoProducao,
  linkDoCliente,
  transportadoraDoAviso,
  SEM_CONVERSA,
  conversasEscolhidas,
  decidirConversa,
  numeroDaConversa,
  type Conversa,
  envioRecusado,
  escolherDialogo,
  limpar,
  modoTesteLigado,
  nomeDoDialogo,
  notaParaODialogo,
  rastreioCorreiosValido,
  recusaPorNumero,
  recusaTempoMinimo,
  TEMPO_MINIMO_GURU,
  TRAVA_INDISPONIVEL,
  TRAVA_OCUPADA,
  chaveDaTrava,
  comoSoltar,
  conferirPausa,
  resultadoTrava,
  TRAVA_NAO_PRESA,
  TRAVA_NAO_SOLTA,
  modoDaLiberacao,
  podeTerTravaPresa,
  textoDaResposta,
  CONVERSA_TESTE_OCUPADA,
  conversaDeTeste,
  conversaTesteOcupada,
  emHomologacao,
  type EscolhaDialogo,
  type NomeDialogo
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
  liberado_por_nome: string | null;
  liberado_em: string | null;
  liberacao_resposta: string | null;
  envio_teste: boolean;
  evento: string;
  chat_id: string | null;
};

type Evento = "pedido_pronto" | "pedido_em_producao";

const COLUNAS =
  "id, id_int, seq, estado, message_id, dialogo_id, destino_chave, modo_teste, autor_nome, criado_em, atualizado_em, liberado_por_nome, liberado_em, liberacao_resposta, envio_teste, evento, chat_id";

function publico(r: Registro | null, presas?: Set<string>, pedidoEmHomologacao = false) {
  if (!r) return null;
  return {
    // Modo homologação (10/11/2026): envio de pedido de cliente real para a conversa
    // de teste. É um envio_teste de pedido que não é do cliente #14.
    homologacao: r.envio_teste === true && pedidoEmHomologacao,
    seq: r.seq,
    estado: r.estado,
    message_id: r.message_id,
    dialogo: nomeDoDialogo(r.dialogo_id),
    // Aviso por diálogo em incerteza: a conversa fica travada para novos avisos.
    trava_conversa: r.estado === "desconhecido" && Boolean(r.destino_chave),
    // v19: aviso já terminado cuja conversa ficou presa na trava compartilhada
    // (o soltar falhou). O ADM solta pelo Liberar número.
    trava_compartilhada_presa: Boolean(presas?.has(r.id)),
    modo_teste: r.modo_teste,
    // "Testar modelo": envio de teste, fora do "aviso já enviado" do pedido.
    teste: r.envio_teste === true,
    evento: r.evento,
    // Conversa do ChatGuru usada (09/11/2026); vazio nos avisos anteriores.
    chat_id: r.chat_id ?? null,
    autor_nome: r.autor_nome,
    criado_em: r.criado_em,
    atualizado_em: r.atualizado_em,
    // "Liberar número": quem conferiu no ChatGuru, quando e o que respondeu (resposta
    // nula: só soltou a conversa presa na trava compartilhada).
    liberacao: r.liberado_em
      ? { por: r.liberado_por_nome, em: r.liberado_em, resposta: r.liberacao_resposta }
      : null
  };
}

/**
 * Último aviso do pedido, do evento pedido (padrão: pedido pronto). Ignora os envios de teste ("Testar modelo"),
 * que não contam como aviso já enviado. `todos`: a última linha de qualquer tipo
 * (é a seq que a reserva confere).
 */
async function ultimoRegistro(idInt: number, todos = false, evento: Evento = "pedido_pronto"): Promise<Registro | null> {
  let q = admin.from("expedicao_aviso_pronto").select(COLUNAS).eq("id_int", idInt);
  if (!todos) q = q.eq("envio_teste", false).eq("evento", evento);
  const { data, error } = await q.order("seq", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Recusa(503, "Não foi possível ler o aviso no banco. Tente de novo.");
  return (data as Registro | null) ?? null;
}

/** Última homologação do pedido no evento (envio_teste de pedido fora do cliente #14). */
async function ultimaHomologacao(idInt: number, evento: Evento): Promise<Registro | null> {
  const { data, error } = await admin
    .from("expedicao_aviso_pronto")
    .select(COLUNAS)
    .eq("id_int", idInt)
    .eq("envio_teste", true)
    .eq("evento", evento)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Recusa(503, "Não foi possível ler o aviso no banco. Tente de novo.");
  return (data as Registro | null) ?? null;
}

/** Cliente do pedido (para saber se o envio é homologação). */
async function clienteDoPedido(idInt: number): Promise<number | null> {
  const { data, error } = await admin.from("propostas").select("id_cliente").eq("id_int", idInt).maybeSingle();
  if (error) throw new Recusa(503, "Não foi possível ler o pedido. Tente de novo.");
  if (!data) throw new Recusa(404, `Pedido ${idInt} não encontrado.`);
  const n = Number(data.id_cliente);
  return Number.isFinite(n) ? n : null;
}

/**
 * Homologação: a conversa de teste do cliente #14 no 3478, relida agora. Com
 * `conferirOcupada`, aplica a regra dos 2 minutos antes de qualquer reserva:
 * recusa sem gravar nem travar nada.
 */
async function conversaDaHomologacao(conferirOcupada: boolean): Promise<Conversa> {
  const conversa = conversaDeTeste(await conversasDoCliente(CLIENTE_TESTE));
  if (!conferirOcupada) return conversa;
  const [andamento, executado] = await Promise.all([
    admin.from("expedicao_aviso_pronto").select("estado").eq("chat_id", conversa.chat_id).in("estado", ["preparando", "desconhecido"]).limit(5),
    admin
      .from("expedicao_aviso_pronto")
      .select("atualizado_em")
      .eq("chat_id", conversa.chat_id)
      .eq("estado", "executado")
      .order("atualizado_em", { ascending: false })
      .limit(1)
  ]);
  if (andamento.error || executado.error) throw new Recusa(503, "Não foi possível conferir a conversa de teste. Nada foi enviado.");
  // Resultado desconhecido trava a conversa de teste como qualquer outra: só o ADM libera.
  if ((andamento.data ?? []).some((r) => r.estado === "desconhecido")) {
    throw new Recusa(409, "Há um aviso sem confirmação na conversa de teste. Nada foi enviado. Ela fica travada até o ADM usar Liberar número.");
  }
  const ocupada = conversaTesteOcupada({
    emAndamento: (andamento.data ?? []).length > 0,
    ultimoExecutadoEm: executado.data?.[0]?.atualizado_em ?? null,
    agoraMs: Date.now()
  });
  if (ocupada) throw new Recusa(409, CONVERSA_TESTE_OCUPADA);
  return conversa;
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
    adm,
    nome: limpar(u.nome_usuario) || limpar(u.email) || "Usuário",
    podeVer: tem("expedicao.view") || tem("expedicao.processar"),
    podeOperar: tem("expedicao.processar"),
    podeLiberar: tem("propostas.release_producao")
  };
}

type Frete = {
  escolha: EscolhaDialogo;
  rastreio: string | null;
  idEndereco: string | null;
  idCliente: number | null;
  /** Nome curto para o campo Transportadora (v26): despacho vence orçamento. */
  transportadora: string | null;
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
        .select("id_int, id_cliente, modalidade_frete, categoria_frete, id_transportadora_cliente, frete_escolhido, id_endereco_ent")
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
      const entrada = {
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
      };
      const escolha = escolherDialogo(entrada);
      const transportadora = transportadoraDoAviso(entrada, escolha);
      const idEndereco = String((e?.id_endereco_entrega as string | null) ?? p.id_endereco_ent ?? "").trim() || null;
      const idCliente = Number(p.id_cliente);
      mapa.set(idInt, { escolha, rastreio, idEndereco, idCliente: Number.isFinite(idCliente) ? idCliente : null, transportadora });
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

/**
 * Relê pedido, contato, forma de envio, nota e cidade na hora do envio.
 * `dialogoTeste` ("Testar modelo"): usa esse diálogo sem olhar a forma de envio,
 * e o campo que o pedido não tem vai com o valor de teste.
 */
async function contextoDoPedido(idInt: number, modoTeste: boolean, dialogoTeste: NomeDialogo | null = null) {
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
  if (dialogoTeste) conferirTeste(modoTeste, p.id_cliente);
  // Homologação: pedido de cliente real com o modo teste ligado; vai para a conversa de teste.
  const homologacao = !dialogoTeste && emHomologacao(modoTeste, p.id_cliente);
  if (!homologacao) conferirModoTeste(modoTeste, p.id_cliente);

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
  if (dialogoTeste) conferirTeste(modoTeste, p.id_cliente, contato.id_cliente);
  if (!homologacao) conferirModoTeste(modoTeste, p.id_cliente, contato.id_cliente);

  const frete = (await fretesDosPedidos([idInt])).get(idInt);
  if (!frete) throw new Recusa(503, "Não foi possível ler a forma de envio do pedido.");
  let dialogo: NomeDialogo;
  if (dialogoTeste) {
    dialogo = dialogoTeste;
  } else {
    if (!frete.escolha.dialogo) throw new Recusa(409, frete.escolha.bloqueio ?? SEM_MODELO);
    if (frete.escolha.bloqueio) throw new Recusa(409, frete.escolha.bloqueio);
    dialogo = frete.escolha.dialogo;
  }

  let cidade: string | null = null;
  if (frete.idEndereco && /^[0-9a-f-]{36}$/i.test(frete.idEndereco)) {
    const { data: end } = await admin.from("enderecos").select("cidade, uf").eq("id", frete.idEndereco).maybeSingle();
    cidade = cidadeDestino(end?.cidade, end?.uf);
  }
  const valores = { idInt, notaFiscal: await notaDoPedido(idInt), cidadeDestino: cidade, rastreio: frete.rastreio, transportadora: frete.transportadora };
  if (dialogoTeste) {
    const t = camposDeTeste(dialogo, valores);
    return { idCliente: p.id_cliente, idContato, contato, dialogo, campos: t.campos, teste: { valores: t.valores, de_teste: t.deTeste }, homologacao: false };
  }
  return { idCliente: p.id_cliente, idContato, contato, dialogo, campos: camposDoDialogo(dialogo, valores), teste: null, homologacao };
}

/**
 * "Pedido em produção": pedido e contato da proposta, relidos na hora. Mesmas
 * regras do pedido pronto para o contato (ativo, do cliente ou do faturado) e o
 * mesmo modo teste. Não olha o status: quem decide se já pode enviar é a ação.
 */
async function contextoProducao(idInt: number, modoTeste: boolean) {
  const { data: p, error } = await admin
    .from("propostas")
    .select("id_int, id_cliente, id_faturado, id_contato, status_interno, is_prd_aprovado")
    .eq("id_int", idInt)
    .maybeSingle();
  if (error) throw new Recusa(503, "Não foi possível ler o pedido. Tente de novo.");
  if (!p) throw new Recusa(404, `Pedido ${idInt} não encontrado.`);
  // Bloqueio de 09/11: fora do modo teste, não envia. Com ele ligado, pedido de
  // cliente real vai em homologação para a conversa de teste (10/11/2026).
  conferirEnvioProducao(modoTeste, p.id_cliente);
  const homologacao = emHomologacao(modoTeste, p.id_cliente);
  if (!homologacao) conferirModoTeste(modoTeste, p.id_cliente);
  const idContato = Number(String(p.id_contato ?? "").trim());
  if (!Number.isInteger(idContato) || idContato <= 0) {
    throw new Recusa(422, "O pedido não tem contato responsável. Escolha o contato na proposta.");
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
  if (!homologacao) conferirModoTeste(modoTeste, p.id_cliente, contato.id_cliente);
  return { p, idContato, contato, homologacao };
}

/** Link de aprovação do pedido (pedidos_links_cliente), só leitura. Ver logica.linkDoCliente. */
async function linkDoPedido(idInt: number): Promise<string> {
  const { data, error } = await admin
    .from("pedidos_links_cliente")
    .select("numero_pedido, token")
    .eq("os_id", `vibe_${idInt}`)
    .eq("ativo", true)
    .limit(2);
  if (error) throw new Recusa(503, "Não foi possível ler o link de aprovação do pedido. Nada foi enviado.");
  // Só o aviso Colocando em Produção usa esta função: leva a âncora #arte (v26).
  return linkDoAvisoProducao(linkDoCliente(idInt, data));
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
  // Texto cru guardado para o diagnóstico; resposta que não é JSON vira data nula
  // (nem aceite nem recusa explícita -> 'desconhecido').
  const texto = await resposta.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(texto);
  } catch {
    data = null;
  }
  return { http: resposta.status, data: data as any, texto };
}

/** v19: recusa todo aviso novo com a pausa ligada (lida a cada chamada, sem deploy). */
function conferirPausaDoServidor(): void {
  conferirPausa(Deno.env.get("CHATGURU_AVISOS_PAUSA"));
}

/**
 * v19: ocupa a conversa na trava compartilhada (imposition_whatsapp_conversas)
 * para o aviso já reservado. Qualquer erro vira "indisponivel" (nada sai).
 */
async function travarConversa(destinoChave: string, idAviso: string): Promise<{ resultado: "reservado" | "ocupado" | "indisponivel"; chave: string | null }> {
  let chave: string;
  try {
    chave = chaveDaTrava(idAviso);
  } catch {
    return { resultado: "indisponivel", chave: null };
  }
  try {
    const { data, error } = await admin.rpc("imposition_whatsapp_conversa_travar", { p_destino: destinoChave, p_chave: chave });
    if (error) console.error("[expedicao-pedido-pronto] travar", error.code ?? "erro");
    return { resultado: resultadoTrava(data, error), chave };
  } catch {
    console.error("[expedicao-pedido-pronto] travar", "sem resposta");
    return { resultado: "indisponivel", chave };
  }
}

/**
 * v19: solta a trava compartilhada, só se a conversa ainda é deste aviso (o banco
 * confere). Com executado = true o banco aplica a margem. Tenta duas vezes; se
 * não conseguir, a conversa fica ocupada (lado seguro) e o erro vai para o log.
 */
async function soltarConversa(destinoChave: string, chave: string, executado: boolean): Promise<"solto" | "nao_era_dono" | "erro"> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const { data, error } = await admin.rpc("imposition_whatsapp_conversa_soltar", {
        p_destino: destinoChave,
        p_chave: chave,
        p_executado: executado
      });
      if (!error) return data === true ? "solto" : "nao_era_dono";
    } catch {
      // tenta de novo
    }
  }
  console.error("[expedicao-pedido-pronto] soltar", "falhou: conversa segue ocupada");
  return "erro";
}

/**
 * v19: ids dos avisos (já terminados) que ainda seguram a conversa na trava
 * compartilhada: chave_envio = 'vibe:<id>' em imposition_whatsapp_conversas.
 * Antes da migração nenhuma conversa tem 'vibe:', então a resposta é vazia.
 * estrito: erro de leitura recusa (Liberar número); senão só registra no log.
 */
async function travasPresas(regs: (Registro | null)[], estrito = false): Promise<Set<string>> {
  const presas = new Set<string>();
  const porChave = new Map<string, Registro>();
  for (const r of regs) {
    if (!r || !podeTerTravaPresa(r)) continue;
    try {
      porChave.set(chaveDaTrava(r.id), r);
    } catch {
      // id fora do formato: não segura trava
    }
  }
  const chaves = [...porChave.keys()];
  for (let i = 0; i < chaves.length; i += 200) {
    const { data, error } = await admin
      .from("imposition_whatsapp_conversas")
      .select("destino_chave, chave_envio")
      .in("chave_envio", chaves.slice(i, i + 200));
    if (error) {
      console.error("[expedicao-pedido-pronto] travas presas", error.code ?? "erro");
      if (estrito) throw new Recusa(503, "Não foi possível conferir a conversa. Nada mudou.");
      return presas;
    }
    for (const c of data ?? []) {
      const r = porChave.get(String(c.chave_envio));
      if (r && r.destino_chave === c.destino_chave) presas.add(r.id);
    }
  }
  return presas;
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

/** Conversas do remetente 3478 do cliente (visão chatguru_contatos_3478, só servidor). Só leitura. */
async function conversasDoCliente(idCliente: unknown): Promise<Conversa[]> {
  const id = Number(idCliente);
  if (!Number.isInteger(id) || id <= 0) return [];
  const { data, error } = await admin
    .from("chatguru_contatos_3478")
    .select("chat_id, nome_chatguru, telefone_normalizado")
    .eq("codigo_cliente", String(id))
    .limit(50);
  if (error) throw new Recusa(503, "Não foi possível ler as conversas do cliente no ChatGuru. Nada foi enviado.");
  const vistas = new Set<string>();
  const lista: Conversa[] = [];
  for (const c of data ?? []) {
    const chat = limpar(c.chat_id, 80);
    const numero = numeroDaConversa(c.telefone_normalizado);
    if (!chat || !numero || vistas.has(chat)) continue;
    vistas.add(chat);
    lista.push({ chat_id: chat, nome: limpar(c.nome_chatguru) || "—", numero });
  }
  return lista;
}

type Destinos =
  | { conversas: Conversa[]; escolha: null }
  | { conversas: []; escolha: { motivo: "varias" | "nenhuma"; conversas: Conversa[] } };

/**
 * Para quais conversas vai o aviso. Com chat_ids ou todas (escolha feita na tela):
 * só conversas do cliente, relidas agora. Sem escolha: a regra de decidirConversa.
 */
async function destinosDoAviso(idCliente: unknown, telefoneContato: unknown, corpo: any): Promise<Destinos> {
  const lista = await conversasDoCliente(idCliente);
  if (!lista.length) throw new Recusa(422, SEM_CONVERSA);
  if (corpo?.todas === true || Array.isArray(corpo?.chat_ids)) {
    return { conversas: conversasEscolhidas(corpo?.chat_ids, lista, corpo?.todas === true), escolha: null };
  }
  const d = decidirConversa(telefoneContato, lista);
  if (d.modo === "automatica") return { conversas: [d.conversa], escolha: null };
  if (d.modo === "escolha") return { conversas: [], escolha: { motivo: d.motivo, conversas: d.conversas } };
  throw new Recusa(422, SEM_CONVERSA);
}

type ResultadoEnvio = {
  conversa: Conversa;
  aviso: ReturnType<typeof publico>;
  /** Não reservou (conversa travada ou envio concorrente): nada foi enviado para ela. */
  recusa: string | null;
  etapa_chatguru: string | null;
  motivo_chatguru: string | null;
  recusa_numero: { numero_enviado: string; chat_id: string } | null;
  diagnostico_chatguru: unknown;
};

/**
 * Um envio por conversa, uma depois da outra: reserva (com o chat_id) e só então
 * as chamadas ao ChatGuru. Conversa travada não impede as outras.
 */
async function enviarParaConversas(p: {
  idInt: number;
  idContato: number;
  quem: { id: string; nome: string; adm: boolean };
  modoTeste: boolean;
  evento: Evento;
  envioTeste: boolean;
  dialogoId: string;
  campos: Record<string, string>;
  conversas: Conversa[];
  ocultar: (string | null | undefined)[];
  /** Homologação: a conversa é a de teste; ocupada ou recusa dos 120 s viram CONVERSA_TESTE_OCUPADA. */
  homologacao?: boolean;
}): Promise<ResultadoEnvio[]> {
  // v19: a pausa vale para todos os avisos, antes de qualquer reserva.
  conferirPausaDoServidor();
  const cfg = configChatGuru();
  const out: ResultadoEnvio[] = [];
  for (const conversa of p.conversas) {
    const destino = conversa.numero;
    const chave = await chaveDaConversa(cfg.endpoint, cfg.account, cfg.phone, destino);
    const res = await reservarLinha({
      idInt: p.idInt,
      idContato: p.idContato,
      autor: p.quem.id,
      autorNome: p.quem.nome,
      dialogoId: p.dialogoId,
      destinoChave: chave,
      chatId: conversa.chat_id,
      evento: p.evento,
      envioTeste: p.envioTeste,
      modoTeste: p.modoTeste
    });
    const vazio = { aviso: null, etapa_chatguru: null, motivo_chatguru: null, recusa_numero: null, diagnostico_chatguru: null };
    if (res.resultado === "ocupado" && p.homologacao) {
      // Outro envio pegou a conversa de teste depois da conferência dos 2 minutos.
      out.push({ conversa, ...vazio, recusa: CONVERSA_TESTE_OCUPADA });
      continue;
    }
    if (res.resultado === "ocupado") {
      out.push({
        conversa,
        ...vazio,
        recusa: `Há um aviso sem confirmação para o WhatsApp ${destino}. Nada foi enviado. Confira no ChatGuru: o número fica travado até o ADM usar Liberar número.`
      });
      continue;
    }
    if (res.resultado !== "reservado") {
      out.push({ conversa, ...vazio, recusa: "Outro envio deste pedido começou ao mesmo tempo. Nada foi enviado." });
      continue;
    }
    // v19: trava compartilhada com o Imposition antes de qualquer POST ao ChatGuru.
    const trava = await travarConversa(chave, res.id);
    if (trava.resultado !== "reservado" || !trava.chave) {
      const falhou = await salvar(res.id, "falhou");
      out.push({
        conversa,
        ...vazio,
        aviso: publico(falhou, undefined, p.homologacao),
        recusa: trava.resultado === "ocupado" ? TRAVA_OCUPADA : TRAVA_INDISPONIVEL
      });
      continue;
    }
    const r = await executarDialogo(res.id, cfg, destino, p.dialogoId, p.campos, [
      cfg.key,
      cfg.account,
      cfg.phone,
      destino,
      conversa.nome,
      ...p.ocultar
    ]);
    // v19: solta conforme o resultado; 'desconhecido' segue ocupando a conversa.
    const como = comoSoltar(r.resultado.estado);
    const soltou = como.soltar ? await soltarConversa(chave, trava.chave, como.executado) : null;
    out.push({
      conversa,
      aviso: publico(r.resultado, soltou === "erro" ? new Set([r.resultado.id]) : undefined, p.homologacao),
      recusa: null,
      etapa_chatguru: r.resultado.estado === "executado" ? null : r.etapa,
      motivo_chatguru: p.homologacao && r.motivo === TEMPO_MINIMO_GURU ? CONVERSA_TESTE_OCUPADA : r.motivo,
      recusa_numero: r.porNumero ? { numero_enviado: destino, chat_id: conversa.chat_id } : null,
      diagnostico_chatguru: p.quem.adm ? r.diagnostico : null
    });
  }
  return out;
}

/**
 * Resposta dos envios. Uma conversa só e não reservou: recusa (como antes). Com
 * várias, `envios` traz cada uma; o resto da resposta é da primeira que não deu
 * certo (ou da última).
 */
function respostaDosEnvios(modoTeste: boolean, out: ResultadoEnvio[], extra: Record<string, unknown> = {}) {
  if (out.length === 1 && out[0].recusa) throw new Recusa(409, out[0].recusa);
  const principal =
    out.find((e) => e.aviso && e.aviso.estado !== "executado") ?? [...out].reverse().find((e) => e.aviso) ?? out[out.length - 1];
  return responder(200, {
    ok: true,
    modo_teste: modoTeste,
    ja_existia: false,
    aviso: principal.aviso,
    etapa_chatguru: principal.etapa_chatguru,
    motivo_chatguru: principal.motivo_chatguru,
    recusa_numero: principal.recusa_numero,
    diagnostico_chatguru: principal.diagnostico_chatguru,
    envios: out.map((e) => ({
      chat_id: e.conversa.chat_id,
      nome: e.conversa.nome,
      numero: e.conversa.numero,
      aviso: e.aviso,
      recusa: e.recusa,
      motivo_chatguru: e.motivo_chatguru
    })),
    ...extra
  });
}

async function listar(ids: unknown, modoTeste: boolean) {
  const lista = Array.isArray(ids)
    ? Array.from(new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 1000)
    : [];
  // Último aviso de verdade e, à parte, o último envio de teste de cada pedido.
  const ultimos: Record<number, Registro> = {};
  const ultimosTeste: Record<number, Registro> = {};
  for (let i = 0; i < lista.length; i += 200) {
    const { data, error } = await admin
      .from("expedicao_aviso_pronto")
      .select(COLUNAS)
      .in("id_int", lista.slice(i, i + 200))
      .eq("evento", "pedido_pronto")
      .order("seq", { ascending: false });
    if (error) throw new Recusa(503, "Não foi possível ler os avisos.");
    for (const r of (data ?? []) as Registro[]) {
      const alvo = r.envio_teste ? ultimosTeste : ultimos;
      if (!alvo[r.id_int]) alvo[r.id_int] = r;
    }
  }
  // v19: conversa presa na trava compartilhada depois de um aviso já terminado.
  const presas = await travasPresas([...Object.values(ultimos), ...Object.values(ultimosTeste)]);
  const fretes = await fretesDosPedidos(lista);
  // Envio de teste de pedido fora do cliente #14 é homologação (10/11/2026).
  const foraDoTeste = (id: number) => {
    const c = fretes.get(id)?.idCliente;
    return c != null && c !== CLIENTE_TESTE;
  };
  const avisos: Record<number, ReturnType<typeof publico>> = {};
  const testes: Record<number, ReturnType<typeof publico>> = {};
  for (const r of Object.values(ultimos)) avisos[r.id_int] = publico(r, presas);
  for (const r of Object.values(ultimosTeste)) testes[r.id_int] = publico(r, presas, foraDoTeste(r.id_int));
  const modelos: Record<number, { dialogo: string | null; bloqueio: string | null; testavel: boolean; homologacao: boolean }> = {};
  for (const [id, f] of fretes) {
    modelos[id] = {
      dialogo: f.escolha.dialogo,
      bloqueio: f.escolha.bloqueio,
      // "Testar modelo" só existe com o modo teste ligado e para pedido do cliente #14.
      testavel: modoTeste && f.idCliente === CLIENTE_TESTE,
      // Modo homologação: o aviso deste pedido vai para a conversa de teste.
      homologacao: emHomologacao(modoTeste, f.idCliente)
    };
  }
  return { avisos, testes, modelos };
}

/**
 * Reserva de todos os avisos (09/11/2026: o pedido pronto deixou a RPC
 * expedicao_aviso_pronto_reservar_dialogo), com o chat_id da conversa. Linha
 * nova, seq depois da última (de qualquer tipo); o índice único (id_int, seq) recusa a corrida e o da trava por conversa recusa um
 * segundo envio para o mesmo WhatsApp enquanto há um 'preparando' ou 'desconhecido'.
 */
async function reservarLinha(p: {
  idInt: number;
  idContato: number;
  autor: string;
  autorNome: string;
  dialogoId: string;
  destinoChave: string;
  chatId: string;
  evento: Evento;
  envioTeste: boolean;
  modoTeste: boolean;
}): Promise<{ resultado: "reservado"; id: string } | { resultado: "ocupado" | "concorrente" }> {
  const { data: preso } = await admin
    .from("expedicao_aviso_pronto")
    .select("id")
    .eq("destino_chave", p.destinoChave)
    .in("estado", ["preparando", "desconhecido"])
    .limit(1);
  if (preso && preso.length) return { resultado: "ocupado" };
  const ultimo = await ultimoRegistro(p.idInt, true);
  const { data, error } = await admin
    .from("expedicao_aviso_pronto")
    .insert({
      id_int: p.idInt,
      seq: (ultimo?.seq ?? 0) + 1,
      id_contato: p.idContato,
      modo_teste: p.modoTeste,
      envio_teste: p.envioTeste,
      evento: p.evento,
      autor: p.autor,
      autor_nome: p.autorNome,
      dialogo_id: p.dialogoId,
      destino_chave: p.destinoChave,
      chat_id: p.chatId
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return { resultado: /trava_conversa/.test(error.message ?? "") ? "ocupado" : "concorrente" };
    }
    throw new Recusa(503, "Não foi possível reservar o envio. Nada foi enviado.");
  }
  if (!data?.id) throw new Recusa(503, "Não foi possível reservar o envio. Nada foi enviado.");
  return { resultado: "reservado", id: String(data.id) };
}

/**
 * As duas chamadas ao ChatGuru (campos + diálogo) e o estado gravado na reserva.
 * Nenhum POST se repete sozinho.
 */
async function executarDialogo(
  idReserva: string,
  cfg: ReturnType<typeof configChatGuru>,
  destino: string,
  dialogId: string,
  campos: Record<string, string>,
  ocultar: (string | null | undefined)[]
) {
  let resultado: Registro;
  // Motivo e etapa da recusa: só voltam na resposta, nunca são gravados.
  let motivo: string | null = null;
  let etapa: "campos" | "dialogo" = "campos";
  let porNumero = false;
  // Diagnóstico (só ADM): HTTP e texto do ChatGuru em cada etapa, sem chave nem contato.
  const diagnostico: { etapa: string; http: number | null; texto: string }[] = [];
  try {
    // Diálogo sem campos personalizados: só dialog_execute.
    const semCampos = Object.keys(campos).length === 0;
    const r1 = semCampos ? null : await chamarChatGuru(cfg, "chat_update_custom_fields", { chat_number: destino, ...campos });
    if (r1) diagnostico.push({ etapa: "campos", http: r1.http, texto: diagnosticoSeguro(r1.texto, ocultar) });
    if (r1 && !camposAceitos(r1.http, r1.data)) {
      motivo = textoDaResposta(r1.data) || null;
      const recusado = envioRecusado(r1.http, r1.data);
      porNumero = recusado && recusaPorNumero(motivo);
      resultado = await salvar(idReserva, recusado ? "falhou" : "desconhecido");
    } else {
      etapa = "dialogo";
      const r2 = await chamarChatGuru(cfg, "dialog_execute", { chat_number: destino, dialog_id: dialogId });
      diagnostico.push({ etapa: "dialogo", http: r2.http, texto: diagnosticoSeguro(r2.texto, ocultar) });
      if (dialogoExecutado(r2.http, r2.data)) {
        resultado = await salvar(idReserva, "executado");
      } else {
        // Regra dos 120 s do ChatGuru: recusa explícita, com a mensagem da tela (09/11/2026).
        motivo = recusaTempoMinimo(r2.data) ? TEMPO_MINIMO_GURU : textoDaResposta(r2.data) || null;
        const recusado = envioRecusado(r2.http, r2.data);
        porNumero = recusado && recusaPorNumero(motivo);
        resultado = await salvar(idReserva, recusado ? "falhou" : "desconhecido");
      }
    }
  } catch (e) {
    if (e instanceof Recusa) throw e;
    diagnostico.push({ etapa, http: null, texto: "Sem resposta do ChatGuru (tempo esgotado ou falha de rede)." });
    resultado = await salvar(idReserva, "desconhecido");
  }
  return { resultado, motivo, etapa, porNumero, diagnostico };
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
      return responder(200, { ok: true, modo_teste: modoTeste, ...(await listar(corpo?.ids, modoTeste)) });
    }

    if (acao === "liberar") {
      if (!quem.adm) throw new Recusa(403, "Só o ADM libera o número.");
      const idLib = Number(corpo?.id_int);
      const seqLib = Number(corpo?.seq);
      if (!Number.isInteger(idLib) || idLib <= 0 || !Number.isInteger(seqLib) || seqLib <= 0) throw new Recusa(400, "Pedido inválido.");
      const { data: atualLib, error: errAtual } = await admin
        .from("expedicao_aviso_pronto")
        .select(COLUNAS)
        .eq("id_int", idLib)
        .eq("seq", seqLib)
        .maybeSingle();
      if (errAtual) throw new Recusa(503, "Não foi possível ler o aviso. Nada mudou.");
      const regLib = atualLib as Registro | null;

      if (modoDaLiberacao(corpo) === "trava") {
        // v19: aviso já terminado ('executado' ou 'falhou') cuja conversa ficou presa
        // na trava compartilhada. Só a chave 'vibe:' deste aviso; nunca a de um envio de arte.
        if (corpo?.confirmado !== true) throw new Recusa(409, "Confirme que quer soltar a conversa.");
        if (!regLib || !podeTerTravaPresa(regLib)) throw new Recusa(409, TRAVA_NAO_PRESA);
        const presa = await travasPresas([regLib], true);
        if (!presa.has(regLib.id)) throw new Recusa(409, TRAVA_NAO_PRESA);
        const soltou = await soltarConversa(regLib.destino_chave!, chaveDaTrava(regLib.id), false);
        if (soltou === "erro") throw new Recusa(503, TRAVA_NAO_SOLTA);
        if (soltou === "nao_era_dono") throw new Recusa(409, TRAVA_NAO_PRESA);
        // Registro: quem soltou e quando. Não sobrescreve uma liberação anterior.
        const agora = new Date().toISOString();
        const { data: reg, error: errReg } = await admin
          .from("expedicao_aviso_pronto")
          .update({ liberado_por: quem.id, liberado_por_nome: quem.nome, liberado_em: agora, atualizado_em: agora })
          .eq("id", regLib.id)
          .is("liberado_em", null)
          .select(COLUNAS)
          .maybeSingle();
        if (errReg) {
          console.error("[expedicao-pedido-pronto] registro da liberacao da trava", errReg.code ?? "erro");
          throw new Recusa(503, "A conversa foi solta, mas o registro de quem liberou não foi gravado.");
        }
        if (!reg) console.error("[expedicao-pedido-pronto] liberacao da trava sem registro novo: aviso ja tinha liberacao");
        return responder(200, { ok: true, modo_teste: modoTeste, aviso: publico((reg ?? regLib) as Registro) });
      }

      const resposta = String(corpo?.resposta ?? "") as keyof typeof LIBERACAO;
      if (!(resposta in LIBERACAO)) throw new Recusa(400, "Resposta inválida: use enviada ou nao_enviada.");
      if (corpo?.confirmado !== true) throw new Recusa(409, "Confirme o que você conferiu no ChatGuru.");
      if (!regLib || regLib.estado !== "desconhecido" || !regLib.destino_chave || regLib.liberado_em) {
        throw new Recusa(409, "Este aviso não está mais travado (ou não é de diálogo). Atualize a tela.");
      }
      // v19: solta a trava compartilhada ANTES de gravar, sem margem (a conferência
      // levou tempo). Assim a liberação nunca fica gravada com a conversa ainda presa.
      // Aviso de antes da trava compartilhada não ocupa a conversa: nada a soltar.
      const segura = await travasPresas([{ ...regLib, estado: "falhou" }], true);
      if (segura.has(regLib.id)) {
        const soltou = await soltarConversa(regLib.destino_chave, chaveDaTrava(regLib.id), false);
        if (soltou === "erro") throw new Recusa(503, TRAVA_NAO_SOLTA);
      }
      // Só a tentativa vista, só diálogo, só em 'desconhecido' e nunca liberada antes.
      const { data: lib, error: errLib } = await admin
        .from("expedicao_aviso_pronto")
        .update({
          estado: LIBERACAO[resposta],
          liberado_por: quem.id,
          liberado_por_nome: quem.nome,
          liberado_em: new Date().toISOString(),
          liberacao_resposta: resposta,
          atualizado_em: new Date().toISOString()
        })
        .eq("id_int", idLib)
        .eq("seq", seqLib)
        .eq("estado", "desconhecido")
        .not("destino_chave", "is", null)
        .is("liberado_em", null)
        .select(COLUNAS)
        .maybeSingle();
      if (errLib) throw new Recusa(503, "Não foi possível liberar o número. Nada mudou.");
      if (!lib) throw new Recusa(409, "Este aviso não está mais travado (ou não é de diálogo). Atualize a tela.");
      return responder(200, { ok: true, modo_teste: modoTeste, aviso: publico(lib as Registro) });
    }

    if (acao === "conversas") {
      // "Ver conversas do cliente": só leitura, as conversas do 3478 do cliente do
      // pedido e o que a regra decidiria. Não envia e não olha o modo teste.
      if (!quem.podeVer && !quem.podeLiberar) throw new Recusa(403, "Sem permissão para ver os avisos do pedido.");
      const idV = Number(corpo?.id_int);
      if (!Number.isInteger(idV) || idV <= 0) throw new Recusa(400, "Pedido inválido.");
      const { data: pv, error: errV } = await admin.from("propostas").select("id_cliente, id_contato").eq("id_int", idV).maybeSingle();
      if (errV) throw new Recusa(503, "Não foi possível ler o pedido. Tente de novo.");
      if (!pv) throw new Recusa(404, `Pedido ${idV} não encontrado.`);
      const idCv = Number(String(pv.id_contato ?? "").trim());
      let contatoV: { id_contato: number; nome: string; whatsapp: string } | null = null;
      if (Number.isInteger(idCv) && idCv > 0) {
        const { data: c } = await admin.from("contatos").select("nome_contato, whats").eq("id", idCv).maybeSingle();
        if (c) contatoV = { id_contato: idCv, nome: limpar(c.nome_contato) || "—", whatsapp: limpar(c.whats, 40) };
      }
      const listaV = await conversasDoCliente(pv.id_cliente);
      const d = decidirConversa(contatoV?.whatsapp ?? null, listaV);
      return responder(200, {
        ok: true,
        modo_teste: modoTeste,
        id_cliente: Number(pv.id_cliente),
        contato: contatoV,
        conversas: listaV,
        decisao:
          d.modo === "automatica"
            ? { modo: "automatica", chat_id: d.conversa.chat_id }
            : d.modo === "escolha"
              ? { modo: "escolha", motivo: d.motivo }
              : { modo: "sem_conversa", mensagem: SEM_CONVERSA },
        // Fora do cliente #14 com o modo teste ligado, o aviso vai em homologação para a
        // conversa de teste: a lista do cliente é só para consulta.
        envio_recusado_pelo_modo_teste: modoTeste && Number(pv.id_cliente) !== CLIENTE_TESTE,
        homologacao: emHomologacao(modoTeste, pv.id_cliente)
      });
    }

    if (acao === "producao_preparar" || acao === "producao_enviar") {
      if (!quem.podeLiberar) throw new Recusa(403, "Sem permissão para liberar para produção (propostas.release_producao).");
      const idP = Number(corpo?.id_int);
      if (!Number.isInteger(idP) || idP <= 0) throw new Recusa(400, "Pedido inválido.");
      const ultimoP = await ultimoRegistro(idP, false, "pedido_em_producao");

      if (acao === "producao_preparar") {
        // Só leitura: o contato responsável, para qual conversa vai (ou a escolha) e,
        // se o envio seria recusado, o motivo.
        const { data: base } = await admin.from("propostas").select("id_contato").eq("id_int", idP).maybeSingle();
        const idC = Number(String(base?.id_contato ?? "").trim());
        let destinatario: { id_contato: number; nome: string; whatsapp: string } | null = null;
        if (Number.isInteger(idC) && idC > 0) {
          const { data: c } = await admin.from("contatos").select("id, nome_contato, whats").eq("id", idC).maybeSingle();
          if (c) destinatario = { id_contato: idC, nome: limpar(c.nome_contato) || "—", whatsapp: limpar(c.whats, 40) };
        }
        let bloqueio: string | null = null;
        let conversa: Conversa | null = null;
        let escolha: Destinos["escolha"] = null;
        // Modo homologação: a janela mostra a conversa de teste e a última homologação.
        const homologacaoP = emHomologacao(modoTeste, await clienteDoPedido(idP));
        try {
          conferirPausaDoServidor();
          const ctxP = await contextoProducao(idP, modoTeste);
          await linkDoPedido(idP);
          if (ctxP.homologacao) {
            conversa = await conversaDaHomologacao(false);
          } else {
            const dest = await destinosDoAviso(ctxP.p.id_cliente, ctxP.contato.whats, {});
            conversa = dest.conversas[0] ?? null;
            escolha = dest.escolha;
          }
        } catch (e) {
          if (!(e instanceof Recusa)) throw e;
          bloqueio = e.message;
        }
        const avisoP = homologacaoP
          ? publico(await ultimaHomologacao(idP, "pedido_em_producao"), undefined, true)
          : publico(ultimoP, await travasPresas([ultimoP]));
        return responder(200, { ok: true, modo_teste: modoTeste, homologacao: homologacaoP, destinatario, conversa, escolha, bloqueio, aviso: avisoP });
      }

      // producao_enviar: modo teste e contato primeiro (recusa antes de olhar o resto).
      const ctxP = await contextoProducao(idP, modoTeste);
      if (ctxP.p.is_prd_aprovado !== true) {
        throw new Recusa(409, `O pedido ${idP} ainda não foi liberado para a produção. Nada foi enviado.`);
      }
      if ((ctxP.p.status_interno ?? "").toUpperCase() === "CANCELADO") throw new Recusa(409, "Pedido cancelado. Nada foi enviado.");
      if (ctxP.homologacao) {
        // Modo homologação: dados reais do pedido, sempre para a conversa de teste.
        // Cada chamada é um envio novo; o aviso de verdade do pedido não é tocado.
        if (corpo?.reenviar === true && corpo?.confirmado !== true) throw new Recusa(409, "Confirme o reenvio.");
        conferirPausaDoServidor();
        const linkH = await linkDoPedido(idP);
        const conversaH = await conversaDaHomologacao(true);
        const outH = await enviarParaConversas({
          idInt: idP,
          idContato: ctxP.idContato,
          quem,
          modoTeste,
          evento: "pedido_em_producao",
          envioTeste: true,
          dialogoId: DIALOGO_PRODUCAO,
          // O Link_do_Cliente do pedido só é gravado na conversa de teste.
          campos: { field__Link_do_Cliente: linkH },
          conversas: [conversaH],
          ocultar: [ctxP.contato.whats, ctxP.contato.nome_contato, linkH],
          homologacao: true
        });
        return respostaDosEnvios(modoTeste, outH, { homologacao: true });
      }
      if (corpo?.reenviar === true) {
        if (!ultimoP) throw new Recusa(409, "Este pedido ainda não teve aviso de produção.");
        if (corpo?.confirmado !== true || Number(corpo?.seq_atual) !== ultimoP.seq) {
          throw new Recusa(409, "O aviso mudou desde que a janela abriu. Feche, abra de novo e confirme.");
        }
        if (ultimoP.estado === "preparando") throw new Recusa(409, "Já há um envio em andamento para este pedido.");
      } else if (ultimoP) {
        return responder(200, { ok: true, modo_teste: modoTeste, ja_existia: true, aviso: publico(ultimoP, await travasPresas([ultimoP])) });
      }
      conferirPausaDoServidor();
      const linkP = await linkDoPedido(idP);
      const destP = await destinosDoAviso(ctxP.p.id_cliente, ctxP.contato.whats, corpo);
      if (destP.escolha) {
        return responder(200, { ok: true, modo_teste: modoTeste, ja_existia: false, aviso: publico(ultimoP), escolha: destP.escolha });
      }
      const outP = await enviarParaConversas({
        idInt: idP,
        idContato: ctxP.idContato,
        quem,
        modoTeste,
        evento: "pedido_em_producao",
        envioTeste: false,
        dialogoId: DIALOGO_PRODUCAO,
        // O link do próprio pedido vai no campo antes do diálogo (09/11/2026).
        campos: { field__Link_do_Cliente: linkP },
        conversas: destP.conversas,
        ocultar: [ctxP.contato.whats, ctxP.contato.nome_contato, linkP]
      });
      return respostaDosEnvios(modoTeste, outP);
    }

    if (!["enviar", "reenviar", "status", "testar"].includes(acao)) throw new Recusa(400, "Ação inválida.");
    if (!quem.podeOperar) throw new Recusa(403, "Sem permissão para operar a Expedição (expedicao.processar).");
    const idInt = Number(corpo?.id_int);
    if (!Number.isInteger(idInt) || idInt <= 0) throw new Recusa(400, "Pedido inválido.");

    if (acao === "testar") {
      // "Testar modelo": só modo teste, só cliente #14 (conferido de novo no contexto).
      if (!modoTeste) throw new Recusa(403, "Testar modelo só existe com o modo teste ligado.");
      const nome = dialogoValido(corpo?.dialogo);
      if (!nome) throw new Recusa(400, "Escolha um dos seis diálogos.");
      if (corpo?.confirmado !== true) throw new Recusa(409, "Confirme o envio de teste.");
      conferirPausaDoServidor();
      const ctxT = await contextoDoPedido(idInt, modoTeste, nome);
      const destT = await destinosDoAviso(ctxT.idCliente, ctxT.contato.whats, corpo);
      if (destT.escolha) {
        return responder(200, { ok: true, modo_teste: modoTeste, ja_existia: false, aviso: null, teste: ctxT.teste, escolha: destT.escolha });
      }
      const outT = await enviarParaConversas({
        idInt,
        idContato: ctxT.idContato,
        quem,
        modoTeste: true,
        evento: "pedido_pronto",
        envioTeste: true,
        dialogoId: DIALOGOS[nome].id,
        campos: ctxT.campos,
        conversas: destT.conversas,
        ocultar: [ctxT.contato.whats, ctxT.contato.nome_contato]
      });
      return respostaDosEnvios(modoTeste, outT, { teste: ctxT.teste });
    }

    if (acao !== "status" && emHomologacao(modoTeste, await clienteDoPedido(idInt))) {
      // Modo homologação (pedido pronto): dados reais do pedido, sempre para a
      // conversa de teste. Não olha nem muda o aviso de verdade do pedido.
      if (acao === "reenviar" && corpo?.confirmado !== true) throw new Recusa(409, "Confirme o reenvio.");
      conferirPausaDoServidor();
      const ctxH = await contextoDoPedido(idInt, modoTeste);
      const conversaH = await conversaDaHomologacao(true);
      const outH = await enviarParaConversas({
        idInt,
        idContato: ctxH.idContato,
        quem,
        modoTeste,
        evento: "pedido_pronto",
        envioTeste: true,
        dialogoId: DIALOGOS[ctxH.dialogo].id,
        campos: ctxH.campos,
        conversas: [conversaH],
        ocultar: [ctxH.contato.whats, ctxH.contato.nome_contato],
        homologacao: true
      });
      return respostaDosEnvios(modoTeste, outH, { modelo: { dialogo: ctxH.dialogo, bloqueio: null }, homologacao: true });
    }

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

    conferirPausaDoServidor();
    const ctx = await contextoDoPedido(idInt, modoTeste);
    const dest = await destinosDoAviso(ctx.idCliente, ctx.contato.whats, corpo);
    const modelo = { dialogo: ctx.dialogo, bloqueio: null };
    if (dest.escolha) {
      return responder(200, { ok: true, modo_teste: modoTeste, ja_existia: false, aviso: publico(ultimo), modelo, escolha: dest.escolha });
    }
    // Daqui em diante nenhum POST ao ChatGuru se repete automaticamente.
    const out = await enviarParaConversas({
      idInt,
      idContato: ctx.idContato,
      quem,
      modoTeste,
      evento: "pedido_pronto",
      envioTeste: false,
      dialogoId: DIALOGOS[ctx.dialogo].id,
      campos: ctx.campos,
      conversas: dest.conversas,
      ocultar: [ctx.contato.whats, ctx.contato.nome_contato]
    });
    return respostaDosEnvios(modoTeste, out, { modelo });
  } catch (e) {
    if (e instanceof Recusa) return responder(e.status, { ok: false, mensagem: e.message });
    console.error("[expedicao-pedido-pronto]", e instanceof Error ? e.message : "erro");
    return responder(500, { ok: false, mensagem: "Erro inesperado. Consulte o status antes de tentar de novo." });
  }
});
