import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { cabecalhosWebhookN8n } from "@/lib/n8n/webhook-segredo";
import {
  MENSAGEM_JA_CANCELADA,
  desfechoDoCancelamento,
  montarEventoCancelamento,
  prazoDoCancelamento,
  type DesfechoDoCancelamento
} from "@/lib/fiscal/cancelamento-nfe";

/**
 * Cancelamento de nota fiscal — porta de entrada no servidor.
 *
 * POR QUE EXISTE
 *   Até aqui a tela chamava o webhook do n8n direto do browser, com as duas URLs
 *   literais no código do cliente. Quem soubesse a URL cancelava nota fiscal:
 *   sem sessão, sem `fiscal.cancel_nf` fora da UI e sem trava contra chamada
 *   concorrente. É o mesmo desenho que a emissão tinha antes de existir
 *   `/api/fiscal/emitir-nfe`, e esta rota replica o padrão de lá.
 *
 * NF-e E NFS-e PELA MESMA ROTA
 *   Quem decide qual webhook chamar é o servidor, pela TABELA em que a `ref`
 *   existe — `notas_fiscais` para NF-e, `notas_servico` para NFS-e. Nunca por
 *   flag vinda do cliente.
 *
 * QUEM DECIDE SE CANCELOU É ESTA ROTA (27/10/2026)
 *   Antes a rota só repassava o retorno e a TELA gravava CANCELADA sempre que
 *   não via sinal de erro — e "autorizado"/100 não é erro. Três notas ficaram
 *   CANCELADA no Vibe sem a SEFAZ ter cancelado. Agora a decisão é
 *   `desfechoDoCancelamento` (lib/fiscal/cancelamento-nfe): CANCELADA só com
 *   "cancelado" + cStat 135/155 + caminho do XML. Qualquer outra resposta libera
 *   a reserva, grava o evento como "falha" e devolve 422 com o motivo da Focus.
 *   A tela não grava mais nada do cancelamento.
 *
 *   Antes do webhook a rota recusa, sem chamar a Focus: nota fora do prazo de
 *   24 h (ou sem data de autorização) e nota que já tem evento "cancelado".
 */

export const maxDuration = 60;

const WEBHOOK_CANCELAR_NFE = "https://10074.hostoo.net.br/webhook/cancelamento";
const WEBHOOK_CANCELAR_NFSE = "https://10074.hostoo.net.br/webhook/cancelamento-nfse";

/** Único estado a partir do qual cancelar é legítimo. */
const STATUS_CANCELAVEL = "AUTORIZADA";

/** A SEFAZ e as prefeituras exigem justificativa; 15 é o mínimo legal da NF-e. */
const MINIMO_JUSTIFICATIVA = 15;

/** O que a tela mostra quando alguém tenta cancelar NFS-e (ver o passo 4b). */
const MENSAGEM_CANCELAMENTO_NFSE_INDISPONIVEL =
  "Cancelamento de NFS-e ainda não está disponível no Vibe. Cancele pelo portal nacional (www.nfse.gov.br) e avise o fiscal.";

type NotaCancelavel = {
  id: string;
  ref: string;
  status: string;
  id_empresa: number | null;
  data_cancelamento?: string | null;
  data_autorizacao?: string | null;
};

/** Extrai a mensagem real do webhook para que a recusa chegue à tela. */
async function mensagemDoWebhook(response: Response): Promise<string> {
  const padrao = `Erro na comunicação com a integração fiscal (HTTP ${response.status}).`;
  try {
    const texto = await response.text();
    if (!texto) return padrao;
    try {
      const dados = JSON.parse(texto) as Record<string, unknown>;
      const alvo = Array.isArray(dados) ? (dados[0] as Record<string, unknown>) : dados;
      const bruto =
        alvo?.erro ?? alvo?.error ?? alvo?.mensagem ?? alvo?.message ?? alvo?.mensagem_sefaz;
      const legivel = String(bruto ?? "").trim();
      return legivel || padrao;
    } catch {
      return texto.slice(0, 500);
    }
  } catch {
    return padrao;
  }
}

