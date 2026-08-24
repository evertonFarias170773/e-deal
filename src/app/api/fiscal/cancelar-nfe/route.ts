import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

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
 */

export const maxDuration = 60;

const WEBHOOK_CANCELAR_NFE = "https://10074.hostoo.net.br/webhook/cancelamento";
const WEBHOOK_CANCELAR_NFSE = "https://10074.hostoo.net.br/webhook/cancelamento-nfse";

/** Único estado a partir do qual cancelar é legítimo. */
const STATUS_CANCELAVEL = "AUTORIZADA";

/** A SEFAZ e as prefeituras exigem justificativa; 15 é o mínimo legal da NF-e. */
const MINIMO_JUSTIFICATIVA = 15;

type NotaCancelavel = {
  id: string;
  ref: string;
  status: string;
  id_empresa: number | null;
  data_cancelamento?: string | null;
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
      .select("id, ref, status, id_empresa, data_cancelamento")
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

    /** Devolve a reserva quando o cancelamento não se concretiza. */
    async function liberarReserva() {
      if (ehNfse || !nota) return;
      const { error } = await supabase
        .from("notas_fiscais")
        .update({ data_cancelamento: null, updated_at: new Date().toISOString() })
        .eq("id", nota.id);
      if (error) {
        console.error("[API][CancelarNfe] Falha ao liberar a reserva:", error.message);
      }
    }

    // 7. O webhook do n8n, com o mesmo corpo de sempre, agora do servidor.
    const webhook = ehNfse ? WEBHOOK_CANCELAR_NFSE : WEBHOOK_CANCELAR_NFE;
    let response: Response;
    try {
      response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_empresa: Number(nota.id_empresa),
          referencia: nota.ref,
          justificativa,
        }),
      });
    } catch (err) {
      console.error("[API][CancelarNfe] Webhook inacessível:", err);
      await liberarReserva();
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
      await liberarReserva();
      return NextResponse.json({ success: false, message }, { status: 502 });
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

    // 8. Autoria, a partir da sessão do servidor — nunca de valor do cliente.
    //    `criado_por`/`criado_por_nome` da nota são de quem criou o rascunho e
    //    NÃO podem ser sobrescritos: por isso as colunas próprias.
    if (!ehNfse) {
      const metadados = (authData.user.user_metadata ?? {}) as Record<string, unknown>;
      const nomeAutor =
        String(metadados.nome ?? "").trim() ||
        String(metadados.full_name ?? "").trim() ||
        String(authData.user.email ?? "").trim() ||
        null;

      const { error: autoriaError } = await supabase
        .from("notas_fiscais")
        .update({
          cancelado_por: authData.user.id,
          cancelado_por_nome: nomeAutor,
          updated_at: new Date().toISOString(),
        })
        .eq("id", nota.id);

      if (autoriaError) {
        // A nota foi cancelada no banco de dados fiscal; perder a autoria não
        // desfaz isso. Registra e segue — a tela conclui o restante.
        console.error("[API][CancelarNfe] Falha ao gravar a autoria:", autoriaError.message);
      }
    }

    return NextResponse.json({
      success: true,
      ref: nota.ref,
      tipo: ehNfse ? "NFSE" : "NFE",
      retorno,
    });
  } catch (err) {
    console.error("[API][CancelarNfe] Erro inesperado:", err);
    return NextResponse.json(
      { success: false, message: "Erro inesperado ao cancelar a nota." },
      { status: 500 }
    );
  }
}
