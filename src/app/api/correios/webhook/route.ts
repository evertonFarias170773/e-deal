import crypto from "crypto";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
// Classificação de evento em ponto único: a consulta de rastreio da tela usa as
// MESMAS listas para liberar o botão "marcar ENTREGUE". Duas cópias divergiriam.
import { eventoEhEntrega, eventoEhTransito, separarTipoEvento } from "@/lib/correios/eventos";

/**
 * Receiver do WEBHOOK oficial dos Correios (serviço wh-rastro, API 78/534).
 *
 * Quem chama é o servidor dos Correios — não há sessão de usuário. A
 * autenticidade vem do HMAC: a assinatura é criada com um `secret` nosso
 * (CORREIOS_WEBHOOK_SECRET) e cada POST chega com o header
 * `x-correios-signature` ("resumo HMAC" do corpo, conforme o OpenAPI da API
 * Webhook v1.5.16, explorado em 17/08/2026 — o algoritmo exato não é público,
 * então aceitamos SHA-256 em hex ou base64, com ou sem prefixo "sha256=").
 *
 * Efeitos por evento (sempre com trilha em os_status_log, origem CORREIOS_WEBHOOK):
 *  - postagem/coleta (PO-*, CO-1/15/16, CMT-0): EXPEDICAO -> EM TRANSITO;
 *  - entrega ao destinatário (BDE/BDI/BDR 1|67|68|70): -> ENTREGUE + data_entrega;
 *  - qualquer evento: atualiza expedicoes.correios_ultimo_evento(_em).
 * Escrita via service-role (mesmo padrão do QR público em os-qr-token.server.ts).
 *
 * O formato exato do corpo só se confirma no primeiro teste real, então a
 * extração é TOLERANTE: campos comuns primeiro, regex de código de objeto
 * (AA123456789BR) e de tipo de evento como rede de segurança. Evento sem
 * objeto reconhecível responde 200 e é ignorado — 4xx faria os Correios
 * reenviarem para sempre uma mensagem que nunca vamos entender.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGEX_OBJETO = /\b[A-Z]{2}[0-9]{9}BR\b/;
const REGEX_TIPO_EVENTO = /\b(?:PO|CO|OEC|BDE|BDI|BDR|RO|DO|CAR|CMT|PAR|FC|LDE|LDI|BLQ|EST|IDC|PMT|TRI|CLO)-[0-9]{1,3}\b/;

function criarClientServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

type ClientServiceRole = NonNullable<ReturnType<typeof criarClientServiceRole>>;

/** Corpo cru guardado com teto: o registro e diagnostico, nao arquivo. */
const LIMITE_CORPO = 20_000;

/**
 * Grava a requisicao ANTES de qualquer decisao e devolve o id da linha.
 *
 * Nao lanca NUNCA: o evento vale mais que o registro dele. Se a gravacao
 * falhar, devolve null, o erro aparece no log e o processamento segue — o que
 * se perde e a memoria daquela requisicao, nao a atualizacao do pedido.
 */