export async function POST(request: Request) {
  try {
    // 1. Do corpo vêm só o identificador e a justificativa. Todo o resto é relido.
    let ref = "";
    let justificativa = "";
    try {
      const body = (await request.json()) as { ref?: unknown; justificativa?: unknown };
      ref = String(body?.ref ?? "").trim();
      justificativa = String(body?.justificativa ?? "").trim();
    } catch {
      return NextResponse.json(
        { success: false, message: "Corpo da requisição inválido." },
        { status: 400 }
      );
    }

    if (!ref) {
      return NextResponse.json(
        { success: false, message: "Referência da nota ausente." },
        { status: 400 }
      );
    }

    // A tela já cobra o mínimo, mas quem garante é o servidor.
    if (justificativa.length < MINIMO_JUSTIFICATIVA) {
      return NextResponse.json(
        {
          success: false,
          code: "JUSTIFICATIVA_CURTA",
          message: `A justificativa do cancelamento precisa de pelo menos ${MINIMO_JUSTIFICATIVA} caracteres.`,
        },
        { status: 400 }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[API][CancelarNfe] ENV AUSENTE");
      return NextResponse.json(
        { success: false, message: "Erro interno no servidor de banco de dados." },
        { status: 500 }
      );
    }

    // 2. Sessão. JWT do usuário, sem service role — a RLS continua valendo.
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
    }

    const supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
    }

    // 3. Permissão, conferida no servidor.
    const temPermissao = await verificarPermissaoServerSide(
      supabase,
      authData.user.id,
      "fiscal.cancel_nf"
    );
    if (!temPermissao) {
      return NextResponse.json(
        { success: false, message: "Sem permissão para cancelar nota fiscal (fiscal.cancel_nf)." },
        { status: 403 }
      );
    }

    // 4. Releitura. O TIPO sai daqui: a tabela em que a `ref` existe decide se é
    //    NF-e ou NFS-e. Nada do corpo além de `ref` e `justificativa` é usado.
    const { data: nfeRow, error: nfeError } = await supabase
      .from("notas_fiscais")
      .select("id, ref, status, id_empresa, data_cancelamento, data_autorizacao")
      .eq("ref", ref)
      .maybeSingle();

    if (nfeError) {
      console.error("[API][CancelarNfe] Falha ao reler a NF-e:", nfeError.message);
      return NextResponse.json(
        { success: false, message: "Não foi possível ler a nota no banco." },
        { status: 500 }
      );
    }

    let nota = nfeRow as NotaCancelavel | null;
    let ehNfse = false;

    if (!nota) {
      const { data: nfseRow, error: nfseError } = await supabase
        .from("notas_servico")
        .select("id, ref, status, id_empresa")
        .eq("ref", ref)
        .maybeSingle();

      if (nfseError) {
        console.error("[API][CancelarNfe] Falha ao reler a NFS-e:", nfseError.message);
        return NextResponse.json(
          { success: false, message: "Não foi possível ler a nota no banco." },
          { status: 500 }
        );
      }
      nota = nfseRow as NotaCancelavel | null;
      ehNfse = Boolean(nota);
    }

    if (!nota) {
      return NextResponse.json(
        { success: false, message: "Nota fiscal não encontrada." },
        { status: 404 }
      );
    }

    // 4b. NFS-e: o cancelamento pelo Vibe está FECHADO (06/10/2026).
    //
    //     O ramo de NFS-e do fluxo de cancelamento no n8n está errado para a
    //     NFS-e nacional: host de homologação com a credencial de produção,
    //     endpoint municipal e método de emissão. Enquanto ele não for
    //     corrigido, a recusa sai daqui — antes do webhook e sem gravar nada —
    //     para ninguém acreditar que cancelou uma nota que continua valendo.
    //     A NF-e não passa por este `if`: segue exatamente como era.
    if (ehNfse) {
      return NextResponse.json(
        {
          success: false,
          code: "CANCELAMENTO_NFSE_INDISPONIVEL",
          message: MENSAGEM_CANCELAMENTO_NFSE_INDISPONIVEL,
        },
        { status: 422 }
      );
    }

    // 5. Guardas declarativas.
    const status = String(nota.status ?? "").toUpperCase();
    if (status !== STATUS_CANCELAVEL) {
      return NextResponse.json(
        {
          success: false,
          code: "NOTA_NAO_CANCELAVEL",
          message: `Cancelamento não permitido: a nota está em "${status || "SEM STATUS"}" e só pode ser cancelada quando está "${STATUS_CANCELAVEL}".`,
        },
        { status: 409 }
      );
    }

    if (!ehNfse && nota.data_cancelamento) {
      return NextResponse.json(
        {
          success: false,
          code: "NOTA_JA_CANCELADA",
          message: "Esta nota já tem cancelamento registrado.",
        },
        { status: 409 }
      );
    }

    if (!nota.id_empresa) {
      return NextResponse.json(
        { success: false, code: "SEM_EMPRESA", message: "A empresa emitente da nota não foi identificada." },
        { status: 409 }
      );
    }

    // 5b. Prazo da SEFAZ, contado da autorização. Fora dele (ou sem a data), a
    //     Focus não é chamada: a tela explica e orienta procurar a contabilidade.
    const prazo = prazoDoCancelamento(nota.data_autorizacao, new Date());
    if (!prazo.dentro) {
      return NextResponse.json(
        { success: false, code: prazo.motivo, message: prazo.mensagem },
        { status: 422 }
      );
    }

    // 5c. Idempotência: se já existe evento "cancelado" para a nota, a SEFAZ já
    //     cancelou — não se pede de novo nem se grava segundo evento.
    const { data: jaCancelada, error: jaCanceladaError } = await supabase
      .from("notas_eventos")
      .select("id")
      .eq("tipo_documento", "NFE")
      .eq("ref", nota.ref)
      .eq("tipo_evento", "CANCELAMENTO")
      .eq("status_evento", "cancelado")
      .limit(1);
    if (jaCanceladaError) {
      console.error("[API][CancelarNfe] Falha ao conferir eventos anteriores:", jaCanceladaError.message);
      return NextResponse.json(
        { success: false, message: "Não foi possível conferir os eventos da nota no banco." },
        { status: 500 }
      );
    }
    if (Array.isArray(jaCancelada) && jaCancelada.length > 0) {
      return NextResponse.json(
        { success: false, code: "CANCELAMENTO_JA_CONFIRMADO", message: MENSAGEM_JA_CANCELADA },
        { status: 409 }
      );
    }

    // 6. Trava contra cancelamento concorrente — compare-and-swap de estado.
    //
    //    A checagem acima não basta: duas chamadas simultâneas leem o mesmo
    //    estado e passam as duas. Quem decide é este UPDATE condicional, que
    //    RESERVA o cancelamento marcando `data_cancelamento` enquanto o `status`
    //    segue AUTORIZADA. O Postgres serializa as escritas na mesma linha: a
    //    segunda chamada não casa mais `IS NULL` e afeta ZERO linhas.
    //
    //    A reserva vem antes do webhook de propósito, e o `status` só muda
    //    depois da confirmação — assim uma falha de comunicação não deixa a nota
    //    parecendo cancelada. Se o webhook falhar, a reserva é liberada.
    //
    //    `notas_servico` NÃO tem `data_cancelamento`: para NFS-e não há reserva
    //    possível sem coluna nova, e esta rodada não cria coluna. A NFS-e ganha
    //    sessão, permissão, guardas e a chamada saindo do servidor — mas não a
    //    trava contra concorrência.
    const agora = new Date().toISOString();

    if (!ehNfse) {
      const { data: reserva, error: reservaError } = await supabase
        .from("notas_fiscais")
        .update({ data_cancelamento: agora, updated_at: agora })
        .eq("id", nota.id)
        .eq("status", STATUS_CANCELAVEL)
        .is("data_cancelamento", null)
        .select("id");

      if (reservaError) {
        console.error("[API][CancelarNfe] Falha ao reservar o cancelamento:", reservaError.message);
        return NextResponse.json(
          { success: false, message: "Não foi possível reservar o cancelamento no banco." },
          { status: 500 }
        );
      }

      if (!reserva || reserva.length === 0) {
        return NextResponse.json(
          {
            success: false,
            code: "CANCELAMENTO_EM_ANDAMENTO",
            message: "Outro cancelamento desta mesma nota já está em andamento. Aguarde e recarregue a lista.",
          },
          { status: 409 }
        );
      }
    }

    /** Devolve a reserva quando o cancelamento não se concretiza — só a PRÓPRIA reserva. */
    async function liberarReserva() {
      if (ehNfse || !nota) return;
      const { error } = await supabase
        .from("notas_fiscais")
        .update({ data_cancelamento: null, updated_at: new Date().toISOString() })
        .eq("id", nota.id)
        .eq("status", STATUS_CANCELAVEL)
        .eq("data_cancelamento", agora);
      if (error) {
        console.error("[API][CancelarNfe] Falha ao liberar a reserva:", error.message);
      }
    }

    // Autoria, a partir da sessão do servidor — nunca de valor do cliente.
    // `criado_por`/`criado_por_nome` da nota são de quem criou o rascunho e
    // NÃO podem ser sobrescritos: por isso as colunas próprias.
    const usuario = authData.user;
    const metadados = (usuario.user_metadata ?? {}) as Record<string, unknown>;
    const nomeAutor =
      String(metadados.nome ?? "").trim() ||
      String(metadados.full_name ?? "").trim() ||
      String(usuario.email ?? "").trim() ||
      null;
    const idEmpresa = Number(nota.id_empresa);
    const refNota = nota.ref;

    /** Grava o evento (confirmado ou falha). Falhar aqui não muda o desfecho. */
    async function gravarEvento(desfecho: DesfechoDoCancelamento, respostaSemCorpo?: { motivo: string }) {
      const evento = montarEventoCancelamento({
        ref: refNota,
        idEmpresa,
        justificativa,
        desfecho,
        respostaSemCorpo: respostaSemCorpo ?? null,
        criadoPor: usuario.id,
        criadoPorNome: nomeAutor
      });
      const { error } = await supabase.from("notas_eventos").insert(evento);
      if (error) {
        console.error(
          "[API][CancelarNfe] Evento não gravado:",
          error.message,
          JSON.stringify({ ref: refNota, status_evento: evento.status_evento })
        );
        return false;
      }
      return true;
    }

    /** Falha de transporte: a nota segue AUTORIZADA e o evento fica como falha. */
    async function falhaDeIntegracao(motivo: string) {
      await liberarReserva();
      await gravarEvento(desfechoDoCancelamento(null), { motivo });
    }

    // 7. O webhook do n8n, com o mesmo corpo de sempre, agora do servidor.
    const webhook = ehNfse ? WEBHOOK_CANCELAR_NFSE : WEBHOOK_CANCELAR_NFE;
    let response: Response;
    try {
      response = await fetch(webhook, {
        method: "POST",
        headers: cabecalhosWebhookN8n(),
        body: JSON.stringify({
          id_empresa: Number(nota.id_empresa),
          referencia: nota.ref,
          justificativa,
        }),
      });
    } catch (err) {
      console.error("[API][CancelarNfe] Webhook inacessível:", err);
      await falhaDeIntegracao("Integração fiscal inacessível.");
      return NextResponse.json(
        {
          success: false,
          message: "Não foi possível contatar a integração fiscal. A nota segue como está.",
        },
        { status: 502 }
      );
    }

    if (!response.ok) {
      const message = await mensagemDoWebhook(response);
      await falhaDeIntegracao(message);
      return NextResponse.json(
        { success: false, code: "INTEGRACAO_RECUSOU", message: `${message} A nota continua AUTORIZADA.` },
        { status: 502 }
      );
    }

    let retorno: unknown = null;
    try {
      const texto = await response.text();
      if (texto) {
        try {
          retorno = JSON.parse(texto);
        } catch {
          retorno = texto;
        }
      }
    } catch (err) {
      console.warn("[API][CancelarNfe] Nao foi possivel ler o corpo do webhook:", err);
    }

    // 8. A decisão. Só "cancelado" + cStat 135/155 + caminho do XML é cancelamento.
    const desfecho = desfechoDoCancelamento(retorno);

    if (!desfecho.confirmado) {
      await liberarReserva();
      const eventoGravado = await gravarEvento(desfecho);
      return NextResponse.json(
        {
          success: false,
          code: "CANCELAMENTO_NAO_CONFIRMADO",
          message: desfecho.mensagem,
          status_focus: desfecho.statusFocus,
          status_sefaz: desfecho.statusSefaz,
          mensagem_sefaz: desfecho.mensagemSefaz,
          eventoGravado,
        },
        { status: 422 }
      );
    }

    // 9. Confirmado. O UPDATE só casa se a nota ainda está AUTORIZADA e com a
    //    PRÓPRIA reserva (`data_cancelamento` = a marca desta chamada).
    const { data: atualizadas, error: updateError } = await supabase
      .from("notas_fiscais")
      .update({
        status: "CANCELADA",
        status_focus: desfecho.statusFocus,
        status_sefaz: desfecho.statusSefaz,
        codigo_status_sefaz: desfecho.statusSefaz,
        mensagem_sefaz: desfecho.mensagemSefaz,
        erro_codigo: null,
        erro_mensagem: null,
        payload_retorno: desfecho.focus,
        cancelado_por: usuario.id,
        cancelado_por_nome: nomeAutor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", nota.id)
      .eq("status", STATUS_CANCELAVEL)
      .eq("data_cancelamento", agora)
      .select("id");

    const notaAtualizada = !updateError && Array.isArray(atualizadas) && atualizadas.length > 0;
    if (!notaAtualizada) {
      // A SEFAZ cancelou; o Vibe não conseguiu marcar. Não se esconde: o evento
      // é gravado igual e a tela avisa para recarregar e conferir.
      console.error(
        "[API][CancelarNfe] Cancelamento confirmado, mas a nota não foi marcada:",
        updateError?.message ?? "nenhuma linha casou (status ou reserva mudaram)",
        JSON.stringify({ ref: nota.ref })
      );
    }

    const eventoGravado = await gravarEvento(desfecho);

    return NextResponse.json({
      success: true,
      ref: nota.ref,
      tipo: "NFE",
      message: notaAtualizada
        ? "A SEFAZ confirmou o cancelamento. A nota está CANCELADA."
        : "A SEFAZ confirmou o cancelamento, mas o Vibe não conseguiu marcar a nota. Recarregue a lista e avise o suporte.",
      notaAtualizada,
      eventoGravado,
      status_sefaz: desfecho.statusSefaz,
      mensagem_sefaz: desfecho.mensagemSefaz,
    });
  } catch (err) {
    console.error("[API][CancelarNfe] Erro inesperado:", err);
    return NextResponse.json(
      { success: false, message: "Erro inesperado ao cancelar a nota." },
      { status: 500 }
    );
  }
}
