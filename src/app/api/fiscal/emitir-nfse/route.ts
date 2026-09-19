import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { resolverAmbienteFiscal } from "@/features/fiscal/services/ambiente-fiscal";
import {
  detectarNfseJaEmitida,
  mensagemNfseJaEmitida
} from "@/features/fiscal/services/nfse-ja-emitida";

/**
 * Emissão de NFS-e — porta de entrada no servidor.
 *
 * POR QUE EXISTE
 *   Até aqui NÃO HAVIA porta. O webhook `emitir-nfse-focus` do n8n estava
 *   aberto: sem sessão, sem permissão e sem trava. Quem soubesse a URL e uma
 *   `ref` emitia nota de serviço. Do lado do banco só existia
 *   `fn_preparar_envio_nfse`, que valida e monta o payload mas NÃO barra
 *   repetição — ela apenas incrementa `tentativas_envio`. As notas de maio
 *   guardam a prova: duas delas chegaram a OITO tentativas.
 *
 *   Esta rota é o equivalente de `/api/fiscal/emitir-nfe` para o serviço, e foi
 *   escrita no mesmo molde de propósito: quem conhece uma conhece a outra.
 *
 * O QUE MUDA
 *   Muda quem chama, não o que é chamado. O webhook, a URL e o corpo enviados
 *   ao n8n são os mesmos de sempre; o fluxo segue dono das colunas que já
 *   escreve (numero_nfse, codigo_verificacao, DPS, caminhos, payload_retorno).
 *
 * O QUE ESTA RODADA NÃO FAZ
 *   Não cria tela, não cria rascunho e não mexe no n8n. Hoje nenhuma tela chama
 *   esta rota — ela existe para que, quando a tela nascer, o caminho já esteja
 *   fechado. Fechar a porta antes de abrir a casa é o ponto.
 */

export const maxDuration = 60;

const WEBHOOK_EMITIR_NFSE = "https://10074.hostoo.net.br/webhook/emitir-nfse-focus";

/**
 * Os estados em que a nota AINDA NÃO virou documento e o envio é legítimo.
 *
 * A NF-e aceita só `PRONTA_PARA_ENVIO` porque lá a preparação é um passo da
 * tela: `NfeDetailPage` grava o payload e muda o status antes de o modal chamar
 * a rota. Na NFS-e a preparação é o PRIMEIRO NÓ do fluxo — o n8n chama
 * `fn_preparar_envio_nfse`, que valida, monta e só então põe
 * `PRONTA_PARA_ENVIO`. Exigir aqui o estado que o próprio fluxo produz
 * trancaria toda primeira emissão.
 *
 * Então a regra é pelo avesso: recusa quem JÁ é documento (AUTORIZADA,
 * CANCELADA) e quem está em trânsito (PROCESSANDO), e deixa passar rascunho e
 * tentativa anterior que falhou. Estado desconhecido também é recusado — a
 * lista é fechada.
 */
const STATUS_ENVIAVEIS: readonly string[] = [
  "PENDENTE",
  "PRONTA_PARA_ENVIO",
  "ERRO_VALIDACAO",
  "ERRO_ENVIO",
  "REJEITADA"
];

