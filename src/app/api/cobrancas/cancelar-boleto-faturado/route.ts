import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { avaliarCancelamentoNoServidor } from "@/features/cobrancas/services/cancelamento-elegibilidade.server";
import { RECUSAS_CANCELAMENTO_TITULO, isFamiliaFaturado } from "@/features/cobrancas/cancelamento-elegibilidade";

/**
 * Cancelamento de UM título faturado do Registro de Recebíveis.
 *
 * Cancela apenas a parcela selecionada. Não usa /api/cobrancas/cancelar-externo,
 * que opera sobre a cobrança inteira de pagamentos_v2 — num faturado de N
 * parcelas isso cancelaria todas.
 *
 * Empresa 2 (Ideal Birô) vai para o Inter. Empresas 1 e 3 seguem no fluxo
 * legado: a rota devolve `delegarLegado: true` e o cliente chama
 * `deleteBoletoFromBankViaN8n` exatamente como antes.
 *
 * A regra de banco é do n8n, não daqui — o workflow VIBE-BOLETO-FATURADO-INTER
 * exclui somente o boleto cancelado e só marca pagamentos_v2 como CANCELADO
 * quando não resta parcela ativa. Esta rota NÃO duplica isso.
 */

const WEBHOOK_CANCELA_BIRO_FATURADO = "https://10074.hostoo.net.br/webhook/cancela-boleto-fat-inter";

const EMPRESA_BIRO = 2;

const STATUS_BLOQUEIA = new Set(["PAID", "CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"]);

type CancelarRequest = {
  boletoId: string;
  motivo: string;
};

type BoletoRow = {
  id: string;
  id_int: number | null;
  id_empresa: number | null;
  id_pagamento: string | null;
  id_boleto_c6: string | null;
  status: string | null;
  paid_at: string | null;
  is_faturado: boolean | null;
};

const STATUS_COBRANCA_INATIVA = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

/**
 * Qual cobrança de `pagamentos_v2` é a mãe deste título?
 *
 * Duas vias, na mesma ordem do dossiê do veredito:
 *  - `id_pagamento` gravado no título (o normal);
 *  - fallback legado por `id_int`, para os 266 títulos faturados gravados sem
 *    `id_pagamento`. Só vale quando a proposta tem UMA cobrança da família
 *    faturado; com mais de uma não dá para afirmar de quem é o título, e a
 *    resposta é "AMBIGUO" — recusar é mais barato que cancelar o título errado.
 *
 * `null` = a cobrança não foi encontrada. O título é cancelado assim mesmo:
 * título órfão de cobrança não tem mãe para proteger.
 */
async function resolverCobrancaMae(
  supabase: SupabaseClient,
  boleto: BoletoRow
): Promise<string | "AMBIGUO" | null> {
  if (boleto.id_pagamento) {
    const { data } = await supabase
      .from("pagamentos_v2")
      .select("id")
      .eq("id_pagamento", boleto.id_pagamento)
      .maybeSingle<{ id: string }>();
    if (data?.id) return data.id;
  }

  if (boleto.is_faturado !== true || boleto.id_int == null) return null;

  const { data: candidatas } = await supabase
    .from("pagamentos_v2")
    .select("id, tipo_cobranca")
    .eq("id_int", boleto.id_int)
    .returns<{ id: string; tipo_cobranca: string | null }[]>();

  const faturadas = (candidatas || []).filter((row) => isFamiliaFaturado(row.tipo_cobranca));
  if (faturadas.length === 1) return faturadas[0].id;
  if (faturadas.length > 1) return "AMBIGUO";
  return null;
}