async function registrarRecebimento(
  supabase: ClientServiceRole | null,
  corpoBruto: string,
  tamanhoAssinatura: number
): Promise<number | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("correios_webhook_eventos")
      .insert({
        resultado: "recebido",
        corpo_bruto: corpoBruto.slice(0, LIMITE_CORPO),
        assinatura_len: tamanhoAssinatura
      })
      .select("id")
      .single();
    if (error) {
      console.error("[correios/webhook] Falha ao registrar o recebimento:", error.message);
      return null;
    }
    return Number(data.id);
  } catch (e) {
    console.error("[correios/webhook] Excecao ao registrar o recebimento:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Atualiza o desfecho do registro. Mesma regra: falhou, loga e segue. */
async function marcarRegistro(
  supabase: ClientServiceRole | null,
  registroId: number | null,
  patch: { resultado?: string; detalhe?: string; objeto?: string; tipo_evento?: string; id_int?: number }
): Promise<void> {
  if (!supabase || registroId === null) return;
  // Corpo ilegível não rende objeto nem tipo: um UPDATE sem campo nenhum seria
  // uma ida ao banco para nada — e o PostgREST recusa.
  if (Object.keys(patch).length === 0) return;
  try {
    const { error } = await supabase.from("correios_webhook_eventos").update(patch).eq("id", registroId);
    if (error) console.error(`[correios/webhook] Falha ao atualizar o registro ${registroId}:`, error.message);
  } catch (e) {
    console.error(`[correios/webhook] Excecao ao atualizar o registro ${registroId}:`, e instanceof Error ? e.message : e);
  }
}

/** Compara a assinatura recebida com HMAC-SHA256 do corpo, em hex e base64. */
function assinaturaValida(corpoBruto: string, header: string, secret: string): boolean {
  const recebida = header.replace(/^sha256=/i, "").trim();
  const hmac = crypto.createHmac("sha256", secret).update(corpoBruto, "utf8");
  const candidatas = [hmac.digest("hex")];
  candidatas.push(Buffer.from(candidatas[0], "hex").toString("base64"));
  return candidatas.some((c) => {
    const a = Buffer.from(c.toLowerCase());
    const b = Buffer.from(recebida.toLowerCase());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

type CampoBusca = string | null | undefined;

/** Primeiro valor string não-vazio entre os candidatos. */
function primeiro(...valores: CampoBusca[]): string {
  for (const v of valores) if (typeof v === "string" && v.trim() !== "") return v.trim();
  return "";
}

export async function POST(request: Request) {
  const secret = (process.env.CORREIOS_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ success: false, message: "Webhook não configurado." }, { status: 503 });
  }

  const corpoBruto = await request.text();
  const assinatura = request.headers.get("x-correios-signature") ?? "";

  // O cliente sobe ANTES da validação porque a requisição recusada é
  // justamente a que mais precisa ficar registrada: é ela que distingue
  // "os Correios não chamaram" de "chamaram e o segredo diverge". Sem
  // service-role não há registro, e aí só resta o log — mesma situação de antes.
  const supabase = criarClientServiceRole();
  const registroId = await registrarRecebimento(supabase, corpoBruto, assinatura.length);

  if (!assinatura || !assinaturaValida(corpoBruto, assinatura, secret)) {
    // Log de calibração sem vazar nada sensível: só formato/tamanho do header.
    console.warn(
      `[correios/webhook] Assinatura inválida ou ausente (len=${assinatura.length}, prefixo="${assinatura.slice(0, 7)}").`
    );
    await marcarRegistro(supabase, registroId, {
      resultado: "assinatura_invalida",
      detalhe: assinatura ? "assinatura não confere com o corpo" : "header x-correios-signature ausente"
    });
    return NextResponse.json({ success: false, message: "Assinatura inválida." }, { status: 401 });
  }

  // Corpo tolerante: JSON quando der; regex como rede de segurança.
  let corpo: Record<string, unknown> = {};
  try {
    corpo = JSON.parse(corpoBruto) as Record<string, unknown>;
  } catch {
    corpo = {};
  }
  // O payload documentado (EventoResponse.payload) é string — pode vir JSON aninhado.
  let payloadInterno: Record<string, unknown> = {};
  if (typeof corpo.payload === "string") {
    try {
      payloadInterno = JSON.parse(corpo.payload) as Record<string, unknown>;
    } catch {
      payloadInterno = {};
    }
  } else if (corpo.payload && typeof corpo.payload === "object") {
    payloadInterno = corpo.payload as Record<string, unknown>;
  }

  const objeto =
    primeiro(
      corpo.codigoObjeto as CampoBusca,
      corpo.codObjeto as CampoBusca,
      corpo.objeto as CampoBusca,
      payloadInterno.codigoObjeto as CampoBusca,
      payloadInterno.codObjeto as CampoBusca,
      payloadInterno.objeto as CampoBusca
    ) || (REGEX_OBJETO.exec(corpoBruto)?.[0] ?? "");

  const tipoEvento = (
    primeiro(
      request.headers.get("x-correios-hook-event"),
      corpo.tpEvento as CampoBusca,
      corpo.tipoEvento as CampoBusca,
      payloadInterno.tpEvento as CampoBusca,
      payloadInterno.tipoEvento as CampoBusca
    ) || (REGEX_TIPO_EVENTO.exec(corpoBruto)?.[0] ?? "")
  ).toUpperCase();

  const descricao = primeiro(
    corpo.descricao as CampoBusca,
    corpo.descricaoEvento as CampoBusca,
    payloadInterno.descricao as CampoBusca,
    payloadInterno.descricaoEvento as CampoBusca
  );
  const instanteEvento =
    primeiro(
      corpo.dtEvento as CampoBusca,
      corpo.criadoEm as CampoBusca,
      payloadInterno.dtEvento as CampoBusca,
      payloadInterno.criadoEm as CampoBusca
    ) || new Date().toISOString();

  // O que se conseguiu ler do corpo entra no registro antes de qualquer
  // desfecho — inclusive quando não deu para reconhecer o objeto.
  await marcarRegistro(supabase, registroId, {
    ...(objeto ? { objeto } : {}),
    ...(tipoEvento ? { tipo_evento: tipoEvento } : {})
  });

  if (!objeto) {
    // 200 de propósito: 4xx faria os Correios reenviarem algo que nunca vamos entender.
    console.warn(`[correios/webhook] Evento sem código de objeto reconhecível (tipo="${tipoEvento}").`);
    await marcarRegistro(supabase, registroId, {
      resultado: "ignorado",
      detalhe: "corpo sem código de objeto reconhecível"
    });
    return NextResponse.json({ success: true, ignorado: true });
  }

  if (!supabase) {
    console.error("[correios/webhook] SUPABASE_SERVICE_ROLE_KEY ausente — evento não processado.");
    return NextResponse.json({ success: false, message: "Backend não configurado." }, { status: 500 });
  }

  // Objeto -> pedido: campo oficial primeiro, rastreio como fallback (código manual).
  let idInt: number | null = null;
  const porPrepostagem = await supabase
    .from("expedicoes")
    .select("id_int")
    .eq("correios_codigo_objeto", objeto)
    .maybeSingle();
  if (porPrepostagem.data?.id_int) idInt = Number(porPrepostagem.data.id_int);
  if (idInt === null) {
    const porRastreio = await supabase
      .from("expedicoes")
      .select("id_int")
      .eq("codigo_rastreamento", objeto)
      .maybeSingle();
    if (porRastreio.data?.id_int) idInt = Number(porRastreio.data.id_int);
  }
  if (idInt === null) {
    console.warn(`[correios/webhook] Objeto ${objeto} sem pedido correspondente (evento ${tipoEvento}).`);
    await marcarRegistro(supabase, registroId, {
      resultado: "objeto_desconhecido",
      detalhe: "objeto não casa com correios_codigo_objeto nem codigo_rastreamento"
    });
    return NextResponse.json({ success: true, ignorado: true });
  }

  // Sempre: último evento no registro de expedição (banco acompanha o objeto sozinho).
  const rotuloEvento = `${tipoEvento}${descricao ? `: ${descricao}` : ""}`.slice(0, 200) || "(evento sem tipo)";
  const { error: upErr } = await supabase
    .from("expedicoes")
    .update({
      correios_ultimo_evento: rotuloEvento,
      correios_ultimo_evento_em: instanteEvento,
      updated_at: new Date().toISOString()
    })
    .eq("id_int", idInt);
  if (upErr) console.warn(`[correios/webhook] Falha ao gravar último evento do #${idInt}:`, upErr.message);

  // Transições oficiais — guardadas por status esperado, com trilha.
  // O par vem colado ("BDE-01") e as listas guardam a forma sem zero ("BDE-1").
  // Comparar a string crua contra o Set era o suficiente para uma entrega real
  // gravar `correios_ultimo_evento` e NÃO mudar o status: o SRO devolve o tipo
  // zero-preenchido. `eventoEh*` normaliza pelo mesmo `chaveEvento` que a tela usa.
  const [codigoEvento, numeroEvento] = separarTipoEvento(tipoEvento);
  const desejaTransito = eventoEhTransito(codigoEvento, numeroEvento);
  const desejaEntrega = eventoEhEntrega(codigoEvento, numeroEvento);
  // Vira o `detalhe` do registro: diz, sem abrir o log da Vercel, se o evento
  // mudou status, se era informativo ou se a guarda de status barrou.
  let desfecho = "evento informativo: só último evento";
  if (desejaTransito || desejaEntrega) {
    const statusNovo = desejaEntrega ? "ENTREGUE" : "EM TRANSITO";
    // Entrega vale a partir de EXPEDICAO também (cobre PO-* perdido); postagem só de EXPEDICAO.
    const statusEsperados = desejaEntrega ? ["EXPEDICAO", "EM TRANSITO"] : ["EXPEDICAO"];

    const { data: atual } = await supabase
      .from("propostas")
      .select("status_interno")
      .eq("id_int", idInt)
      .maybeSingle();
    const statusAnterior = String(atual?.status_interno ?? "");

    if (statusEsperados.includes(statusAnterior)) {
      const { data: linhas, error: trErr } = await supabase
        .from("propostas")
        .update({ status_interno: statusNovo })
        .eq("id_int", idInt)
        .eq("status_interno", statusAnterior)
        .select("id_int");
      if (trErr) {
        console.error(`[correios/webhook] Falha ao transicionar #${idInt} para ${statusNovo}:`, trErr.message);
        desfecho = `falha ao transicionar para ${statusNovo}: ${trErr.message}`.slice(0, 300);
      } else if (linhas && linhas.length > 0) {
        desfecho = `${statusAnterior} -> ${statusNovo}`;
        if (desejaEntrega) {
          const { error: entregaErr } = await supabase
            .from("expedicoes")
            .update({ data_entrega: instanteEvento, updated_at: new Date().toISOString() })
            .eq("id_int", idInt);
          if (entregaErr) console.warn(`[correios/webhook] Falha ao gravar data_entrega do #${idInt}:`, entregaErr.message);
        }
        const { error: logErr } = await supabase.from("os_status_log").insert({
          id_int: idInt,
          status_anterior: statusAnterior,
          status_novo: statusNovo,
          resultado: "sucesso",
          motivo: `Evento ${rotuloEvento}`.slice(0, 200),
          origem: "CORREIOS_WEBHOOK",
          ator_tipo: "SISTEMA",
          ator_uid: null,
          ator_nome: "Webhook Correios",
          tipo_transicao: "NATURAL"
        });
        if (logErr) console.warn(`[correios/webhook] Falha ao logar transição do #${idInt}:`, logErr.message);
      } else {
        // Guarda de status barrou: o pedido não estava onde a transição exige.
        // Não é erro — é o compare-and-swap fazendo o trabalho dele.
        desfecho = `sem transição: pedido em ${statusAnterior}, ${statusNovo} exige ${statusEsperados.join(" ou ")}`;
      }
    } else {
      desfecho = `sem transição: pedido em ${statusAnterior}, ${statusNovo} exige ${statusEsperados.join(" ou ")}`;
    }
  }

  await marcarRegistro(supabase, registroId, {
    resultado: "aceito",
    id_int: idInt,
    detalhe: desfecho.slice(0, 300)
  });

  return NextResponse.json({ success: true });
}