type NotaServicoParaEnvio = {
  id: string;
  ref: string;
  status: string;
  numero_nfse: string | null;
  codigo_verificacao: string | null;
  tentativas_envio: number | null;
  id_empresa: number | null;
  /** O retorno da Focus. É aqui que mora a verdade quando as colunas mentem. */
  payload_retorno: unknown;
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
        alvo?.erro ?? alvo?.error ?? alvo?.mensagem ?? alvo?.message ?? alvo?.mensagem_prefeitura;
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
      console.error("[API][EmitirNfse] ENV AUSENTE");
      return NextResponse.json(
        { success: false, message: "Erro interno no servidor de banco de dados." },
        { status: 500 }
      );
    }

    // 2. Sessão: JWT do usuário, sem service role — o RLS continua valendo.
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json(
        { success: false, message: "Sessão não encontrada." },
        { status: 401 }
      );
    }

    const supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
    }

    // 3. Permissão, conferida no servidor. A tela já usa a mesma chave.
    const temPermissao = await verificarPermissaoServerSide(
      supabase,
      authData.user.id,
      "fiscal.emit_nfse"
    );
    if (!temPermissao) {
      return NextResponse.json(
        { success: false, message: "Sem permissão para emitir NFS-e (fiscal.emit_nfse)." },
        { status: 403 }
      );
    }

    // 4. Releitura da nota. Nada do corpo além da `ref` é usado.
    const { data: notaRow, error: fetchError } = await supabase
      .from("notas_servico")
      .select(
        "id, ref, status, numero_nfse, codigo_verificacao, tentativas_envio, id_empresa, payload_retorno"
      )
      .eq("ref", ref)
      .maybeSingle();

    if (fetchError) {
      console.error("[API][EmitirNfse] Falha ao reler a nota:", fetchError.message);
      return NextResponse.json(
        { success: false, message: "Não foi possível ler a nota de serviço no banco." },
        { status: 500 }
      );
    }

    if (!notaRow) {
      return NextResponse.json(
        { success: false, message: "Nota de serviço não encontrada." },
        { status: 404 }
      );
    }

    const nota = notaRow as NotaServicoParaEnvio;

    // 5. Trava de duplicidade — a parte declarativa.
    const status = String(nota.status ?? "").toUpperCase();
    if (!STATUS_ENVIAVEIS.includes(status)) {
      return NextResponse.json(
        {
          success: false,
          code: "NFSE_NAO_ENVIAVEL",
          message: `Emissão não permitida: a nota está em "${status || "SEM STATUS"}". Só é possível enviar quando ela está em ${STATUS_ENVIAVEIS.join(", ")}.`,
        },
        { status: 409 }
      );
    }

    const numero = String(nota.numero_nfse ?? "").trim();
    const codigo = String(nota.codigo_verificacao ?? "").trim();
    if (numero || codigo) {
      return NextResponse.json(
        {
          success: false,
          code: "NFSE_JA_EMITIDA",
          message: `Esta nota de serviço já foi emitida${numero ? ` (número ${numero})` : ""}. Nova emissão bloqueada.`,
        },
        { status: 409 }
      );
    }

    // 5b. A MESMA trava, agora olhando o PAYLOAD.
    //
    //     As colunas acima ficam vazias quando o retorno é lido errado — foi
    //     assim que a NF-e já teve nota autorizada na SEFAZ que o ERP julgava
    //     nunca emitida. O payload guarda o que as colunas perderam.
    const jaEmitida = detectarNfseJaEmitida(nota.payload_retorno);
    if (jaEmitida) {
      console.warn(
        `[API][EmitirNfse] Emissao barrada pelo payload em ${nota.ref} ` +
          `(regra ${jaEmitida.regra}, numero ${jaEmitida.numero ?? "-"}).`
      );
      return NextResponse.json(
        {
          success: false,
          code: "NFSE_JA_EMITIDA_NO_PAYLOAD",
          message: mensagemNfseJaEmitida(jaEmitida),
          evidencia: jaEmitida,
        },
        { status: 409 }
      );
    }

    // 6. Ambiente, lido da empresa no momento da transmissão — mesma regra da
    //    NF-e, mesma função, só mudando o tipo do documento.
    const ambienteResolvido = await resolverAmbienteFiscal(supabase, nota.id_empresa, "NFSE");

    if (!ambienteResolvido.ok) {
      return NextResponse.json(
        { success: false, code: "AMBIENTE_NAO_DEFINIDO", message: ambienteResolvido.mensagem },
        { status: 422 }
      );
    }

    // 6b. PRODUÇÃO NÃO TEM CAMINHO — e por isso é recusa, não registro.
    //
    //     Os dez nós Focus do fluxo de NFS-e apontam, todos, para
    //     `homologacao.focusnfe.com.br`. Se uma empresa for virada para produção
    //     em Cadastros, gravar "producao" nesta coluna enquanto o fluxo
    //     transmite para homologação faria o banco mentir sobre onde a nota
    //     saiu — exatamente o defeito que `ambiente-fiscal.ts` existe para
    //     evitar na NF-e. Melhor recusar e dizer onde arrumar.
    if (ambienteResolvido.ambiente === "producao") {
      return NextResponse.json(
        {
          success: false,
          code: "AMBIENTE_SEM_CAMINHO",
          message:
            `A empresa ${ambienteResolvido.empresa} está marcada para emitir NFS-e em produção, ` +
            `mas a integração de NFS-e ainda transmite só para homologação. ` +
            `Enquanto o fluxo não apontar para produção, a emissão fica bloqueada para não registrar ambiente errado.`,
        },
        { status: 422 }
      );
    }

    // 7. Trava de duplicidade — a parte que vale contra corrida.
    //
    //    A checagem declarativa não basta: duas chamadas simultâneas leem o
    //    mesmo estado e passam as duas. Quem decide é este UPDATE condicional,
    //    que reserva a emissão comparando `tentativas_envio` com o valor lido
    //    (compare-and-swap). O Postgres serializa as escritas na mesma linha: a
    //    primeira casa e incrementa; a segunda não casa mais o valor anterior e
    //    afeta ZERO linhas. Sem coluna nova, sem migration.
    //
    //    O `status` entra na condição junto, o que fecha também a corrida com o
    //    próprio n8n: `fn_preparar_envio_nfse` muda o status durante o envio.
    //
    //    A repetição legítima depois de uma falha continua possível: o contador
    //    apenas avança.
    const tentativasAntes = Number(nota.tentativas_envio ?? 0);
    const { data: reserva, error: reservaError } = await supabase
      .from("notas_servico")
      .update({
        tentativas_envio: tentativasAntes + 1,
        ambiente: ambienteResolvido.ambiente,
        updated_at: new Date().toISOString(),
      })
      .eq("id", nota.id)
      .eq("status", status)
      .eq("tentativas_envio", tentativasAntes)
      .is("numero_nfse", null)
      .is("codigo_verificacao", null)
      .select("id, tentativas_envio");

    if (reservaError) {
      console.error("[API][EmitirNfse] Falha ao reservar a emissão:", reservaError.message);
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

    // 8. O webhook do n8n, com o mesmo corpo de sempre. O fluxo lê só a `ref`;
    //    `supabase_url` viaja junto pela simetria com a NF-e.
    let response: Response;
    try {
      response = await fetch(WEBHOOK_EMITIR_NFSE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: nota.ref, supabase_url: url }),
      });
    } catch (err) {
      console.error("[API][EmitirNfse] Webhook inacessível:", err);
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

    // O corpo vai junto. O 200 aqui é o sucesso da CHAMADA, não da autorização:
    // quem julga o desfecho fiscal é a tela, lendo o retorno.
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
      console.warn("[API][EmitirNfse] Nao foi possivel ler o corpo do webhook:", err);
    }

    return NextResponse.json({
      success: true,
      ref: nota.ref,
      tentativas_envio: reserva[0]?.tentativas_envio ?? tentativasAntes + 1,
      retorno,
    });
  } catch (err) {
    console.error("[API][EmitirNfse] Erro inesperado:", err);
    return NextResponse.json(
      { success: false, message: "Erro inesperado ao enviar a nota de serviço." },
      { status: 500 }
    );
  }
}