export async function POST(request: Request) {
  let body: CancelarRequest;

  try {
    body = (await request.json()) as CancelarRequest;
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const { boletoId } = body;
  const motivo = String(body.motivo ?? "").trim();

  if (!boletoId) {
    return NextResponse.json({ success: false, message: "Campo boletoId ausente no body." }, { status: 400 });
  }
  if (!motivo) {
    return NextResponse.json({ success: false, message: "Motivo do cancelamento é obrigatório." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[CancelarBoletoFaturado] ENV AUSENTE");
    return NextResponse.json({ success: false, message: "Erro interno no servidor de banco de dados." }, { status: 500 });
  }

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

  // 1. Título — fonte da verdade é o banco.
  const { data: boleto, error: fetchErr } = await supabase
    .from("boletos")
    .select("id, id_int, id_empresa, id_pagamento, id_boleto_c6, status, paid_at, is_faturado")
    .eq("id", boletoId)
    .maybeSingle<BoletoRow>();

  if (fetchErr || !boleto) {
    return NextResponse.json(
      { success: false, message: "Título não encontrado ou fora do escopo de acesso do usuário." },
      { status: 404 }
    );
  }

  const idEmpresa = Number(boleto.id_empresa);

  // 2. Bloqueios de liquidação, no título.
  //
  // ORDEM MUDOU: estas checagens ficavam DEPOIS do retorno `delegarLegado`, ou
  // seja, as empresas 1 e 3 saíam daqui sem verificação nenhuma e o navegador
  // chamava o C6 direto. Agora valem para as três empresas.
  //
  // A granularidade é do título ALVO, e é por isso que continua aqui e não no
  // veredito: o veredito raciocina sobre a COBRANÇA ("algum título pago"), o
  // que num faturado de 3 parcelas com a primeira paga impediria cancelar a
  // terceira.
  if (boleto.paid_at != null) {
    return NextResponse.json(
      { success: false, code: "PAGAMENTO_QUITADO", message: "Título já liquidado. Cancelamento não permitido." },
      { status: 409 }
    );
  }

  const statusBoleto = String(boleto.status ?? "").toUpperCase();
  if (STATUS_BLOQUEIA.has(statusBoleto)) {
    return NextResponse.json(
      { success: false, code: "PAGAMENTO_QUITADO", message: `Título com status ${statusBoleto} não pode ser cancelado.` },
      { status: 409 }
    );
  }

  // 3. Cobrança-mãe, pelo VEREDITO compartilhado. Também vale para as três
  //    empresas, pelo mesmo motivo do passo 2.
  //
  //    O que bloqueia é LIQUIDAÇÃO, não conferência. Num faturado, `confirmado`
  //    e `data_confirmacao` são preenchidos quando a cobrança passa pela
  //    Conferência — ela segue em aberto, e é exatamente aí que cancelar o
  //    boleto faz sentido. Isso agora é regra do núcleo (`COBRANCA_RECEBIDA`
  //    olha `status = PAID` e `paid_at`, nunca `confirmado`), e não mais um
  //    if local.
  const maeId = await resolverCobrancaMae(supabase, boleto);

  if (maeId === "AMBIGUO") {
    return NextResponse.json(
      {
        success: false,
        code: "VINCULO_AMBIGUO",
        message:
          "Não foi possível identificar com segurança a cobrança deste título (registro antigo, sem vínculo gravado). " +
          "Peça conferência manual antes de cancelar."
      },
      { status: 409 }
    );
  }

  if (maeId) {
    const elegibilidade = await avaliarCancelamentoNoServidor(supabase, maeId, RECUSAS_CANCELAMENTO_TITULO);

    if (!elegibilidade.ok) {
      return NextResponse.json(
        { success: false, code: elegibilidade.erro, message: elegibilidade.mensagem },
        { status: elegibilidade.erro === "NAO_ENCONTRADA" ? 404 : 503 }
      );
    }

    if (!elegibilidade.veredito.pode) {
      return NextResponse.json(
        { success: false, code: elegibilidade.veredito.code, message: elegibilidade.veredito.message },
        { status: 409 }
      );
    }
  }

  // 4. Empresas 1 e 3 seguem no fluxo legado — o cliente chama o C6. A
  //    delegação passou para DEPOIS das checagens: o que muda para elas nesta
  //    etapa é só isso, ganharem verificação antes de acionar o banco.
  if (idEmpresa !== EMPRESA_BIRO) {
    return NextResponse.json({ success: true, delegarLegado: true, idEmpresa });
  }

  // 4. Sem identificador bancário não há o que cancelar no Inter.
  const codInter = String(boleto.id_boleto_c6 ?? "").trim();
  if (!codInter) {
    return NextResponse.json(
      { success: false, message: "Título sem identificador bancário. Não foi registrado no Inter." },
      { status: 400 }
    );
  }

  let webhookResponse: Response;
  try {
    webhookResponse = await fetch(WEBHOOK_CANCELA_BIRO_FATURADO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cod_inter: codInter, motivo })
    });
  } catch (erro) {
    console.error("[CancelarBoletoFaturado] Falha de rede ao acionar o webhook:", erro);
    return NextResponse.json(
      { success: false, message: "Não foi possível contatar a integração bancária. Nenhuma alteração foi feita." },
      { status: 502 }
    );
  }

  if (!webhookResponse.ok) {
    const detalhe = await webhookResponse.text().catch(() => "");
    console.error(`[CancelarBoletoFaturado] Webhook retornou ${webhookResponse.status}: ${detalhe.slice(0, 300)}`);
    // O workflow responde { success:false, message } com o motivo que o banco deu.
    // Sem repassar, o operador lê apenas "recusou" e não descobre o que fazer —
    // "a cobrança está EM_PROCESSAMENTO" pede esperar, não abrir chamado.
    let motivoBanco = "";
    try {
      motivoBanco = String((JSON.parse(detalhe) as { message?: string }).message ?? "").trim();
    } catch {
      motivoBanco = "";
    }
    return NextResponse.json(
      {
        success: false,
        message: motivoBanco
          ? `${motivoBanco} Nenhuma alteração local foi feita.`
          : "O Banco Inter recusou o cancelamento. Nenhuma alteração local foi feita."
      },
      { status: webhookResponse.status }
    );
  }

  const retorno = await webhookResponse.json().catch(() => null);

  if (!retorno || retorno.success === false) {
    return NextResponse.json(
      { success: false, message: retorno?.message || "A integração bancária não confirmou o cancelamento." },
      { status: 502 }
    );
  }

  // O n8n excluiu a linha de `boletos`. Aqui confirmamos pelo BANCO — nunca
  // pelo que ele respondeu.
  const { data: aindaExiste } = await supabase
    .from("boletos")
    .select("id")
    .eq("id", boletoId)
    .maybeSingle<{ id: string }>();

  // Defesa idempotente contra cancelamento em cascata da cobrança.
  //
  // Medido em 25/08/2026 lendo o workflow vivo: o ramo de cancelamento do
  // VIBE-BOLETO-FATURADO-INTER NÃO escreve em `pagamentos_v2` — as duas saídas
  // do `IF Sem parcela ativa` vão para o mesmo nó de resposta. Ou seja, hoje
  // este bloco NÃO dispara.
  //
  // Fica porque é barato, é no-op quando não há o que reativar, e protege a
  // invariante do passo 1 (a cobrança continua viva) caso a cascata volte num
  // save da UI do n8n — já aconteceu de correção sumir assim duas vezes.
  //
  // A decisão sai da RELEITURA, nunca de `retorno.pagamento_cancelado`: aquele
  // campo vem `true` sem que nada tenha sido escrito.
  let cobrancaReativada = false;
  if (maeId && maeId !== "AMBIGUO") {
    const { data: mae } = await supabase
      .from("pagamentos_v2")
      .select("status")
      .eq("id", maeId)
      .maybeSingle<{ status: string | null }>();

    if (mae && STATUS_COBRANCA_INATIVA.includes(String(mae.status ?? "").toUpperCase())) {
      const { error: erroReativar } = await supabase
        .from("pagamentos_v2")
        .update({ status: "A_VENCER", motivo_cancela: null, boleto_enviadoo: false })
        .eq("id", maeId);

      if (erroReativar) {
        console.error("[CancelarBoletoFaturado] Cascata detectada e falha ao reativar:", erroReativar.message);
        return NextResponse.json(
          {
            success: false,
            code: "FALHA_REATIVACAO",
            message:
              "O título foi cancelado no banco, mas a cobrança foi cancelada junto e não foi possível reabri-la. " +
              "NÃO salve a proposta — acerte a cobrança na aba Pagamentos."
          },
          { status: 409 }
        );
      }
      cobrancaReativada = true;
    }
  }

  return NextResponse.json({
    success: true,
    boletoExcluido: !aindaExiste,
    cobrancaReativada,
    // Repassados só como DIAGNÓSTICO, nunca para decidir: `pagamento_cancelado`
    // afirma cancelamento sem escrita, e `parcelas_ativas_restantes` é contado
    // por `id_int`, misturando cobranças da mesma proposta.
    diagnosticoWebhook: {
      parcelas_ativas_restantes: retorno.parcelas_ativas_restantes ?? null,
      pagamento_cancelado: retorno.pagamento_cancelado ?? null
    }
  });
}
