import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";

/**
 * Emissão de NF-e — porta de entrada no servidor.
 *
 * POR QUE EXISTE
 *   Até aqui a tela (`NotasFiscaisPage`, "use client") chamava o webhook do n8n
 *   direto do browser, sem cabeçalho de autenticação. Quem soubesse a URL e uma
 *   `ref` emitia nota fiscal. A permissão `fiscal.emit_nfe` era conferida só no
 *   cliente, e a única proteção contra emissão dupla era o estado de React
 *   `isSendingToFocus` — que vale para clique duplo na mesma aba e nada além.
 *
 * O QUE MUDA
 *   Muda quem chama, não o que é chamado. O webhook, a URL e o corpo enviado ao
 *   n8n continuam exatamente os mesmos. O n8n segue dono das colunas que ele já
 *   escreve (numero_nf, serie, chave_nfe, protocolo, caminhos e URLs).
 */

export const maxDuration = 60;

const WEBHOOK_EMITIR_NFE = "https://10074.hostoo.net.br/webhook/emitir-nfe-focus";

/** Único status a partir do qual emitir é legítimo. */
const STATUS_ENVIAVEL = "PRONTA_PARA_ENVIO";

type NotaParaEnvio = {
  id: string;
  ref: string;
  status: string;
  numero_nf: string | null;
  chave_nfe: string | null;
  tentativas_envio: number | null;
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
    // 1. Do corpo vem só o identificador. Todo o resto é relido do banco.
    let ref = "";
    try {
      const body = (await request.json()) as { ref?: unknown };
      ref = String(body?.ref ?? "").trim();
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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[API][EmitirNfe] ENV AUSENTE");
      return NextResponse.json(
        { success: false, message: "Erro interno no servidor de banco de dados." },
        { status: 500 }
      );
    }

    // 2. Sessão. Mesmo desenho de gerar-pix e cancelar-boleto: JWT do usuário,
    //    sem service role — as políticas de RLS continuam valendo.
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

    // 3. Permissão, agora conferida no servidor.
    const temPermissao = await verificarPermissaoServerSide(
      supabase,
      authData.user.id,
      "fiscal.emit_nfe"
    );
    if (!temPermissao) {
      return NextResponse.json(
        { success: false, message: "Sem permissão para emitir NF-e (fiscal.emit_nfe)." },
        { status: 403 }
      );
    }

    // 4. Releitura da nota. Nada do corpo além da `ref` é usado.
    const { data: notaRow, error: fetchError } = await supabase
      .from("notas_fiscais")
      .select("id, ref, status, numero_nf, chave_nfe, tentativas_envio")
      .eq("ref", ref)
      .maybeSingle();

    if (fetchError) {
      console.error("[API][EmitirNfe] Falha ao reler a nota:", fetchError.message);
      return NextResponse.json(
        { success: false, message: "Não foi possível ler a nota no banco." },
        { status: 500 }
      );
    }

    if (!notaRow) {
      return NextResponse.json(
        { success: false, message: "Nota fiscal não encontrada." },
        { status: 404 }
      );
    }

    const nota = notaRow as NotaParaEnvio;

    // 5. Trava de duplicidade — a parte declarativa.
    const status = String(nota.status ?? "").toUpperCase();
    if (status !== STATUS_ENVIAVEL) {
      return NextResponse.json(
        {
          success: false,
          code: "NOTA_NAO_ENVIAVEL",
          message: `Emissão não permitida: a nota está em "${status || "SEM STATUS"}" e só pode ser enviada quando está em "${STATUS_ENVIAVEL}".`,
        },
        { status: 409 }
      );
    }

    const numero = String(nota.numero_nf ?? "").trim();
    const chave = String(nota.chave_nfe ?? "").trim();
    if (numero || chave) {
      return NextResponse.json(
        {
          success: false,
          code: "NOTA_JA_EMITIDA",
          message: `Esta nota já foi emitida${numero ? ` (número ${numero})` : ""}. Nova emissão bloqueada.`,
        },
        { status: 409 }
      );
    }

    // 6. Trava de duplicidade — a parte que vale contra corrida.
    //
    //    A checagem acima não basta: duas chamadas simultâneas leem o mesmo
    //    estado e passam as duas. Quem decide é este UPDATE condicional, que
    //    reserva a emissão comparando `tentativas_envio` com o valor lido
    //    (compare-and-swap). O Postgres serializa as duas escritas: a primeira
    //    encontra a linha e incrementa; a segunda não casa mais o valor
    //    anterior e afeta ZERO linhas. Sem coluna nova, sem migration.
    //
    //    A repetição legítima depois de uma falha continua possível: o status
    //    permanece PRONTA_PARA_ENVIO e o contador apenas avança.
    const tentativasAntes = Number(nota.tentativas_envio ?? 0);
    const { data: reserva, error: reservaError } = await supabase
      .from("notas_fiscais")
      .update({
        tentativas_envio: tentativasAntes + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", nota.id)
      .eq("status", STATUS_ENVIAVEL)
      .eq("tentativas_envio", tentativasAntes)
      .is("numero_nf", null)
      .is("chave_nfe", null)
      .select("id, tentativas_envio");

    if (reservaError) {
      console.error("[API][EmitirNfe] Falha ao reservar a emissão:", reservaError.message);
      return NextResponse.json(
        { success: false, message: "Não foi possível reservar a emissão no banco." },
        { status: 500 }
      );
    }

    if (!reserva || reserva.length === 0) {
      return NextResponse.json(
        {
          success: false,
          code: "EMISSAO_EM_ANDAMENTO",
          message:
            "Outra emissão desta mesma nota já está em andamento. Aguarde e use \"Consultar status\".",
        },
        { status: 409 }
      );
    }

    // 7. O webhook do n8n, com o mesmo corpo de sempre.
    let response: Response;
    try {
      response = await fetch(WEBHOOK_EMITIR_NFE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: nota.ref,
          supabase_url: url,
        }),
      });
    } catch (err) {
      console.error("[API][EmitirNfe] Webhook inacessível:", err);
      return NextResponse.json(
        {
          success: false,
          message: "Não foi possível contatar a integração fiscal. A nota segue pronta para envio.",
        },
        { status: 502 }
      );
    }

    if (!response.ok) {
      const message = await mensagemDoWebhook(response);
      return NextResponse.json({ success: false, message }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      ref: nota.ref,
      tentativas_envio: reserva[0]?.tentativas_envio ?? tentativasAntes + 1,
    });
  } catch (err) {
    console.error("[API][EmitirNfe] Erro inesperado:", err);
    return NextResponse.json(
      { success: false, message: "Erro inesperado ao enviar a nota." },
      { status: 500 }
    );
  }
}
